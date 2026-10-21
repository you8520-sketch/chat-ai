import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { computeTrpgRoundPoints, TRPG_GM_USAGE_FALLBACK } from "./billing";
import { loadCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { serializeCampaignDirectorInstructions, serializeDirectorDeltaContract } from "./campaignContext";
import { parseTrpgGmOutput, TRPG_GM_SYSTEM } from "./gmPrompt";
import { serializeLocalSceneDeltaContract } from "./localSceneProgress";
import { buildCampaignMemoryPrompt, buildTrpgBotMemoryBlock } from "./memory";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { TRPG_LEDGER_ITEM_MAX_CHARS, TRPG_LEDGER_QUEST_MAX } from "./types";

/**
 * #1541 PR-1: a GM-emitted `{id, title, desc}` quest object must reach the same `string[]` ledger a plain
 * string quest does. Quest fields below are copied verbatim from the real Phase 2 world free-play run
 * (evidence commit 6286462762408bb6f03c1f3561bb0754942e00d7, call-01 / call-02 raw GM responses).
 */

const REAL_R0_QUEST = {
  id: "q_marenor_start",
  title: "마레노 탐색",
  desc: "해무로 뒤덮인 항구도시 마레노의 상황을 파악하고 단서를 확보하라.",
};
const REAL_R0_QUEST_STRING = "마레노 탐색: 해무로 뒤덮인 항구도시 마레노의 상황을 파악하고 단서를 확보하라.";
const REAL_R1_QUEST = "실종된 어선들과 이상한 등대의 비밀 조사";

function wire(delta: Record<string, unknown>): string {
  return JSON.stringify({
    narration: "해무가 짙게 깔린 부두의 장면이 이어진다. GM: 무엇을 하겠는가.",
    delta: { players: [], location: "마레노 부두", next_round_context: "", campaign_finished: false, ...delta },
  });
}

function parseQuests(questsAdd: unknown, extra: Record<string, unknown> = {}) {
  return parseTrpgGmOutput(wire({ questsAdd, ...extra }));
}

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

describe("quest add normalization at the GM parser (#1541 PR-1)", () => {
  it("real R0: the {id,title,desc} object is kept as the existing one-line string; sibling fields are untouched", () => {
    const parsed = parseQuests([REAL_R0_QUEST], { flagsAdd: ["arrived_at_marenor"], storyPhase: "도입" });
    assert.deepEqual(parsed.delta.questsAdd, [REAL_R0_QUEST_STRING]);
    assert.ok(Array.from(REAL_R0_QUEST_STRING).length <= TRPG_LEDGER_ITEM_MAX_CHARS);
    assert.deepEqual(parsed.delta.flagsAdd, ["arrived_at_marenor"]);
    assert.equal(parsed.delta.storyPhase, "도입");
    assert.equal(parsed.diagnostics, undefined);
  });

  it("real R1: a plain string quest is unchanged", () => {
    const parsed = parseQuests([REAL_R1_QUEST]);
    assert.deepEqual(parsed.delta.questsAdd, [REAL_R1_QUEST]);
    assert.equal(parsed.diagnostics, undefined);
  });

  it("mixed strings and objects keep their order; id and status are never stored", () => {
    const parsed = parseQuests([
      "밀서 찾기",
      { id: "q2", title: "등대 조사", status: "done" },
      REAL_R0_QUEST,
      { title: "  공백   정리  ", desc: "  두 줄\n설명  " },
    ]);
    assert.deepEqual(parsed.delta.questsAdd, [
      "밀서 찾기",
      "등대 조사",
      REAL_R0_QUEST_STRING,
      "공백 정리: 두 줄 설명",
    ]);
  });

  it("an object without a usable title is rejected and counted; valid siblings still pass", () => {
    const parsed = parseQuests([
      { id: "q1", desc: "제목 없음" },
      { title: "", desc: "빈 제목" },
      { title: "   " },
      { title: 42 },
      { title: ["배열"] },
      42,
      null,
      true,
      ["중첩"],
      "",
      "   ",
      "유효한 퀘스트",
    ]);
    assert.deepEqual(parsed.delta.questsAdd, ["유효한 퀘스트"]);
    assert.deepEqual(parsed.diagnostics, { questsAddRejected: 11 });
  });

  it("a non-array quest field is rejected as one item; an all-invalid list stores nothing", () => {
    assert.equal(parseQuests("밀서 찾기").delta.questsAdd, undefined);
    assert.deepEqual(parseQuests("밀서 찾기").diagnostics, { questsAddRejected: 1 });
    const none = parseQuests([{ id: "x" }, 7]);
    assert.equal(none.delta.questsAdd, undefined);
    assert.deepEqual(none.diagnostics, { questsAddRejected: 2 });
    assert.equal(parseQuests([]).diagnostics, undefined);
    assert.equal(parseTrpgGmOutput(wire({})).diagnostics, undefined);
  });

  it("desc is kept only while the whole line fits the ledger limit; the title is clipped to it", () => {
    const max = TRPG_LEDGER_ITEM_MAX_CHARS;
    const line = (descLength: number) => `제목: ${"나".repeat(descLength)}`;
    const descFor = (descLength: number) => "나".repeat(descLength);
    assert.equal(Array.from(line(max - 4)).length, max);
    assert.deepEqual(parseQuests([{ title: "제목", desc: descFor(max - 4) }]).delta.questsAdd, [line(max - 4)]);
    assert.deepEqual(parseQuests([{ title: "제목", desc: descFor(max - 3) }]).delta.questsAdd, ["제목"]);
    assert.deepEqual(parseQuests([{ title: "가".repeat(200), desc: "설명" }]).delta.questsAdd, ["가".repeat(max)]);
    assert.deepEqual(parseQuests([{ title: "제목", desc: 7 }]).delta.questsAdd, ["제목"]);
    assert.deepEqual(parseQuests([{ title: "제목", desc: "   " }]).delta.questsAdd, ["제목"]);
  });

  it("the legacy `quests` alias accepts the same shapes", () => {
    const parsed = parseTrpgGmOutput(wire({ quests: [REAL_R0_QUEST] }));
    assert.deepEqual(parsed.delta.questsAdd, [REAL_R0_QUEST_STRING]);
  });

  it("questsRemove stays an exact-string contract: objects and ids are not interpreted", () => {
    const parsed = parseTrpgGmOutput(
      wire({ questsRemove: ["밀서 찾기", { id: "q_marenor_start" }, 3, "q_marenor_start"] })
    );
    assert.deepEqual(parsed.delta.questsRemove, ["밀서 찾기", "q_marenor_start"]);
  });
});

describe("GM delta contract wording (#1541 PR-1)", () => {
  it("names the quest shape in one place, and no injected owner still names the retired <<<DELTA>>> wire", () => {
    assert.equal((TRPG_GM_SYSTEM.match(/questsAdd items are player-visible goals/g) ?? []).length, 1);
    const injected = [
      TRPG_GM_SYSTEM,
      serializeCampaignDirectorInstructions(true),
      serializeDirectorDeltaContract({ storyPhase: "INTRO" }),
      serializeLocalSceneDeltaContract(),
    ].join("\n");
    assert.doesNotMatch(injected, /<<<DELTA>>>|<<<NARRATION>>>/);
    assert.equal((injected.match(/\[DIRECTOR DELTA CONTRACT\]/g) ?? []).length, 1);
    assert.equal((injected.match(/"questsAdd":\[\]/g) ?? []).length, 1);
    assert.match(injected, /always include storyPhase\. The current phase is INTRO\. Keep it, or move to DEVELOPMENT only when/);
    assert.match(injected, /Include threadsAdd, threadsResolve, and endingConditionId when they apply/);
    assert.match(injected, /The resolved action and server facts in this input are the evidence; the round count never is/);
    assert.match(injected, /does not forbid another questsAdd when this scene creates a distinct new player-visible purpose/);
    assert.doesNotMatch(injected, /leave it empty while a player goal is already active/);
    assert.doesNotMatch(injected, /Judge that situation/);
    assert.doesNotMatch(injected, /Soft hint only/);
  });
});

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','렌',5000)`).run();
  ensureTrpgTables(db);
  return db;
}

