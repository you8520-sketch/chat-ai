import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { applyGoalTransition, type PlaceMatcher, type TrpgGoal } from "./campaignGoals";
import { loadCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { parseTrpgGmOutput } from "./gmPrompt";
import { buildCampaignMemoryPrompt, buildTrpgBotMemoryBlock } from "./memory";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";

/**
 * Free-narrative goal claims. The model's real outputs (fixtures/freeGoalClaimReal.json, unmodified text)
 * are the inputs; the goal state must keep a GM resolution proposal whether or not the same output also
 * removes the goal, and a claim never completes anything.
 */

const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/lib/trpg/fixtures/freeGoalClaimReal.json"), "utf8")
) as { goalTitle: string; A_R0_raw: string; A_R2_raw: string; B_R2_raw: string };
const TITLE = FIXTURE.goalTitle;
const NEXT_TITLE = "곶 끝 등대 또는 세관 기록 조사: 실종 당일 해오라기호와 세관 감시정의 접촉 흔적을 찾는다";
const exact: PlaceMatcher = (place, location) => place === location;

function goal(partial: Partial<TrpgGoal> & Pick<TrpgGoal, "id" | "title">): TrpgGoal {
  return { status: "active", source: "gm", createdRound: 0, ...partial };
}

function withSeat(raw: string, seatId: number): string {
  const parsed = JSON.parse(raw) as { delta: { players?: Array<{ participantId: number }> } };
  for (const patch of parsed.delta.players ?? []) patch.participantId = seatId;
  return JSON.stringify(parsed);
}

function rawGm(texts: string[], seatId: number): TrpgEngineDeps {
  let call = 0;
  return {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({ text: "조용히 주변을 살핀다." }),
    gmCall: async () => {
      const text = texts[Math.min(call, texts.length - 1)]!;
      call += 1;
      return { text: withSeat(text, seatId) };
    },
  };
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0);`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','렌',5000)`).run();
  ensureTrpgTables(db);
  return db;
}

