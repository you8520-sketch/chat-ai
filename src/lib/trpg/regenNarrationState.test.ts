import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { emptyCampaignLedger, loadCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadSheetSnapshots } from "./engineSheets";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { loadGmNarrationDraft } from "./gmNarrationDraft";
import { loadBillableRerollUsage, loadRerollUsageEntries } from "./roundUsage";
import { inventoryUnits } from "./inventory";
import { buildCampaignMemoryPrompt } from "./memory";
import { regenerateOutputInvertsCommittedCanon } from "./regenerateCanon";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";
import type { TrpgSheetSnapshot } from "./types";

const LEDGER = "세관 밀수 원본 장부";

function sheet(opts: {
  participantId: number;
  name: string;
  inventory?: string[];
  hp?: number;
  location?: string;
  conditions?: string[];
}): TrpgSheetSnapshot {
  return {
    participantId: opts.participantId,
    name: opts.name,
    playerName: opts.name,
    level: 1,
    hp: opts.hp ?? 40,
    maxHp: 40,
    stats: {},
    conditions: opts.conditions ?? [],
    inventory: (opts.inventory ?? []).map((name) => ({
      id: name,
      name,
      quantity: 1,
      equipped: false,
      slot: null,
    })),
    location: opts.location ?? "마레노 부두",
    modifiersNote: "+0",
  };
}

describe("regenerateOutputInvertsCommittedCanon", () => {
  const hyun = sheet({ participantId: 2, name: "현", inventory: [LEDGER] });
  const seoha = sheet({ participantId: 3, name: "서하" });
  const ledger = { ...emptyCampaignLedger(), location: "마레노 부두", quests: ["서류함 회수"], npcs: ["강도현"], worldFlags: ["단서"] };

  it("restating the committed holder, location, quest, npc and flag is not invert", () => {
    const result = regenerateOutputInvertsCommittedCanon({
      delta: {
        players: [{ participantId: 2, hp: 40, inventoryAdd: [LEDGER], location: "마레노 부두" }],
        location: "마레노 부두",
        questsAdd: ["서류함 회수"],
        npcsAdd: ["강도현"],
        flagsAdd: ["단서"],
      },
      sheets: [hyun, seoha],
      ledger,
    });
    assert.equal(result.invert, false);
  });

  it("giving a held item to another seat is invert", () => {
    const result = regenerateOutputInvertsCommittedCanon({
      delta: { players: [{ participantId: 3, inventoryAdd: [LEDGER] }] },
      sheets: [hyun, seoha],
      ledger,
    });
    assert.deepEqual(result.reasons, ["inventory_holder"]);
  });

  it("removing a still-held item or adding a new item is invert", () => {
    const remove = regenerateOutputInvertsCommittedCanon({
      delta: { players: [{ participantId: 2, inventoryRemove: [LEDGER] }] },
      sheets: [hyun, seoha],
      ledger,
    });
    assert.ok(remove.reasons.includes("inventory_remove"));
    const added = regenerateOutputInvertsCommittedCanon({
      delta: { players: [{ participantId: 2, inventoryAdd: ["특수 출동 명령서"] }] },
      sheets: [hyun, seoha],
      ledger,
    });
    assert.ok(added.reasons.includes("inventory_new"));
  });

  it("HP, seat location and campaign location changes are invert", () => {
    const result = regenerateOutputInvertsCommittedCanon({
      delta: {
        players: [{ participantId: 2, hp: 24, location: "석조 폐창고" }],
        location: "석조 폐창고",
      },
      sheets: [hyun, seoha],
      ledger,
    });
    assert.ok(result.reasons.includes("hp"));
    assert.ok(result.reasons.includes("sheet_location"));
    assert.ok(result.reasons.includes("campaign_location"));
  });

  it("a campaign ending, a new encounter ending, or a local-scene move is invert", () => {
    const finished = regenerateOutputInvertsCommittedCanon({
      delta: { players: [] },
      sheets: [hyun],
      ledger,
      campaignFinished: true,
    });
    assert.ok(finished.reasons.includes("campaign_finished"));
    const ended = regenerateOutputInvertsCommittedCanon({
      delta: { players: [], encountersEnded: ["enc_hunter"] },
      sheets: [hyun],
      ledger,
      endedEncounterIds: [],
    });
    assert.ok(ended.reasons.includes("encounter_end"));
    const restated = regenerateOutputInvertsCommittedCanon({
      delta: { players: [], encountersEnded: ["enc_hunter"] },
      sheets: [hyun],
      ledger,
      endedEncounterIds: ["enc_hunter"],
    });
    assert.equal(restated.invert, false);
  });

  it("restating the committed quest claim is not invert; a new claim is", () => {
    const committedDelta = {
      questsAdd: ["다음 조사"],
      questsRemove: ["서류함 회수"],
      questsClaimDone: ["서류함 회수"],
    };
    const restated = regenerateOutputInvertsCommittedCanon({
      delta: committedDelta,
      sheets: [hyun],
      ledger,
      committedDelta,
    });
    assert.equal(restated.invert, false);
    const fresh = regenerateOutputInvertsCommittedCanon({
      delta: { questsClaimDone: ["다른 목표"] },
      sheets: [hyun],
      ledger,
      committedDelta,
    });
    assert.ok(fresh.reasons.includes("quest_claim"));
  });
});

