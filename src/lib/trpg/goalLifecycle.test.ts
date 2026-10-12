import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { computeTrpgRoundPoints, TRPG_GM_USAGE_FALLBACK } from "./billing";
import { loadCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { buildCampaignMemoryPrompt, buildTrpgBotMemoryBlock } from "./memory";
import type { TrpgScenarioEncounter } from "./scenarioPlan";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";

/**
 * #1541 goal lifecycle: one authored/GM goal at the start, a server-verified completion from an approved
 * move or an approved scenario encounter end, and the next state seen identically by the GM prompt, the AI
 * companion prompt and the snapshot. GM claims, removals, rolls and narrated moves never complete a goal.
 */

const LIGHTHOUSE = "곶 끝의 등대";
const OPENING_GOAL = "등대의 비밀을 밝힌다";
const SPOILER_GOAL = "세관장이 밀수의 주범임을 폭로한다";
const SECRET = "세관장이 밀수의 주범이다";
const ENDING = "밀수 장부를 공개한다";
const GUARD: TrpgScenarioEncounter = {
  id: "enc_watch",
  name: "등대 감시자",
  kind: "enemy",
  damageClass: "MEDIUM",
  activateRound: 1,
  maxStrikes: 6,
  hitDc: 10,
  location: LIGHTHOUSE,
};
const PLAN = {
  startingSituation: "항구에 도착한다",
  centralConflict: "사라진 어선",
  goal: `${SPOILER_GOAL}. 증거는 장부에 있다.`,
  secret: SECRET,
  endingConditions: [ENDING],
  encounters: [GUARD],
};
const REAL_R0_QUEST = {
  id: "q_marenor_start",
  title: "마레노 탐색",
  desc: "해무로 뒤덮인 항구도시 마레노의 상황을 파악하고 단서를 확보하라.",
};
const REAL_R0_QUEST_STRING = "마레노 탐색: 해무로 뒤덮인 항구도시 마레노의 상황을 파악하고 단서를 확보하라.";
const REACH_GOAL = "등대로 가서 상황을 살핀다";
const REACH = { type: "reach_location", place: LIGHTHOUSE };

type Captured = { info: unknown[][]; warn: unknown[][] };
async function capture<T>(run: () => Promise<T>): Promise<{ result: T; logs: Captured }> {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const logs: Captured = { info: [], warn: [] };
  console.info = (...args: unknown[]) => {
    logs.info.push(args);
  };
  console.warn = (...args: unknown[]) => {
    logs.warn.push(args);
  };
  try {
    return { result: await run(), logs };
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id INTEGER NOT NULL, name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', secret_content TEXT NOT NULL DEFAULT '',
      trpg_enabled INTEGER NOT NULL DEFAULT 0, trpg_visibility TEXT NOT NULL DEFAULT 'private',
      genres TEXT NOT NULL DEFAULT '[]', cover_url TEXT NOT NULL DEFAULT '',
      shared_from_nickname TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','렌',5000)`).run();
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (2,'b@t','현',5000)`).run();
  ensureTrpgTables(db);
  return db;
}

function scenarioCampaign(
  db: Database.Database,
  opts?: { plan?: boolean; startLocation?: string; planOverride?: Partial<typeof PLAN> }
) {
  const templateId = insertScenarioTemplate(db, 7, {
    title: "마레노",
    summary: "해무의 항구",
    content: "항구도시에서 사건을 쫓는다.",
    visibility: "public",
    startLocation: opts?.startLocation ?? "마레노 부두",
    ...(opts?.plan === false ? {} : { scenarioPlan: { ...PLAN, ...opts?.planOverride } }),
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=?`).get(campaignId) as { id: number }).id;
  return { campaignId, hostId };
}