function scenarioCampaign(db: Database.Database) {
  const templateId = insertScenarioTemplate(db, 7, {
    title: "안개항 실종 사건",
    summary: "해무의 항구",
    content: "항구도시에서 사라진 어선을 쫓는다.",
    visibility: "public",
    startLocation: "마레노 부두",
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const hostSeat = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=?`).get(campaignId) as { id: number }).id;
  return { campaignId, hostSeat };
}

async function playRound(db: Database.Database, campaignId: number, deps: TrpgEngineDeps, body: string) {
  submitTrpgAction(db, { campaignId, userId: 1, body, actionType: "free" });
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

const goalsOf = (db: Database.Database, campaignId: number) => loadCampaignLedger(db, campaignId).goals;
const titleOf = (goals: readonly TrpgGoal[], title: string) => goals.find((item) => item.title === title);

describe("free goal claim: real model outputs through the goal transition", () => {
  const a = parseTrpgGmOutput(FIXTURE.A_R2_raw).delta;
  const b = parseTrpgGmOutput(FIXTURE.B_R2_raw).delta;
  const opening = [goal({ id: "goal-0-1", title: TITLE })];

  it("the fixtures are the real outputs: A claims, removes and adds in one output; B does none of them", () => {
    assert.deepEqual(a.questsClaimDone, [TITLE]);
    assert.deepEqual(a.questsRemove, [TITLE]);
    assert.deepEqual(a.questsAdd, [NEXT_TITLE]);
    assert.equal(b.questsClaimDone, undefined);
    assert.equal(b.questsRemove, undefined);
    assert.equal(b.questsAdd, undefined);
  });

  it("A: claim + remove of the same goal keeps it active and awaiting confirmation, and the next goal is registered", () => {
    const next = applyGoalTransition(opening, a, { round: 2, placeMatches: exact }).goals;
    const old = titleOf(next, TITLE)!;
    assert.equal(old.status, "active");
    assert.equal(old.claimedRound, 2);
    assert.equal(old.closedRound, undefined);
    assert.equal(old.evidence, undefined, "a claim is not a completion");
    assert.equal(titleOf(next, NEXT_TITLE)?.status, "active");
  });

  it("B: a clue-only output leaves the goal active with no claim", () => {
    const next = applyGoalTransition(opening, b, { round: 2, placeMatches: exact }).goals;
    assert.deepEqual(next, opening);
  });

  it("remove alone retires without credit; claim alone stays active and pending", () => {
    const removed = applyGoalTransition(opening, { questsRemove: [TITLE] }, { round: 2, placeMatches: exact }).goals[0]!;
    assert.equal(removed.status, "retired");
    assert.equal(removed.claimedRound, undefined);
    assert.equal(removed.evidence, undefined);
    const claimed = applyGoalTransition(opening, { questsClaimDone: [TITLE] }, { round: 2, placeMatches: exact }).goals[0]!;
    assert.equal(claimed.status, "active");
    assert.equal(claimed.claimedRound, 2);
  });

  it("a server-verified completion still wins over a claim + remove of the same goal in the same round", () => {
    const reach = goal({ id: "goal-0-1", title: TITLE, criterion: { type: "reach_location", place: "곶 끝의 등대" } });
    const facts = {
      round: 2,
      seats: [{ participantId: 1, human: true, startLocation: "마레노 부두", endLocation: "곶 끝의 등대" }],
      authoredEncounterIds: [],
      endedEncounterIds: [],
      acceptedEncounterIds: [],
    };
    const next = applyGoalTransition([reach], a, { round: 2, facts, placeMatches: exact }).goals;
    const done = titleOf(next, TITLE)!;
    assert.equal(done.status, "completed");
    assert.equal(done.evidence?.kind, "reach_location");
    assert.equal(titleOf(next, NEXT_TITLE)?.status, "active");
  });

  it("at 12 active goals a claim + remove frees no slot: the new goal is dropped and counted, nothing is replaced", () => {
    const twelve = Array.from({ length: 12 }, (_, index) =>
      goal({ id: `goal-0-${index + 1}`, title: index === 0 ? TITLE : `보조 ${index}` })
    );
    const next = applyGoalTransition(twelve, a, { round: 2, placeMatches: exact });
    assert.equal(titleOf(next.goals, TITLE)?.status, "active");
    assert.equal(titleOf(next.goals, TITLE)?.claimedRound, 2);
    assert.equal(titleOf(next.goals, NEXT_TITLE), undefined);
    assert.equal(next.addsDroppedAtCap, 1);
    assert.equal(next.goals.filter((item) => item.status === "active").length, 12);

    const removeOnly = applyGoalTransition(twelve, { questsRemove: [TITLE], questsAdd: [NEXT_TITLE] }, { round: 2, placeMatches: exact });
    assert.equal(titleOf(removeOnly.goals, NEXT_TITLE)?.status, "active", "a plain removal still frees its slot");
    assert.equal(removeOnly.addsDroppedAtCap, 0);
  });

  it("removal stays an exact clipped-title match: a different title is not removed by a claim of another goal", () => {
    const two = [goal({ id: "goal-0-1", title: TITLE }), goal({ id: "goal-0-2", title: "다른 목표" })];
    const next = applyGoalTransition(two, { questsClaimDone: [TITLE], questsRemove: ["다른 목표"] }, { round: 2, placeMatches: exact }).goals;
    assert.equal(titleOf(next, TITLE)?.status, "active");
    assert.equal(titleOf(next, TITLE)?.claimedRound, 2);
    assert.equal(titleOf(next, "다른 목표")?.status, "retired");
  });
});

describe("free goal claim: through the real engine commit path", () => {
  it("A: the real R0 goal, then the real claim + remove + add output: the goal is kept pending and every reader agrees", async () => {
    const db = memoryDb();
    const { campaignId, hostSeat } = scenarioCampaign(db);
    const deps = rawGm([FIXTURE.A_R0_raw, FIXTURE.A_R2_raw], hostSeat);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(titleOf(goalsOf(db, campaignId), TITLE)?.status, "active");
    await playRound(db, campaignId, deps, "원로 선원에게 해오라기호의 마지막 기적에 대해 묻는다.");

    const goals = goalsOf(db, campaignId);
    assert.equal(titleOf(goals, TITLE)?.status, "active");
    assert.equal(titleOf(goals, TITLE)?.claimedRound, 1);
    assert.equal(titleOf(goals, NEXT_TITLE)?.status, "active");
    const ledger = loadCampaignLedger(db, campaignId);
    assert.deepEqual(ledger.quests, [TITLE, NEXT_TITLE], "quests_json projects the same active titles");
    assert.match(buildCampaignMemoryPrompt(db, campaignId), new RegExp(`goals_claimed_unverified: ${TITLE}`));
    assert.match(buildTrpgBotMemoryBlock({ ledger, sheets: [] }), new RegExp(`goals_claimed_unverified: ${TITLE}`));
    const snapshot = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(snapshot.goals?.find((item) => item.title === TITLE)?.claimed, true);
    assert.equal(snapshot.goals?.find((item) => item.title === NEXT_TITLE)?.claimed, false);
    assert.ok(!snapshot.goals?.some((item) => item.status === "completed"));
    db.close();
  });

  it("B: the real R0 goal, then the real clue-only output: the goal stays active and unclaimed", async () => {
    const db = memoryDb();
    const { campaignId, hostSeat } = scenarioCampaign(db);
    const deps = rawGm([FIXTURE.A_R0_raw, FIXTURE.B_R2_raw], hostSeat);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await playRound(db, campaignId, deps, "아내가 전한 말을 수첩에 적고 부두 사람들에게 더 묻는다.");
    const goals = goalsOf(db, campaignId);
    assert.deepEqual(goals.map((item) => [item.title, item.status, item.claimedRound ?? null]), [[TITLE, "active", null]]);
    assert.ok(!buildCampaignMemoryPrompt(db, campaignId).includes("goals_claimed_unverified"));
    db.close();
  });
});
