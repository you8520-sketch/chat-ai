import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { addTrpgCompanions, createTrpgCampaign, joinTrpgCampaign } from "./engineCreate";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { loadTrpgPartySheetComponent } from "./partySheetComponent";
import {
  createTrpgPartySheetComponentLoader,
  trpgPartySheetComponentParticipantId,
} from "./partySheetComponentClient";
import { ensureTrpgTables } from "./schema";
import { pickTrpgSheetRenderer, type TrpgSheetRendererCandidate } from "./sheetSurface";
import { loadCampaign, loadParticipants } from "./store";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      shared_from_nickname TEXT NOT NULL DEFAULT '',
      trpg_enabled INTEGER NOT NULL DEFAULT 0,
      trpg_visibility TEXT NOT NULL DEFAULT 'private',
      cover_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      greeting TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      world TEXT NOT NULL DEFAULT '',
      world_id INTEGER,
      creator_id INTEGER,
      visibility TEXT NOT NULL DEFAULT 'public',
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      share_slug TEXT,
      official INTEGER NOT NULL DEFAULT 0,
      trpg_reuse_allowed INTEGER NOT NULL DEFAULT 0,
      emoji TEXT NOT NULL DEFAULT '✨',
      jsx_components_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureTrpgTables(db);
  return db;
}

function sheetCatalog(tag: string): string {
  return JSON.stringify([
    { name: "QuestCard", source: `export default function QuestCard() { return <p>chat-${tag}</p>; }`, props: [] },
    {
      name: `Sheet${tag}`,
      surface: "trpg_sheet",
      source: `export default function Sheet${tag}(props) { return <p>SHEET-${tag} {props.name}</p>; }`,
      props: [],
    },
  ]);
}

function insertCharacter(db: Database.Database, name: string, jsx: string, official = 1): number {
  return Number(
    db
      .prepare(`INSERT INTO characters (name, description, official, jsx_components_json) VALUES (?, '검사', ?, ?)`)
      .run(name, official, jsx).lastInsertRowid
  );
}

function aiParticipants(db: Database.Database, campaignId: number) {
  return loadParticipants(db, campaignId).filter((p) => p.kind === "ai_character");
}

describe("TRPG AI PARTY creator sheet loader", () => {
  it("H/I. participant → canonical characterId → that character's trpg_sheet; same names stay distinct", () => {
    const db = memoryDb();
    const a = insertCharacter(db, "미라", sheetCatalog("A"));
    const b = insertCharacter(db, "미라", sheetCatalog("B"));
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    addTrpgCompanions(db, { campaignId, userId: 1, characterIds: [a, b] });
    const bots = aiParticipants(db, campaignId);
    assert.deepEqual(bots.map((p) => p.display_name), ["미라", "미라"]);
    const byCharacter = new Map(bots.map((p) => [p.character_id, p.id]));
    const sheetA = loadTrpgPartySheetComponent(db, campaignId, 1, byCharacter.get(a)!);
    const sheetB = loadTrpgPartySheetComponent(db, campaignId, 1, byCharacter.get(b)!);
    assert.equal(sheetA?.characterId, a);
    assert.equal(sheetA?.name, "SheetA");
    assert.match(sheetA?.compiled ?? "", /SHEET-A/);
    assert.equal(sheetB?.characterId, b);
    assert.match(sheetB?.compiled ?? "", /SHEET-B/);
    assert.doesNotMatch(sheetA?.compiled ?? "", /chat-A/);
    assert.equal(Object.hasOwn(sheetA ?? {}, "source"), false);
    db.close();
  });

  it("J. an AI with no creator sheet, a human, or a non-member viewer gets null", () => {
    const db = memoryDb();
    const plain = insertCharacter(db, "두리", JSON.stringify([{ name: "QuestCard", source: "export default function QuestCard() { return null; }", props: [] }]));
    const sheeted = insertCharacter(db, "하나", sheetCatalog("A"));
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    addTrpgCompanions(db, { campaignId, userId: 1, characterIds: [plain, sheeted] });
    const [plainBot, sheetedBot] = aiParticipants(db, campaignId);
    assert.equal(loadTrpgPartySheetComponent(db, campaignId, 1, plainBot!.id), null);
    const human = loadParticipants(db, campaignId).find((p) => p.kind === "human")!;
    assert.equal(loadTrpgPartySheetComponent(db, campaignId, 1, human.id), null);
    assert.equal(loadTrpgPartySheetComponent(db, campaignId, 99, sheetedBot!.id), null);
    assert.equal(loadTrpgPartySheetComponent(db, campaignId + 1, 1, sheetedBot!.id), null);

    const invite = loadCampaign(db, campaignId)!.invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "미라" });
    assert.ok(loadTrpgPartySheetComponent(db, campaignId, 2, sheetedBot!.id));

    // Admission is re-checked against the host with the same owner that admitted it.
    db.prepare(`UPDATE characters SET official=0, visibility='private' WHERE id=?`).run(sheeted);
    assert.equal(loadTrpgPartySheetComponent(db, campaignId, 1, sheetedBot!.id), null);
    db.close();
  });

  it("Q. a companion added after the first snapshot is resolvable without a stale page-prop map", () => {
    const db = memoryDb();
    const first = insertCharacter(db, "하나", sheetCatalog("A"));
    const later = insertCharacter(db, "두리", sheetCatalog("B"));
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    const invite = loadCampaign(db, campaignId)!.invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "미라" });
    addTrpgCompanions(db, { campaignId, userId: 1, characterIds: [first] });
    const before = loadTrpgSnapshot(db, campaignId, 2)!;
    addTrpgCompanions(db, { campaignId, userId: 1, characterIds: [later] });
    const polled = loadTrpgSnapshot(db, campaignId, 2)!;
    const added = polled.participants.find((p) => !before.participants.some((q) => q.id === p.id))!;
    assert.equal(added.characterId, later);
    assert.equal(trpgPartySheetComponentParticipantId(polled.participants, added.id), added.id);
    assert.match(loadTrpgPartySheetComponent(db, campaignId, 2, added.id)?.compiled ?? "", /SHEET-B/);
    // The polled snapshot never carries compiled creator code.
    assert.doesNotMatch(JSON.stringify(polled), /SHEET-A|SHEET-B|jsx_components_json/);
    db.close();
  });

  it("client loader fetches once per participant and shares in-flight lookups", async () => {
    const calls: number[] = [];
    const load = createTrpgPartySheetComponentLoader(async (participantId) => {
      calls.push(participantId);
      if (participantId === 3) throw new Error("network");
      return `compiled-${participantId}`;
    });
    const [x, y] = await Promise.all([load(1), load(1)]);
    assert.equal(x, "compiled-1");
    assert.equal(y, "compiled-1");
    assert.equal(await load(2), "compiled-2");
    assert.equal(await load(1), "compiled-1");
    assert.equal(await load(3), null);
    assert.deepEqual(calls, [1, 2, 3]);
    const participants = [
      { id: 1, kind: "human" as const, characterId: null },
      { id: 2, kind: "ai_character" as const, characterId: 7 },
      { id: 3, kind: "ai_character" as const, characterId: null },
    ];
    assert.equal(trpgPartySheetComponentParticipantId(participants, 1), null);
    assert.equal(trpgPartySheetComponentParticipantId(participants, 2), 2);
    assert.equal(trpgPartySheetComponentParticipantId(participants, 3), null);
    assert.equal(trpgPartySheetComponentParticipantId(participants, null), null);
  });
});