function worldOnlyCampaign(db: Database.Database) {
  db.prepare(
    `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility)
     VALUES (2, '마레노', '해무의 항구', '항구도시에서 사건을 쫓는다.', 1, 'public')`
  ).run();
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, worldId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=?`).get(campaignId) as { id: number }).id;
  return { campaignId, hostId };
}

type Step = { location: string; seats?: Record<number, string>; extra?: Record<string, unknown> };

function scriptedGm(everyone: () => number[], steps: Step[], seen?: string[]) {
  let call = 0;
  return {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({ text: "조용히 주변을 살핀다." }),
    gmCall: async (args: { user: string }) => {
      seen?.push(args.user);
      const step = steps[Math.min(call, steps.length - 1)]!;
      call += 1;
      return {
        text: buildTrpgGmStructuredWireText("해무가 짙게 깔린 장면이 이어진다. GM: 무엇을 하겠는가.", {
          players: everyone().map((participantId) => ({
            participantId,
            location: step.seats?.[participantId] ?? step.location,
          })),
          location: step.location,
          next_round_context: "",
          campaign_finished: false,
          ...step.extra,
        }),
      };
    },
  } satisfies TrpgEngineDeps;
}

const goalsOf = (db: Database.Database, campaignId: number) => loadCampaignLedger(db, campaignId).goals;
const byTitle = (db: Database.Database, campaignId: number, title: string) =>
  goalsOf(db, campaignId).find((goal) => goal.title === title);
const storedGoalsJson = (db: Database.Database, campaignId: number) =>
  (db.prepare(`SELECT goals_json FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as {
    goals_json: string | null;
  }).goals_json;

async function play(
  db: Database.Database,
  campaignId: number,
  deps: TrpgEngineDeps,
  body: string,
  userId = 1
) {
  submitTrpgAction(db, { campaignId, userId, body, actionType: "free" });
  return advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

describe("goal lifecycle: first goal", () => {
  it("world-only start: the one existing opening GM call is asked for a goal and the real R0 object becomes the active goal", async () => {
    const db = memoryDb();
    const { campaignId } = worldOnlyCampaign(db);
    const seen: string[] = [];
    const deps = scriptedGm(
      () => [],
      [{ location: "마레노 부두", extra: { questsAdd: [REAL_R0_QUEST], flagsAdd: ["arrived_at_marenor"] } }],
      seen
    );
    const snapshot = await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(seen.length, 1, "no extra provider call");
    assert.match(seen[0]!, /\[OPENING SCENE[^\]]*record it in delta\.questsAdd as a short player-visible goal \(the PC need not accept it\)/);
    const goals = goalsOf(db, campaignId);
    assert.equal(goals.length, 1);
    assert.equal(goals[0]!.title, REAL_R0_QUEST_STRING);
    assert.equal(goals[0]!.source, "gm");
    assert.equal(goals[0]!.status, "active");
    assert.equal(goals[0]!.criterion, undefined);
    assert.deepEqual(snapshot.goals?.map((goal) => goal.title), [REAL_R0_QUEST_STRING]);
    db.close();
  });

  it("world-only start where the GM gives no goal: no goal is invented, and the defect is logged", async () => {
    const db = memoryDb();
    const { campaignId } = worldOnlyCampaign(db);
    const deps = scriptedGm(() => [], [{ location: "마레노 부두" }]);
    const { result: snapshot, logs } = await capture(() => startTrpgCampaign(db, { campaignId, userId: 1, deps }));
    assert.deepEqual(goalsOf(db, campaignId), []);
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, []);
    assert.deepEqual(snapshot.goals, []);
    assert.ok(logs.warn.some((line) => line[0] === "[TRPG][goal] missing_after_opening"));
    db.close();
  });
});

