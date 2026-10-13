import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds } from "@/lib/points";
import { applyCampaignLedger, emptyCampaignLedger, loadCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { parseTrpgGmOutput } from "./gmPrompt";
import { buildCampaignMemoryPrompt, buildTrpgBotMemoryBlock } from "./memory";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";
import { TRPG_LEDGER_ITEM_MAX_CHARS, TRPG_LEDGER_NPC_MAX } from "./types";

/**
 * #1541: a GM-emitted `npcsAdd: [{name, description}]` must reach the same `string[]` NPC ledger a plain-string NPC
 * does, and an unsupported item must be counted by the existing parse diagnostics instead of vanishing. The R4 text
 * is the unmodified real gemini-3.8-flash output of the #1541 real-play run (fixtures/npcsAddObjectReal.json).
 */

const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/lib/trpg/fixtures/npcsAddObjectReal.json"), "utf8")
) as { R4_raw: string };
const REAL_R4 = parseTrpgGmOutput(FIXTURE.R4_raw);
const REAL_R4_DELTA = (JSON.parse(FIXTURE.R4_raw) as { delta: { npcsAdd: Array<{ name: string; description: string }> } }).delta;
const KANG = REAL_R4_DELTA.npcsAdd[0]!;
const OH = REAL_R4_DELTA.npcsAdd[1]!;

function wire(delta: Record<string, unknown>): string {
  return JSON.stringify({
    narration: "해무가 짙게 깔린 부두의 장면이 이어진다. GM: 무엇을 하겠는가.",
    delta: { players: [], location: "마레노 부두", next_round_context: "", campaign_finished: false, ...delta },
  });
}

const parseNpcs = (delta: Record<string, unknown>) => parseTrpgGmOutput(wire(delta));

async function captureInfo<T>(run: () => Promise<T> | T): Promise<{ result: T; lines: unknown[][] }> {
  const original = console.info;
  const lines: unknown[][] = [];
  console.info = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    return { result: await run(), lines };
  } finally {
    console.info = original;
  }
}