function players(ids: number[], extra: Record<number, Record<string, unknown>> = {}) {
  return ids.map((participantId) => ({
    participantId,
    hp: 40,
    conditions: [],
    inventoryAdd: [],
    inventoryRemove: [],
    location: "마레노 부두",
    ...extra[participantId],
  }));
}

function wire(
  narration: string,
  ids: number[],
  extra: Record<number, Record<string, unknown>> = {},
  more: Record<string, unknown> = {}
) {
  return JSON.stringify({
    narration,
    delta: {
      players: players(ids, extra),
      location: "마레노 부두",
      next_round_context: "",
      campaign_finished: false,
      ...more,
    },
  });
}

function party(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
  `);
  for (const [id, nickname] of [
    [1, "렌"],
    [2, "현"],
  ] as const) {
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (?,?,?,5000)`).run(id, `${id}@t`, nickname);
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
  const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string })
    .invite_code;
  joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "현" });
  saveTrpgSheet(db, { campaignId, userId: 2, name: "현", stats: EVEN_STATS });
  const seat = (userId: number) =>
    (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?`).get(campaignId, userId) as { id: number })
      .id;
  const ids = [seat(1), seat(2)];
  for (const [slot, name] of [
    [2, "서하"],
    [3, "도윤"],
  ] as const) {
    const id = insertParticipant(db, {
      campaignId,
      slotIndex: slot,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: name,
      persona: { description: `${name}의 설명`, greeting: "", systemPrompt: "" },
    });
    writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
    ids.push(id);
  }
  return { campaignId, ids, hyunId: ids[1]!, seohaId: ids[2]! };
}

function scripted(texts: string[]): { deps: TrpgEngineDeps; captured: { gm: string[] } } {
  const captured = { gm: [] as string[] };
  let call = 0;
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({ text: "조용히 주변을 살핀다." }),
    gmCall: async ({ user }) => {
      captured.gm.push(user);
      const text = texts[Math.min(call, texts.length - 1)]!;
      call += 1;
      return { text };
    },
  };
  return { deps, captured };
}

function play(db: Database.Database, campaignId: number, deps: TrpgEngineDeps) {
  submitTrpgAction(db, { campaignId, userId: 1, body: "골목 입구에서 망을 본다.", actionType: "free" });
  submitTrpgAction(db, {
    campaignId,
    userId: 2,
    body: "주운 황동 열쇠를 들고 폐창고로 들어가 철제 서류함을 찾아 확인한다.",
    actionType: "investigate",
  });
  return advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

function itemsOf(db: Database.Database, campaignId: number) {
  return Object.fromEntries(
    loadSheetSnapshots(db, campaignId).map((row) => [row.name, inventoryUnits(row.inventory)])
  );
}

describe("regenerate keeps committed facts in the published scene", () => {
  it("does not publish a rewrite that hands Hyun's ledger to Seoha", async () => {
    const db = new Database(":memory:");
    const { campaignId, ids, hyunId, seohaId } = party(db);
    const committed = "현이 철제 서류함을 열고 세관 밀수 원본 장부를 챙겼다. GM: 무엇을 하겠는가?";
    const inverted = "서하가 서류함에서 세관 밀수 원본 장부를 꺼내 품에 넣었다. GM: 무엇을 하겠는가?";
    const { deps, captured } = scripted([
      wire("오프닝. GM: 무엇을 하겠는가?", ids),
      wire(committed, ids, { [hyunId]: { inventoryAdd: [LEDGER] } }),
      wire(inverted, ids, { [seohaId]: { inventoryAdd: [LEDGER] } }),
      wire("다음 장면. GM: 무엇을 하겠는가?", ids),
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await play(db, campaignId, deps);
    assert.deepEqual(itemsOf(db, campaignId)["현"], [LEDGER]);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.currentNarration, committed);

    const committedId = (
      db.prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`).get(campaignId) as {
        gm_committed_generation_id: string;
      }
    ).gm_committed_generation_id;
    const beforeMessage = db
      .prepare(
        `SELECT narration, structured_json FROM trpg_gm_messages WHERE round_id=(SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1)`
      )
      .get(campaignId) as { narration: string; structured_json: string };
    await assert.rejects(
      () => regenerateTrpgNarration(db, { campaignId, userId: 1, deps }),
      /확정된 결과와 맞지 않아/
    );
    assert.deepEqual(itemsOf(db, campaignId)["현"], [LEDGER]);
    assert.deepEqual(itemsOf(db, campaignId)["서하"], []);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.currentNarration, committed);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.gmNarrationDraft, null);
    const afterMessage = db
      .prepare(
        `SELECT narration, structured_json FROM trpg_gm_messages WHERE round_id=(SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1)`
      )
      .get(campaignId) as { narration: string; structured_json: string };
    assert.equal(afterMessage.narration, beforeMessage.narration);
    assert.equal(afterMessage.structured_json, beforeMessage.structured_json);
    const raw = JSON.parse(afterMessage.structured_json) as {
      delta: { players: Array<{ participantId: number; inventoryAdd?: string[] }> };
    };
    assert.equal(
      raw.delta.players.some((row) => row.participantId === seohaId && (row.inventoryAdd ?? []).includes(LEDGER)),
      false
    );
    assert.equal(
      (
        db.prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`).get(campaignId) as {
          gm_committed_generation_id: string;
        }
      ).gm_committed_generation_id,
      committedId
    );

    await play(db, campaignId, deps);
    const nextGm = captured.gm[captured.gm.length - 1]!;
    assert.match(nextGm, new RegExp(`items=${LEDGER}`));
    assert.match(nextGm, /현이 철제 서류함을 열고/);
    assert.doesNotMatch(nextGm, /서하가 서류함에서 세관 밀수 원본 장부를 꺼내/);
    assert.match(buildCampaignMemoryPrompt(db, campaignId), /현이 철제 서류함을 열고/);
    db.close();
  });

  it("still rewrites prose when the structured facts stay on the committed holder", async () => {
    const db = new Database(":memory:");
    const { campaignId, ids, hyunId } = party(db);
    const rewritten = "현이 장부를 품에 넣고 창고 문을 돌아본다. GM: 무엇을 하겠는가?";
    const { deps, captured } = scripted([
      wire("오프닝. GM: 무엇을 하겠는가?", ids),
      wire("현이 철제 서류함을 열고 세관 밀수 원본 장부를 챙겼다. GM: 무엇을 하겠는가?", ids, {
        [hyunId]: { inventoryAdd: [LEDGER] },
      }),
      wire(rewritten, ids, { [hyunId]: { inventoryAdd: [LEDGER] } }),
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await play(db, campaignId, deps);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    const regenPrompt = captured.gm.at(-1) ?? "";
    assert.match(regenPrompt, /COMMITTED SCENE/);
    assert.match(regenPrompt, /COMMITTED RESULT — immutable/);
    assert.match(regenPrompt, new RegExp(LEDGER));
    assert.match(regenPrompt, /REWRITE — binding/);
    assert.doesNotMatch(regenPrompt, /Write a different scene/);
    assert.doesNotMatch(regenPrompt, /\[ROUND EXECUTION — binding\]/);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.currentNarration, rewritten);
    assert.deepEqual(itemsOf(db, campaignId)["현"], [LEDGER]);
    assert.equal(loadCampaignLedger(db, campaignId).location, "마레노 부두");
    const stored = db
      .prepare(
        `SELECT narration, structured_json FROM trpg_gm_messages WHERE round_id=(SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1)`
      )
      .get(campaignId) as { narration: string; structured_json: string };
    assert.equal(stored.narration, rewritten);
    assert.equal(JSON.parse(stored.structured_json).narration, rewritten);
    db.close();
  });

  it("publishes a prose contradiction when the structured delta still restates the holder", async () => {
    const db = new Database(":memory:");
    const { campaignId, ids, hyunId } = party(db);
    const proseOnly = "서하가 장부를 낚아채 품에 넣었다. GM: 무엇을 하겠는가?";
    const { deps } = scripted([
      wire("오프닝. GM: 무엇을 하겠는가?", ids),
      wire("현이 철제 서류함을 열고 세관 밀수 원본 장부를 챙겼다. GM: 무엇을 하겠는가?", ids, {
        [hyunId]: { inventoryAdd: [LEDGER] },
      }),
      wire(proseOnly, ids, { [hyunId]: { inventoryAdd: [LEDGER] } }),
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await play(db, campaignId, deps);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.currentNarration, proseOnly);
    assert.deepEqual(itemsOf(db, campaignId)["현"], [LEDGER]);
    db.close();
  });

  it("charges a published rewrite and does not charge a rejected one", async () => {
    const db = new Database(":memory:");
    const { campaignId, ids, hyunId, seohaId } = party(db);
    creditPointsWithIds(db, 1, 50_000, "PAID", "regen-billing-host");
    creditPointsWithIds(db, 2, 50_000, "PAID", "regen-billing-hyun");
    const usage = { modelId: "deepseek-v4-pro", inputTokens: 2000, outputTokens: 600 };
    const rewritten = "현이 장부를 품에 넣고 창고 문을 돌아본다. GM: 무엇을 하겠는가?";
    let call = 0;
    let draftDuringReject: string | null = null;
    let snapshotDuringReject: ReturnType<typeof loadTrpgSnapshot> = null;
    const deps: TrpgEngineDeps = {
      skipBilling: false,
      rollD20: () => 15,
      rollDie: () => 4,
      botCall: async () => ({ text: "조용히 주변을 살핀다." }),
      gmCall: async (req) => {
        call += 1;
        if (call === 1) return { text: wire("오프닝. GM: 무엇을 하겠는가?", ids), usage };
        if (call === 2) {
          return {
            text: wire("현이 철제 서류함을 열고 세관 밀수 원본 장부를 챙겼다. GM: 무엇을 하겠는가?", ids, {
              [hyunId]: { inventoryAdd: [LEDGER] },
            }),
            usage,
          };
        }
        if (call === 3) return { text: wire(rewritten, ids, { [hyunId]: { inventoryAdd: [LEDGER] } }), usage };
        const streamed = "서하가 장부를 가져갔다.";
        req.stream?.onNarrationChunk?.(streamed);
        const roundId = (
          db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`).get(campaignId) as { id: number }
        ).id;
        draftDuringReject = loadGmNarrationDraft(db, roundId)?.text ?? null;
        snapshotDuringReject = loadTrpgSnapshot(db, campaignId, 1);
        return {
          text: wire("서하가 장부를 가져갔다. GM: 무엇을 하겠는가?", ids, { [seohaId]: { inventoryAdd: [LEDGER] } }),
          usage,
        };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await play(db, campaignId, deps);
    const beforeRewrite = getPointBalanceOnDb(db, 1).total;
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    const afterRewrite = getPointBalanceOnDb(db, 1).total;
    assert.ok(beforeRewrite > afterRewrite);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.currentNarration, rewritten);
    const roundId = (
      db.prepare(`SELECT id, gm_committed_generation_id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`).get(campaignId) as {
        id: number;
        gm_committed_generation_id: string;
      }
    ).id;
    await assert.rejects(() => regenerateTrpgNarration(db, { campaignId, userId: 1, deps }), /확정된 결과와 맞지 않아/);
    assert.equal(getPointBalanceOnDb(db, 1).total, afterRewrite);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.currentNarration, rewritten);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.gmNarrationDraft, null);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.narrationRerolling, false);
    assert.equal(snapshotDuringReject?.round.phase, "ACTION_INPUT");
    assert.equal(snapshotDuringReject?.gmNarrationDraft, null);
    assert.equal(snapshotDuringReject?.narrationRerolling, true);
    assert.match(draftDuringReject ?? "", /서하가 장부를 가져갔다/);
    assert.equal(loadGmNarrationDraft(db, roundId), null);
    const committed = (
      db.prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE id=?`).get(roundId) as {
        gm_committed_generation_id: string;
      }
    ).gm_committed_generation_id;
    const rerollUsage = loadRerollUsageEntries(db, roundId);
    assert.equal(rerollUsage.length, 1);
    assert.notEqual(rerollUsage[0]?.generationId, committed);
    assert.equal(loadBillableRerollUsage(db, roundId, committed).length, 0);
    db.close();
  });
});