describe("goal lifecycle: server-verified completion", () => {
  async function started(extra?: Record<string, unknown>, steps: Step[] = []) {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db);
    const deps = scriptedGm(() => [hostId], [
      { location: "마레노 부두", extra: { questsAdd: [OPENING_GOAL, { title: REACH_GOAL, criterion: REACH }], ...extra } },
      ...steps,
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    return { db, campaignId, hostId, deps };
  }

  it("a GM-proposed reach_location goal is stored with its criterion and is not complete at creation", async () => {
    const { db, campaignId } = await started();
    const goal = byTitle(db, campaignId, REACH_GOAL)!;
    assert.equal(goal.status, "active");
    assert.deepEqual(goal.criterion, REACH);
    assert.equal(goal.source, "gm");
    db.close();
  });

  it("an approved explicit move to the place completes it; the goal leaves the active list and the next state is consistent everywhere", async () => {
    const { db, campaignId, hostId } = await started(undefined, [
      { location: LIGHTHOUSE },
      { location: LIGHTHOUSE, extra: { questsAdd: ["등대 안쪽 조사"] } },
    ]);
    const deps = scriptedGm(() => [hostId], [
      { location: LIGHTHOUSE },
      { location: LIGHTHOUSE, extra: { questsAdd: ["등대 안쪽 조사"] } },
    ]);
    const { logs } = await capture(() => play(db, campaignId, deps, "곶 끝의 등대로 이동한다."));
    const done = byTitle(db, campaignId, REACH_GOAL)!;
    assert.equal(done.status, "completed");
    assert.equal(done.evidence?.kind, "reach_location");
    assert.equal(done.evidence?.kind === "reach_location" ? done.evidence.participantId : null, hostId);
    assert.equal(done.closedRound, 1);
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [OPENING_GOAL], "completed goal is no longer an active goal");
    assert.equal(byTitle(db, campaignId, OPENING_GOAL)!.status, "active", "the narrative plan goal is untouched");
    assert.ok(logs.info.some((line) => line[0] === "[TRPG][goal] lifecycle"));

    const gmPrompt = buildCampaignMemoryPrompt(db, campaignId);
    assert.match(gmPrompt, new RegExp(`goals_done: ${REACH_GOAL}`));
    assert.match(gmPrompt, new RegExp(`quests: ${OPENING_GOAL}\\n`));
    const botBlock = buildTrpgBotMemoryBlock({ ledger: loadCampaignLedger(db, campaignId), sheets: [] });
    assert.match(botBlock, new RegExp(`goals_done: ${REACH_GOAL}`));
    const snapshot = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.deepEqual(
      snapshot.goals?.map((goal) => [goal.title, goal.status]),
      [
        [OPENING_GOAL, "active"],
        [REACH_GOAL, "completed"],
      ]
    );

    await play(db, campaignId, deps, "등대 안쪽을 살핀다.");
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [OPENING_GOAL, "등대 안쪽 조사"], "the GM can offer the next goal; none is invented");
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "completed", "a completed goal stays completed");
    db.close();
  });

  it("a GM that only narrates the move, a move to a look-alike place, and an unrelated move complete nothing", async () => {
    const { db, campaignId, hostId } = await started();
    const gmOnly = scriptedGm(() => [hostId], [{ location: LIGHTHOUSE }]);
    await play(db, campaignId, gmOnly, "부두 게시판을 살핀다.");
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "active", "GM placement without a declared move");
    assert.notEqual(loadCampaignLedger(db, campaignId).location, LIGHTHOUSE);

    const lookAlike = scriptedGm(() => [hostId], [{ location: "등대 마을" }]);
    await play(db, campaignId, lookAlike, "등대 마을로 이동한다.");
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "active", "a different place with a similar name");

    const elsewhere = scriptedGm(() => [hostId], [{ location: "마레노 어시장" }]);
    await play(db, campaignId, elsewhere, "마레노 어시장으로 이동한다.");
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "active");
    assert.equal(goalsOf(db, campaignId).filter((goal) => goal.status === "completed").length, 0);
    db.close();
  });

  it("a place that is already true when the goal is created never completes it by staying; the criterion is dropped", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db, { startLocation: LIGHTHOUSE });
    const deps = scriptedGm(() => [hostId], [
      { location: LIGHTHOUSE, extra: { questsAdd: [{ title: REACH_GOAL, criterion: REACH }] } },
      { location: LIGHTHOUSE },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.criterion, undefined);
    await play(db, campaignId, deps, "등대 안을 살핀다.");
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "active");
    db.close();
  });

  it("an approved scenario encounter end completes an end_encounter goal; a GM proposal outside the threat's place does not", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db);
    const title = "등대 감시자를 물리친다";
    const deps = scriptedGm(() => [hostId], [
      { location: "마레노 부두", extra: { questsAdd: [{ title, criterion: { type: "end_encounter", encounterId: "enc_watch" } }] } },
      { location: "마레노 부두", extra: { encountersEnded: ["enc_watch"] } },
      { location: LIGHTHOUSE },
      { location: LIGHTHOUSE },
      { location: LIGHTHOUSE, extra: { encountersEnded: ["enc_watch"] } },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(byTitle(db, campaignId, title)!.criterion, { type: "end_encounter", encounterId: "enc_watch" });

    await play(db, campaignId, deps, "부두를 살핀다.");
    assert.equal(byTitle(db, campaignId, title)!.status, "active", "GM proposed the end, but the party is not where the threat is");

    await play(db, campaignId, deps, "곶 끝의 등대로 이동한다.");
    await play(db, campaignId, deps, "등대 안을 살핀다.");
    assert.equal(byTitle(db, campaignId, title)!.status, "active", "the threat still stands: no end was proposed or approved");

    await play(db, campaignId, deps, "감시자와 맞선다.");
    const done = byTitle(db, campaignId, title)!;
    assert.equal(done.status, "completed");
    assert.deepEqual(done.evidence, { kind: "end_encounter", round: 4, encounterId: "enc_watch" });
    assert.ok(!loadCampaignLedger(db, campaignId).quests.includes(title));
    db.close();
  });

  it("an end_encounter criterion naming a threat the scenario does not define is dropped; no threat is invented for a world-only start", async () => {
    const db = memoryDb();
    const { campaignId } = worldOnlyCampaign(db);
    const deps = scriptedGm(() => [], [
      {
        location: "마레노 부두",
        extra: { questsAdd: [{ title: "감시자를 쓰러뜨린다", criterion: { type: "end_encounter", encounterId: "enc_ghost" } }] },
      },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const goal = byTitle(db, campaignId, "감시자를 쓰러뜨린다")!;
    assert.equal(goal.status, "active");
    assert.equal(goal.criterion, undefined);
    db.close();
  });
});