describe("NPC add normalization at the GM parser (#1541)", () => {
  it("real R4: the {name, description} objects reach the delta as names; nothing else in the delta changes", () => {
    assert.equal(KANG.name, "강도현");
    assert.equal(OH.name, "오 노인");
    assert.deepEqual(REAL_R4.delta.npcsAdd, ["강도현", "오 노인"]);
    assert.equal(REAL_R4.diagnostics, undefined);
    assert.deepEqual(REAL_R4.delta.questsAdd, ["강도현 체포 및 오 노인의 증언 확보: 도주를 저지하고 진실을 밝혀낸다"]);
    assert.deepEqual(REAL_R4.delta.questsClaimDone, ["세관 심부름꾼 추적: 뒷골목 석조 창고에서 철제 서류함을 회수한다"]);
    assert.equal(REAL_R4.delta.flagsAdd?.length, 3);
    assert.equal(REAL_R4.delta.storyPhase, "CLIMAX");
  });

  it("the description is not stored: a name is the only NPC data that reaches the ledger and its consumers", () => {
    const stored = JSON.stringify(REAL_R4.delta.npcsAdd);
    assert.doesNotMatch(stored, /진범|목격자|등대지기/);
    assert.ok(KANG.description.length > 0 && OH.description.length > 0);
  });

  it("plain strings are unchanged, including the existing `name: detail` one-line form", () => {
    const parsed = parseNpcs({ npcsAdd: ["여관주인", "세관 직원: 밀수 장부를 보여 주었다"] });
    assert.deepEqual(parsed.delta.npcsAdd, ["여관주인", "세관 직원: 밀수 장부를 보여 주었다"]);
    assert.equal(parsed.diagnostics, undefined);
  });

  it("mixed strings and objects keep their order; extra object fields are ignored; names are space-normalized", () => {
    const parsed = parseNpcs({
      npcsAdd: ["여관주인", { name: "  등대   지기 ", role: "ally", secret: "형제" }, { name: "종지기" }, "순찰대장"],
    });
    assert.deepEqual(parsed.delta.npcsAdd, ["여관주인", "등대 지기", "종지기", "순찰대장"]);
    assert.equal(parsed.diagnostics, undefined);
  });

  it("an item with no usable name is rejected and counted; valid siblings still pass", () => {
    const parsed = parseNpcs({
      npcsAdd: [
        { description: "이름 없음" },
        { name: "" },
        { name: "   " },
        { name: 42 },
        { name: ["배열"] },
        { id: "npc_1" },
        42,
        null,
        true,
        ["중첩"],
        "",
        "   ",
        "유효한 NPC",
      ],
    });
    assert.deepEqual(parsed.delta.npcsAdd, ["유효한 NPC"]);
    assert.deepEqual(parsed.diagnostics, { questsAddRejected: 0, npcsRejected: 12 });
  });

  it("a non-array NPC field is rejected as one item; an all-invalid list stores nothing; empty and absent lists are not diagnostics", () => {
    const text = parseNpcs({ npcsAdd: "강도현" });
    assert.equal(text.delta.npcsAdd, undefined);
    assert.deepEqual(text.diagnostics, { questsAddRejected: 0, npcsRejected: 1 });
    const none = parseNpcs({ npcsAdd: [{ description: "x" }, 7] });
    assert.equal(none.delta.npcsAdd, undefined);
    assert.deepEqual(none.diagnostics, { questsAddRejected: 0, npcsRejected: 2 });
    assert.equal(parseNpcs({ npcsAdd: [] }).diagnostics, undefined);
    assert.equal(parseNpcs({}).diagnostics, undefined);
  });

  it("NPC rejections and quest rejections are counted side by side", () => {
    const parsed = parseNpcs({ npcsAdd: [7], questsAdd: [{ desc: "제목 없음" }], npcsRemove: [{ id: "x" }] });
    assert.deepEqual(parsed.diagnostics, { questsAddRejected: 1, npcsRejected: 2 });
  });

  it("the name is clipped to the ledger item limit", () => {
    const parsed = parseNpcs({ npcsAdd: [{ name: "가".repeat(200) }] });
    assert.deepEqual(parsed.delta.npcsAdd, ["가".repeat(TRPG_LEDGER_ITEM_MAX_CHARS)]);
  });

  it("the legacy `npcs` alias accepts the same shapes", () => {
    assert.deepEqual(parseNpcs({ npcs: [KANG, "여관주인"] }).delta.npcsAdd, ["강도현", "여관주인"]);
    assert.deepEqual(parseNpcs({ npcsAdd: ["여관주인"], npcs: [KANG] }).delta.npcsAdd, ["여관주인"]);
  });

  it("npcsRemove takes the same name shapes so a removal can name an NPC the way it was added", () => {
    assert.deepEqual(parseNpcs({ npcsRemove: ["강도현", { name: "오 노인" }] }).delta.npcsRemove, ["강도현", "오 노인"]);
  });
});