function setup(db: Database.Database) {
  const templateId = insertScenarioTemplate(db, 7, {
    title: "마레노",
    summary: "해무의 항구",
    content: "항구도시에서 사건을 쫓는다.",
    visibility: "public",
    startLocation: "마레노 부두",
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=?`).get(campaignId) as { id: number }).id;
  return { campaignId, hostId };
}

function scriptedQuests(hostId: number, steps: Array<Record<string, unknown>>) {
  let call = 0;
  return {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({ text: "조용히 주변을 살핀다." }),
    gmCall: async (_args?: unknown) => {
      const step = steps[Math.min(call, steps.length - 1)]!;
      call += 1;
      return {
        text: wire({
          players: [{ participantId: hostId, location: "마레노 부두" }],
          location: "마레노 부두",
          ...step,
        }),
      };
    },
  } satisfies TrpgEngineDeps;
}

const roundNumberRow = (db: Database.Database, campaignId: number, n: number) =>
  db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`).get(campaignId, n) as { id: number };

describe("quest objects through the real engine path (#1541 PR-1)", () => {
  it("real R0 object quest persists, reloads, and reaches GM and bot memory; real R1 string quest is appended", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const deps = scriptedQuests(hostId, [
      { questsAdd: [REAL_R0_QUEST], flagsAdd: ["arrived_at_marenor"] },
      { questsAdd: [REAL_R1_QUEST], flagsAdd: ["learned_missing_ships"] },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const afterR0 = loadCampaignLedger(db, campaignId);
    assert.deepEqual(afterR0.quests, [REAL_R0_QUEST_STRING]);
    const stored = db.prepare(`SELECT quests_json FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as {
      quests_json: string;
    };
    assert.deepEqual(JSON.parse(stored.quests_json), [REAL_R0_QUEST_STRING], "storage format stays string[]");
    assert.match(buildCampaignMemoryPrompt(db, campaignId), new RegExp(`quests: ${REAL_R0_QUEST_STRING}`));
    const botBlock = buildTrpgBotMemoryBlock({ ledger: afterR0, sheets: [] });
    assert.match(botBlock, new RegExp(`quests: ${REAL_R0_QUEST_STRING}`));

    submitTrpgAction(db, { campaignId, userId: 1, body: "부두 노인에게 말을 건다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [REAL_R0_QUEST_STRING, REAL_R1_QUEST]);
    assert.match(
      buildCampaignMemoryPrompt(db, campaignId),
      new RegExp(`quests: ${REAL_R0_QUEST_STRING}; ${REAL_R1_QUEST}`)
    );
    db.close();
  });

  it("rejected quest items log a count only, never the raw title or description", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const deps = scriptedQuests(hostId, [
      { questsAdd: [{ id: "비밀아이디", desc: "비밀설명" }, 7, REAL_R0_QUEST] },
    ]);
    const { lines } = await captureInfo(() => startTrpgCampaign(db, { campaignId, userId: 1, deps }));
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [REAL_R0_QUEST_STRING]);
    const rejected = lines.find((l) => l[0] === "[TRPG][gm] quest_add_rejected");
    assert.deepEqual(rejected?.[1], { count: 2 });
    const printed = JSON.stringify(lines);
    assert.doesNotMatch(printed, /비밀아이디|비밀설명|마레노 탐색/);
    db.close();
  });

  it("a new quest past the 12-quest cap is dropped as before but is now observable; nothing existing is replaced", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const full = Array.from({ length: TRPG_LEDGER_QUEST_MAX }, (_, i) => `기존 퀘스트 ${i + 1}`);
    const deps = scriptedQuests(hostId, [{ questsAdd: full }, { questsAdd: [REAL_R0_QUEST, "또 하나"] }]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "부두를 살핀다.", actionType: "free" });
    const { lines } = await captureInfo(() => advanceTrpgCampaign(db, { campaignId, userId: 1, deps }));
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, full);
    const capped = lines.find((l) => l[0] === "[TRPG][gm] quest_add_capped");
    assert.deepEqual(capped?.[1], { dropped: 2, max: TRPG_LEDGER_QUEST_MAX });
    db.close();
  });

  it("exact-string removal frees a slot for a new object quest; near-text removal changes nothing", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const deps = scriptedQuests(hostId, [
      { questsAdd: [REAL_R0_QUEST] },
      { questsRemove: ["마레노 탐색"] },
      { questsRemove: [REAL_R0_QUEST_STRING], questsAdd: [{ title: "새 목표" }] },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "부두를 살핀다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [REAL_R0_QUEST_STRING]);
    submitTrpgAction(db, { campaignId, userId: 1, body: "부두를 더 살핀다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, ["새 목표"]);
    db.close();
  });

  it("an existing saved row of plain strings loads and merges unchanged", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const deps = scriptedQuests(hostId, [{}, { questsAdd: [REAL_R0_QUEST] }]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    db.prepare(`UPDATE trpg_campaign_state SET quests_json=? WHERE campaign_id=?`).run(
      JSON.stringify(["저장된 옛 퀘스트", REAL_R1_QUEST]),
      campaignId
    );
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, ["저장된 옛 퀘스트", REAL_R1_QUEST]);
    submitTrpgAction(db, { campaignId, userId: 1, body: "부두를 살핀다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [
      "저장된 옛 퀘스트",
      REAL_R1_QUEST,
      REAL_R0_QUEST_STRING,
    ]);
    db.close();
  });

  it("regeneration of an accepted round does not duplicate the object quest or change the ledger", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const deps = scriptedQuests(hostId, [{}, { questsAdd: [REAL_R0_QUEST] }, { questsAdd: [REAL_R0_QUEST] }]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "부두를 살핀다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const before = loadCampaignLedger(db, campaignId);
    assert.deepEqual(before.quests, [REAL_R0_QUEST_STRING]);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignLedger(db, campaignId), before);
    db.close();
  });

  it("a billing fault then retry stores the object quest once, bills once and never recalls the GM", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT NOT NULL, points REAL NOT NULL DEFAULT 0, creator_points REAL NOT NULL DEFAULT 0);
      CREATE TABLE point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
      CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', creator_id INTEGER, official INTEGER NOT NULL DEFAULT 0);
    `);
    db.prepare(`INSERT INTO users (id, email, nickname, points, creator_points) VALUES (1,'a@t','렌',0,0)`).run();
    ensureTrpgTables(db);
    const { campaignId, hostId } = setup(db);
    const usage = () => ({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: TRPG_GM_USAGE_FALLBACK.inputTokens,
      outputTokens: TRPG_GM_USAGE_FALLBACK.outputTokens,
    });
    let gmCalls = 0;
    const base = scriptedQuests(hostId, [{}, { questsAdd: [REAL_R0_QUEST] }]);
    const play = (fault?: TrpgEngineDeps["billingFault"]): TrpgEngineDeps => ({
      ...base,
      skipBilling: false,
      billingFault: fault,
      gmCall: async (args) => {
        gmCalls += 1;
        return { ...(await base.gmCall(args)), usage: usage() };
      },
    });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: { ...play(), skipBilling: true } });
    creditPointsWithIds(db, 1, computeTrpgRoundPoints([usage()]) + 200, "PAID", "test-credit-PAID");
    const before = getPointBalanceOnDb(db, 1).total;
    submitTrpgAction(db, { campaignId, userId: 1, body: "부두를 살핀다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: play("billing_persist") });
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [], "the faulted commit rolled back");
    assert.equal(getPointBalanceOnDb(db, 1).total, before);
    const callsAfterFault = gmCalls;
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: play() });
    assert.equal(gmCalls, callsAfterFault, "retry commits the pending GM result without a provider call");
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [REAL_R0_QUEST_STRING]);
    const row = db
      .prepare(`SELECT billed, billed_points FROM trpg_rounds WHERE id=?`)
      .get(roundNumberRow(db, campaignId, 1).id) as { billed: number; billed_points: number };
    assert.equal(row.billed, 1);
    const charged = before - getPointBalanceOnDb(db, 1).total;
    assert.equal(charged, row.billed_points);
    assert.ok(charged > 0);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: play() });
    assert.equal(before - getPointBalanceOnDb(db, 1).total, charged, "no second charge");
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [REAL_R0_QUEST_STRING]);
    db.close();
  });
});