describe("TRPG PARTY sheet fallback chain", () => {
  const party = (creator: string | null): TrpgSheetRendererCandidate[] => [
    { source: "creator", compiled: creator },
    { source: "site", compiled: "site" },
  ];

  it("J/K/L. creator → site default → native", () => {
    assert.deepEqual(pickTrpgSheetRenderer(party("A"), new Set()), { kind: "jsx", source: "creator", compiled: "A" });
    assert.deepEqual(pickTrpgSheetRenderer(party(null), new Set()), { kind: "jsx", source: "site", compiled: "site" });
    assert.deepEqual(pickTrpgSheetRenderer(party("A"), new Set(["A"])), { kind: "jsx", source: "site", compiled: "site" });
    assert.deepEqual(pickTrpgSheetRenderer(party("A"), new Set(["A", "site"])), { kind: "native" });
    assert.deepEqual(pickTrpgSheetRenderer([{ source: "creator", compiled: "A" }, { source: "site", compiled: null }], new Set(["A"])), {
      kind: "native",
    });
  });

  it("M. one participant's creator failure does not disable another's custom sheet", () => {
    const failed = new Set(["A"]);
    assert.deepEqual(pickTrpgSheetRenderer(party("A"), failed), { kind: "jsx", source: "site", compiled: "site" });
    assert.deepEqual(pickTrpgSheetRenderer(party("B"), failed), { kind: "jsx", source: "creator", compiled: "B" });
    // SELF keeps its #1414 semantics: only the site sheet, failing straight to native.
    assert.deepEqual(pickTrpgSheetRenderer([{ source: "site", compiled: "site" }], failed), {
      kind: "jsx",
      source: "site",
      compiled: "site",
    });
  });

  it("N/O/P. PARTY sheets get no host handler; failure memory is per compiled identity; one renderer at a time", () => {
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /onFillAction=\{null\}/);
    assert.match(dock, /onTrpgActionDraft=\{onFillAction \? onTrpgActionDraft : null\}/);
    assert.doesNotMatch(dock, /JsxHostBridgeProvider|bridge=|chatSendEnabled|fetch\(/);
    assert.match(dock, /new Set\(current\)\.add\(compiled\)/);
    assert.equal(dock.match(/<SheetSurfaceView/g)?.length, 2);
    assert.match(dock, /creatorSheetPending \? \(/);
    assert.match(dock, /key=\{`\$\{partySurface\.participantId\}:/);
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/party-sheet/route.ts", "utf8");
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
    const loader = readFileSync("src/lib/trpg/partySheetComponent.ts", "utf8");
    assert.doesNotMatch(loader, /\.run\(|transaction|INSERT|UPDATE|DELETE/);
    assert.match(loader, /canViewTrpgCampaign\(campaign, participants, viewerUserId\)/);
    assert.match(loader, /canUseCharacterInTrpg\(character, campaign\.host_user_id\)/);
  });
});