describe("goal lifecycle: narrative goals are never confirmed by the model", () => {
  it("a GM resolution claim is kept as an unverified claim; removal retires without credit; a successful roll changes nothing", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db);
    const deps = scriptedGm(() => [hostId], [
      { location: "마레노 부두", extra: { questsAdd: ["밀수꾼의 정체를 알아낸다", "등대지기를 찾는다"] } },
      { location: "마레노 부두", extra: { questsClaimDone: ["밀수꾼의 정체를 알아낸다"] } },
      { location: "마레노 부두", extra: { questsRemove: ["등대지기를 찾는다"] } },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await play(db, campaignId, deps, "부두 사람들에게 밀수꾼에 대해 묻는다.");
    const claimed = byTitle(db, campaignId, "밀수꾼의 정체를 알아낸다")!;
    assert.equal(claimed.status, "active", "a claim never completes");
    assert.equal(claimed.claimedRound, 1);
    assert.equal(claimed.evidence, undefined);
    assert.ok(loadCampaignLedger(db, campaignId).quests.includes("밀수꾼의 정체를 알아낸다"));
    assert.match(buildCampaignMemoryPrompt(db, campaignId), /goals_claimed_unverified: 밀수꾼의 정체를 알아낸다/);
    assert.equal(
      loadTrpgSnapshot(db, campaignId, 1)!.goals?.find((goal) => goal.title === "밀수꾼의 정체를 알아낸다")?.claimed,
      true
    );

    await play(db, campaignId, deps, "등대지기를 찾아 나선다는 소문을 낸다.");
    const removed = byTitle(db, campaignId, "등대지기를 찾는다")!;
    assert.equal(removed.status, "retired", "questsRemove is not a completion");
    assert.equal(removed.evidence, undefined);
    assert.ok(!loadCampaignLedger(db, campaignId).quests.includes("등대지기를 찾는다"));
    assert.ok(!buildCampaignMemoryPrompt(db, campaignId).includes("goals_done"));
    assert.equal(goalsOf(db, campaignId).filter((goal) => goal.status === "completed").length, 0);
    db.close();
  });
});