describe("NPC ledger from normalized names (#1541)", () => {
  it("real R4 names land in the ledger; the same NPC added as a string and as an object is stored once", () => {
    const first = applyCampaignLedger(emptyCampaignLedger(), REAL_R4.delta);
    assert.deepEqual(first.npcs, ["강도현", "오 노인"]);
    const again = applyCampaignLedger(first, parseNpcs({ npcsAdd: ["강도현", { name: "오 노인", description: "다른 설명" }, "종지기"] }).delta);
    assert.deepEqual(again.npcs, ["강도현", "오 노인", "종지기"]);
  });

  it("removal is an exact name comparison: by string or by object, never by a fragment", () => {
    const base = applyCampaignLedger(emptyCampaignLedger(), parseNpcs({ npcsAdd: ["강도현", "강도현의 호위병", { name: "오 노인" }] }).delta);
    assert.deepEqual(base.npcs, ["강도현", "강도현의 호위병", "오 노인"]);
    const fragment = applyCampaignLedger(base, parseNpcs({ npcsRemove: ["강도"] }).delta);
    assert.deepEqual(fragment.npcs, base.npcs);
    const byString = applyCampaignLedger(base, parseNpcs({ npcsRemove: ["강도현"] }).delta);
    assert.deepEqual(byString.npcs, ["강도현의 호위병", "오 노인"]);
    const byObject = applyCampaignLedger(base, parseNpcs({ npcsRemove: [{ name: "오 노인" }] }).delta);
    assert.deepEqual(byObject.npcs, ["강도현", "강도현의 호위병"]);
  });

  it("the 16-NPC limit holds for object adds; a removal frees a slot", () => {
    const full = applyCampaignLedger(
      emptyCampaignLedger(),
      parseNpcs({ npcsAdd: Array.from({ length: TRPG_LEDGER_NPC_MAX }, (_, i) => ({ name: `기존 NPC ${i + 1}` })) }).delta
    );
    assert.equal(full.npcs.length, TRPG_LEDGER_NPC_MAX);
    const over = applyCampaignLedger(full, REAL_R4.delta);
    assert.deepEqual(over.npcs, full.npcs);
    const freed = applyCampaignLedger(full, parseNpcs({ npcsRemove: ["기존 NPC 1"], npcsAdd: [KANG, OH] }).delta);
    assert.equal(freed.npcs.length, TRPG_LEDGER_NPC_MAX);
    assert.ok(freed.npcs.includes("강도현"));
    assert.ok(!freed.npcs.includes("기존 NPC 1"));
  });
});

function party(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
  `);
  for (const [id, nickname] of [[1, "렌"], [2, "현"]] as const) {
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (?,?,?,0)`).run(id, `${id}@t`, nickname);
    creditPointsWithIds(db, id, 5000, "PAID", `npc-object-credit-${id}`);
  }
  ensureTrpgTables(db);
  const templateId = insertScenarioTemplate(db, 7, {
    title: "안개항 실종 사건",
    summary: "해무의 항구",
    content: "항구도시에서 사라진 어선을 쫓는다.",
    visibility: "public",
    startLocation: "마레노 부두",
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string }).invite_code;
  joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "현" });
  saveTrpgSheet(db, { campaignId, userId: 2, name: "현", stats: EVEN_STATS });
  const seat = (userId: number) =>
    (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?`).get(campaignId, userId) as { id: number }).id;
  const ids = [seat(1), seat(2)];
  for (const [slot, name] of [[2, "서하"], [3, "도윤"]] as const) {
    const id = insertParticipant(db, {
      campaignId, slotIndex: slot, kind: "ai_character", userId: null, characterId: null, displayName: name,
      persona: { description: `${name}의 설명`, greeting: "", systemPrompt: "" },
    });
    writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
    ids.push(id);
  }
  return { campaignId, ids };
}

type Captured = { gm: string[]; bot: string[] };

function scripted(texts: string[]): { deps: TrpgEngineDeps; captured: Captured } {
  const captured: Captured = { gm: [], bot: [] };
  let call = 0;
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async (_system, user) => {
      captured.bot.push(user);
      return { text: "조용히 주변을 살핀다." };
    },
    gmCall: async ({ user }) => {
      captured.gm.push(user);
      const text = texts[Math.min(call, texts.length - 1)]!;
      call += 1;
      return { text };
    },
  };
  return { deps, captured };
}

async function play(db: Database.Database, campaignId: number, deps: TrpgEngineDeps) {
  submitTrpgAction(db, { campaignId, userId: 1, body: "부두 노인에게 말을 건다.", actionType: "free" });
  submitTrpgAction(db, { campaignId, userId: 2, body: "부두를 살핀다.", actionType: "free" });
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

const storedNpcs = (db: Database.Database, campaignId: number) =>
  JSON.parse((db.prepare(`SELECT npcs_json FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as { npcs_json: string }).npcs_json) as string[];