describe("goal lifecycle: stored data compatibility", () => {
  it("an existing row of plain quest strings loads as unverified active goals, never as completed, and stays readable", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db, { plan: false });
    const deps = scriptedGm(() => [hostId], [{ location: "마레노 부두" }, { location: "마레노 부두" }]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    db.prepare(`UPDATE trpg_campaign_state SET quests_json=?, goals_json=NULL WHERE campaign_id=?`).run(
      JSON.stringify(["저장된 옛 퀘스트", "또 다른 옛 퀘스트"]),
      campaignId
    );
    const loaded = goalsOf(db, campaignId);
    assert.deepEqual(loaded.map((goal) => [goal.title, goal.status, goal.source, goal.criterion, goal.evidence]), [
      ["저장된 옛 퀘스트", "active", "legacy", undefined, undefined],
      ["또 다른 옛 퀘스트", "active", "legacy", undefined, undefined],
    ]);
    assert.equal(storedGoalsJson(db, campaignId), null, "loading does not rewrite the row");
    assert.equal(
      JSON.stringify(goalsOf(db, campaignId).map((goal) => goal.id)),
      JSON.stringify(loaded.map((goal) => goal.id)),
      "ids are stable across loads"
    );
    await play(db, campaignId, deps, "부두를 살핀다.");
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, ["저장된 옛 퀘스트", "또 다른 옛 퀘스트"]);
    assert.deepEqual(goalsOf(db, campaignId).map((goal) => goal.id), loaded.map((goal) => goal.id));
    assert.deepEqual(JSON.parse(storedGoalsJson(db, campaignId)!).version, 1);
    db.close();
  });

  it("an old database without goals_json gets the column on upgrade and keeps every existing row", () => {
    const db = memoryDb();
    const { campaignId } = scenarioCampaign(db, { plan: false });
    db.prepare(`UPDATE trpg_campaign_state SET quests_json=? WHERE campaign_id=?`).run(JSON.stringify(["옛 퀘스트"]), campaignId);
    db.exec(`ALTER TABLE trpg_campaign_state DROP COLUMN goals_json`);
    const before = { ...(db.prepare(`SELECT * FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as Record<string, unknown>) };
    ensureTrpgTables(db);
    ensureTrpgTables(db);
    const after = { ...(db.prepare(`SELECT * FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as Record<string, unknown>) };
    const dataColumns = (row: Record<string, unknown>) => {
      const { goals_json: _goals, _metadata: _meta, ...rest } = row;
      return rest;
    };
    assert.deepEqual(dataColumns(after), dataColumns(before));
    assert.equal(after.goals_json, null);
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, ["옛 퀘스트"]);
    db.close();
  });

  it("rollback to the old build and re-upgrade: removed goals retire without credit, added strings become goals, untouched goals keep their criterion and still complete", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db);
    const deps = scriptedGm(() => [hostId], [
      {
        location: "마레노 부두",
        extra: { questsAdd: [OPENING_GOAL, { title: REACH_GOAL, criterion: REACH }, "자유 목표"] },
      },
      { location: LIGHTHOUSE },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const idsBefore = goalsOf(db, campaignId).map((goal) => [goal.id, goal.title]);

    const readQuests = () =>
      JSON.parse(
        (db.prepare(`SELECT quests_json FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as { quests_json: string })
          .quests_json
      ) as string[];
    const oldBuildWrite = (next: string[]) =>
      db.prepare(`UPDATE trpg_campaign_state SET quests_json=? WHERE campaign_id=?`).run(JSON.stringify(next), campaignId);

    oldBuildWrite(readQuests());
    assert.deepEqual(goalsOf(db, campaignId).map((goal) => [goal.id, goal.title]), idsBefore, "rollback with no old-build write loses nothing");

    oldBuildWrite([...readQuests().filter((title) => title !== "자유 목표"), "옛 빌드가 추가한 퀘스트"]);
    const reupgraded = goalsOf(db, campaignId);
    const free = reupgraded.find((goal) => goal.title === "자유 목표")!;
    assert.equal(free.status, "retired");
    assert.equal(free.evidence, undefined, "an old-build removal is not a completion");
    const added = reupgraded.find((goal) => goal.title === "옛 빌드가 추가한 퀘스트")!;
    assert.equal(added.status, "active");
    assert.equal(added.source, "legacy");
    assert.equal(added.criterion, undefined);
    const criterionGoal = reupgraded.find((goal) => goal.title === REACH_GOAL)!;
    assert.deepEqual(criterionGoal.criterion, REACH);
    assert.equal(criterionGoal.id, idsBefore.find(([, title]) => title === REACH_GOAL)![0]);
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [OPENING_GOAL, REACH_GOAL, "옛 빌드가 추가한 퀘스트"]);

    await play(db, campaignId, deps, "곶 끝의 등대로 이동한다.");
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "completed");
    assert.deepEqual(readQuests(), [OPENING_GOAL, "옛 빌드가 추가한 퀘스트"], "projection written by the same commit");
    assert.equal(byTitle(db, campaignId, "자유 목표")!.status, "retired");
    db.close();
  });
});

describe("goal lifecycle: 2 humans + 2 AI companions", () => {
  async function party() {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db);
    const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string })
      .invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "현" });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "현", stats: EVEN_STATS });
    const human2 = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=2`).get(campaignId) as { id: number }).id;
    const ai: number[] = [];
    for (const [slot, name] of [[2, "서하"], [3, "도윤"]] as const) {
      const id = insertParticipant(db, {
        campaignId,
        slotIndex: slot,
        kind: "ai_character",
        userId: null,
        characterId: null,
        displayName: name,
      });
      writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
      ai.push(id);
    }
    return { db, campaignId, hostId, human2, ai, everyone: [hostId, human2, ...ai] };
  }

  it("only a human seat's own approved arrival completes the goal: an AI companion's move, a stay-behind and GM group placement do not", async () => {
    const { db, campaignId, hostId, human2, ai, everyone } = await party();
    let botTurn = 0;
    const aiBodies = new Map<number, string>([
      [ai[0]!, "곶 끝의 등대로 이동한다."],
      [ai[1]!, "부두에 남아 짐을 지킨다."],
    ]);
    const make = (steps: Step[]) => {
      const deps = scriptedGm(() => everyone, steps);
      deps.botCall = async () => {
        const seat = ai[botTurn % ai.length]!;
        botTurn += 1;
        return { text: aiBodies.get(seat) ?? "주변을 살핀다." };
      };
      return deps;
    };
    const opening = make([
      { location: "마레노 부두", extra: { questsAdd: [{ title: REACH_GOAL, criterion: REACH }] } },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: opening });

    const aiOnly = make([{ location: LIGHTHOUSE, seats: { [hostId]: "마레노 부두", [human2]: "마레노 부두" } }]);
    submitTrpgAction(db, { campaignId, userId: 1, body: "부두 게시판을 살핀다.", actionType: "free" });
    submitTrpgAction(db, { campaignId, userId: 2, body: "부두를 살핀다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: aiOnly });
    const sheetLocation = (id: number) =>
      (db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(id) as { location: string }).location;
    assert.equal(sheetLocation(ai[0]!), LIGHTHOUSE, "the AI companion really did arrive");
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "active", "an AI companion arriving is not a player's move");

    const humanMoves = make([{ location: LIGHTHOUSE, seats: { [human2]: "마레노 부두", [ai[1]!]: "마레노 부두" } }]);
    submitTrpgAction(db, { campaignId, userId: 1, body: "곶 끝의 등대로 이동한다.", actionType: "free" });
    submitTrpgAction(db, { campaignId, userId: 2, body: "부두를 살핀다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: humanMoves });
    const done = byTitle(db, campaignId, REACH_GOAL)!;
    assert.equal(done.status, "completed");
    assert.equal(done.evidence?.kind === "reach_location" ? done.evidence.participantId : null, hostId);
    assert.equal(sheetLocation(human2), "마레노 부두", "the other human did not move");
    db.close();
  });
});

describe("goal lifecycle: retry, regeneration and duplicate commit", () => {
  it("regeneration after completion neither re-applies nor undoes it", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db);
    const deps = scriptedGm(() => [hostId], [
      { location: "마레노 부두", extra: { questsAdd: [OPENING_GOAL, { title: REACH_GOAL, criterion: REACH }] } },
      { location: LIGHTHOUSE },
      { location: "마레노 어시장", extra: { questsAdd: ["재생성이 만든 목표"], questsRemove: [OPENING_GOAL] } },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await play(db, campaignId, deps, "곶 끝의 등대로 이동한다.");
    const before = { goals: goalsOf(db, campaignId), json: storedGoalsJson(db, campaignId) };
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "completed");
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    assert.deepEqual(goalsOf(db, campaignId), before.goals);
    assert.equal(storedGoalsJson(db, campaignId), before.json);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(goalsOf(db, campaignId).filter((goal) => goal.title === REACH_GOAL).length, 1);
    db.close();
  });

  it("a billing fault then retry completes the goal once, bills once and never recalls the GM", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT NOT NULL, points REAL NOT NULL DEFAULT 0, creator_points REAL NOT NULL DEFAULT 0);
      CREATE TABLE point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
      CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', creator_id INTEGER, official INTEGER NOT NULL DEFAULT 0);
    `);
    db.prepare(`INSERT INTO users (id, email, nickname, points, creator_points) VALUES (1,'a@t','렌',0,0)`).run();
    ensureTrpgTables(db);
    const { campaignId, hostId } = scenarioCampaign(db);
    const usage = () => ({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: TRPG_GM_USAGE_FALLBACK.inputTokens,
      outputTokens: TRPG_GM_USAGE_FALLBACK.outputTokens,
    });
    let gmCalls = 0;
    const base = scriptedGm(() => [hostId], [
      { location: "마레노 부두", extra: { questsAdd: [{ title: REACH_GOAL, criterion: REACH }] } },
      { location: LIGHTHOUSE },
    ]);
    const mode = (fault?: TrpgEngineDeps["billingFault"]): TrpgEngineDeps => ({
      ...base,
      skipBilling: false,
      billingFault: fault,
      gmCall: async (args) => {
        gmCalls += 1;
        return { ...(await base.gmCall(args)), usage: usage() };
      },
    });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: { ...mode(), skipBilling: true } });
    creditPointsWithIds(db, 1, computeTrpgRoundPoints([usage()]) + 200, "PAID", "test-credit-PAID");
    const before = getPointBalanceOnDb(db, 1).total;
    submitTrpgAction(db, { campaignId, userId: 1, body: "곶 끝의 등대로 이동한다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: mode("billing_persist") });
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "active", "the faulted commit rolled the completion back");
    assert.equal(getPointBalanceOnDb(db, 1).total, before);
    const callsAfterFault = gmCalls;
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: mode() });
    assert.equal(gmCalls, callsAfterFault);
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "completed");
    const charged = before - getPointBalanceOnDb(db, 1).total;
    assert.ok(charged > 0);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: mode() });
    assert.equal(before - getPointBalanceOnDb(db, 1).total, charged, "no second charge");
    assert.equal(goalsOf(db, campaignId).filter((goal) => goal.status === "completed").length, 1);
    db.close();
  });
});

const NEXT_GOAL = "등대 안쪽을 조사한다";
const FILLERS = Array.from({ length: 11 }, (_, index) => `보조 목표 ${index + 1}`);

describe("goal lifecycle: same-round precedence", () => {
  const activeTitles = (db: Database.Database, campaignId: number) => loadCampaignLedger(db, campaignId).quests;

  it("a verified arrival frees its slot for the next goal the GM adds in the same output, at the 12-goal cap", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db, { plan: false });
    const deps = scriptedGm(() => [hostId], [
      { location: "마레노 부두", extra: { questsAdd: [...FILLERS, { title: REACH_GOAL, criterion: REACH }] } },
      { location: LIGHTHOUSE, extra: { questsAdd: [NEXT_GOAL] } },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(activeTitles(db, campaignId).length, 12);

    const { logs } = await capture(() => play(db, campaignId, deps, "곶 끝의 등대로 이동한다."));
    assert.equal(byTitle(db, campaignId, REACH_GOAL)!.status, "completed");
    assert.equal(byTitle(db, campaignId, NEXT_GOAL)!.status, "active", "the next goal is not lost to the cap");
    assert.equal(activeTitles(db, campaignId).length, 12, "the cap still holds");
    assert.deepEqual(activeTitles(db, campaignId), [...FILLERS, NEXT_GOAL]);
    assert.ok(!logs.info.some((line) => line[0] === "[TRPG][gm] quest_add_capped"), "nothing was dropped, so nothing is reported dropped");
    assert.deepEqual(JSON.parse(storedGoalsJson(db, campaignId)!).goals.map((goal: { title: string }) => goal.title).includes(NEXT_GOAL), true);
    db.close();
  });

  it("a goal added past the cap with no slot freed is still dropped and reported, and no goal is replaced", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db, { plan: false });
    const deps = scriptedGm(() => [hostId], [
      { location: "마레노 부두", extra: { questsAdd: [...FILLERS, { title: REACH_GOAL, criterion: REACH }] } },
      { location: "마레노 부두", extra: { questsAdd: [NEXT_GOAL] } },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const { logs } = await capture(() => play(db, campaignId, deps, "부두를 살핀다."));
    assert.equal(byTitle(db, campaignId, NEXT_GOAL), undefined);
    assert.equal(activeTitles(db, campaignId).length, 12);
    assert.deepEqual(
      logs.info.find((line) => line[0] === "[TRPG][gm] quest_add_capped")?.[1],
      { dropped: 1, max: 12 }
    );
    db.close();
  });

  it("a GM questsRemove in the same round cannot undo a server-verified arrival", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db, { plan: false });
    const deps = scriptedGm(() => [hostId], [
      { location: "마레노 부두", extra: { questsAdd: [{ title: REACH_GOAL, criterion: REACH }] } },
      { location: LIGHTHOUSE, extra: { questsRemove: [REACH_GOAL] } },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await play(db, campaignId, deps, "곶 끝의 등대로 이동한다.");
    const done = byTitle(db, campaignId, REACH_GOAL)!;
    assert.equal(done.status, "completed");
    assert.equal(done.evidence?.kind, "reach_location");
    assert.match(buildCampaignMemoryPrompt(db, campaignId), new RegExp(`goals_done: ${REACH_GOAL}`));
    db.close();
  });

  it("an accepted encounter end, a GM removal and the next goal land in one commit, at the cap", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = scenarioCampaign(db, { planOverride: { goal: "" } });
    const title = "등대 감시자를 물리친다";
    const deps = scriptedGm(() => [hostId], [
      {
        location: "마레노 부두",
        extra: { questsAdd: [...FILLERS, { title, criterion: { type: "end_encounter", encounterId: "enc_watch" } }] },
      },
      { location: "마레노 부두" },
      { location: LIGHTHOUSE },
      { location: LIGHTHOUSE },
      { location: LIGHTHOUSE, extra: { encountersEnded: ["enc_watch"], questsRemove: [title], questsAdd: [NEXT_GOAL] } },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(activeTitles(db, campaignId).length, 12);
    await play(db, campaignId, deps, "부두를 살핀다.");
    await play(db, campaignId, deps, "곶 끝의 등대로 이동한다.");
    await play(db, campaignId, deps, "등대 안을 살핀다.");
    assert.equal(byTitle(db, campaignId, title)!.status, "active");

    await play(db, campaignId, deps, "감시자와 맞선다.");
    assert.equal(byTitle(db, campaignId, title)!.status, "completed");
    assert.deepEqual(byTitle(db, campaignId, title)!.evidence, { kind: "end_encounter", round: 4, encounterId: "enc_watch" });
    assert.equal(byTitle(db, campaignId, NEXT_GOAL)!.status, "active");
    assert.deepEqual(activeTitles(db, campaignId), [...FILLERS, NEXT_GOAL]);
    const stored = JSON.parse(storedGoalsJson(db, campaignId)!).goals as Array<{ title: string; status: string }>;
    assert.deepEqual(
      stored.filter((goal) => goal.status === "active").map((goal) => goal.title),
      activeTitles(db, campaignId),
      "goals_json and quests_json come from the same commit"
    );
    db.close();
  });
});

describe("goal lifecycle: a GM-only plan goal is not a player-visible goal", () => {
  it("a scenario whose plan.goal states a twist never shows that sentence; the goal comes from the opening GM output", async () => {
    const db = memoryDb();
    const { campaignId } = scenarioCampaign(db);
    const seen: string[] = [];
    const deps = scriptedGm(() => [], [{ location: "마레노 부두", extra: { questsAdd: ["부두의 소문을 들어 본다"] } }], seen);
    const snapshot = await startTrpgCampaign(db, { campaignId, userId: 1, deps });

    for (const hidden of [SECRET, ENDING, "enc_watch", "reach_location"]) {
      assert.ok(!JSON.stringify(snapshot).includes(hidden), `snapshot must not contain ${hidden}`);
    }
    for (const surface of [
      JSON.stringify(snapshot),
      JSON.stringify(loadCampaignLedger(db, campaignId)),
      buildCampaignMemoryPrompt(db, campaignId),
      buildTrpgBotMemoryBlock({ ledger: loadCampaignLedger(db, campaignId), sheets: [] }),
    ]) {
      assert.ok(!surface.includes(SPOILER_GOAL), "the revealing plan sentence must not become a player-visible goal");
    }
    assert.deepEqual(snapshot.goals?.map((goal) => goal.title), ["부두의 소문을 들어 본다"]);
    assert.match(seen[0]!, /record it in delta\.questsAdd/, "a scenario opening asks the existing R0 call for the goal, too");
    db.close();
  });
});