describe("NPC objects through the real engine path (#1541)", () => {
  it("real R4 persists names as string[], reloads, and reaches the next round's GM and AI companion input", async () => {
    const db = new Database(":memory:");
    const { campaignId, ids } = party(db);
    const { deps, captured } = scripted([wire({ players: ids.map((participantId) => ({ participantId })) }), FIXTURE.R4_raw, wire({})]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignLedger(db, campaignId).npcs, []);
    await play(db, campaignId, deps);
    assert.deepEqual(storedNpcs(db, campaignId), ["강도현", "오 노인"], "storage format stays string[]");
    assert.deepEqual(loadCampaignLedger(db, campaignId).npcs, ["강도현", "오 노인"]);
    assert.match(buildCampaignMemoryPrompt(db, campaignId), /npcs: 강도현; 오 노인/);

    await play(db, campaignId, deps);
    const nextGm = captured.gm[captured.gm.length - 1]!;
    assert.match(nextGm, /npcs: 강도현; 오 노인/);
    const nextBots = captured.bot.slice(-2);
    assert.equal(nextBots.length, 2);
    for (const botUser of nextBots) assert.match(botUser, /npcs: 강도현; 오 노인/);

    for (const input of [nextGm, ...nextBots]) {
      assert.ok(!input.includes(KANG.description), "the NPC description is not in any next-round input");
      assert.ok(!input.includes(OH.description), "the NPC description is not in any next-round input");
    }
    assert.match(buildTrpgBotMemoryBlock({ ledger: loadCampaignLedger(db, campaignId), sheets: [] }), /npcs: 강도현; 오 노인/);
    db.close();
  });

  it("the same NPC added again in a later round is not registered twice; a named removal then drops it", async () => {
    const db = new Database(":memory:");
    const { campaignId, ids } = party(db);
    const players = ids.map((participantId) => ({ participantId }));
    const { deps } = scripted([
      wire({ players, npcsAdd: [KANG] }),
      wire({ players, npcsAdd: ["강도현", { name: "오 노인" }] }),
      wire({ players, npcsRemove: [{ name: "강도현" }] }),
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(storedNpcs(db, campaignId), ["강도현"]);
    await play(db, campaignId, deps);
    assert.deepEqual(storedNpcs(db, campaignId), ["강도현", "오 노인"]);
    await play(db, campaignId, deps);
    assert.deepEqual(storedNpcs(db, campaignId), ["오 노인"]);
    db.close();
  });

  it("an existing saved row of plain strings loads and merges with an object add unchanged", async () => {
    const db = new Database(":memory:");
    const { campaignId, ids } = party(db);
    const players = ids.map((participantId) => ({ participantId }));
    const { deps } = scripted([wire({ players }), wire({ players, npcsAdd: [KANG] })]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    db.prepare(`UPDATE trpg_campaign_state SET npcs_json=? WHERE campaign_id=?`).run(
      JSON.stringify(["저장된 옛 NPC", "종지기: 열쇠는 등대지기가 가졌다"]),
      campaignId
    );
    await play(db, campaignId, deps);
    assert.deepEqual(storedNpcs(db, campaignId), ["저장된 옛 NPC", "종지기: 열쇠는 등대지기가 가졌다", "강도현"]);
    db.close();
  });

  it("rejected NPC items log a count only, never the raw name, description or id", async () => {
    const db = new Database(":memory:");
    const { campaignId, ids } = party(db);
    const players = ids.map((participantId) => ({ participantId }));
    const { deps } = scripted([
      wire({ players, npcsAdd: [{ id: "비밀아이디", description: "비밀설명" }, 7, KANG] }),
    ]);
    const { lines } = await captureInfo(() => startTrpgCampaign(db, { campaignId, userId: 1, deps }));
    assert.deepEqual(storedNpcs(db, campaignId), ["강도현"]);
    const rejected = lines.find((line) => line[0] === "[TRPG][gm] npc_rejected");
    assert.deepEqual(rejected?.[1], { count: 2 });
    assert.doesNotMatch(JSON.stringify(lines), /비밀아이디|비밀설명|강도현/);
    db.close();
  });
});
