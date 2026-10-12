import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import {
  CampaignGoalsConflictError,
  applyCampaignLedger,
  loadCampaignLedger,
  loadStoredGoalsJson,
  persistCampaignLedger,
  persistGoalsIfUnchanged,
  settleLedgerForCommit,
} from "./campaignLedger";
import { goalCompletionBasis, parseGoalsJson, serializeGoals, type TrpgGoal } from "./campaignGoals";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import {
  TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE,
  TRPG_GOAL_HOST_ONLY_MESSAGE,
  answerTrpgGoalClaim,
  type TrpgGoalClaimDecision,
} from "./goalConfirm";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { parseTrpgGmOutput } from "./gmPrompt";
import { goalClaimItems } from "@/app/trpg/goalClaimView";
import { buildCampaignMemoryPrompt, buildTrpgBotMemoryBlock } from "./memory";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";

/**
 * Host answers to a GM resolution proposal. The proposal is the real Gemini claim + remove + add output
 * (fixtures/freeGoalClaimReal.json). Completion by the host is a separate, labelled kind of completion; no
 * answer, retry, reroll or concurrent write may lose, duplicate or invent one.
 */

const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/lib/trpg/fixtures/freeGoalClaimReal.json"), "utf8")
) as { goalTitle: string; A_R0_raw: string; A_R2_raw: string };
const TITLE = FIXTURE.goalTitle;
const NEXT_TITLE = "곶 끝 등대 또는 세관 기록 조사: 실종 당일 해오라기호와 세관 감시정의 접촉 흔적을 찾는다";
const REAL_A = parseTrpgGmOutput(FIXTURE.A_R2_raw);

function claimText(everyone: number[], extra: Record<string, unknown> = {}, narration = REAL_A.narration): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: everyone.map((participantId) => ({ participantId, location: "마레노 부두" })),
    location: "마레노 부두",
    next_round_context: "",
    campaign_finished: false,
    questsAdd: REAL_A.delta.questsAdd,
    questsRemove: REAL_A.delta.questsRemove,
    questsClaimDone: REAL_A.delta.questsClaimDone,
    ...extra,
  });
}

function plainText(everyone: number[], extra: Record<string, unknown> = {}, narration = "해무가 짙게 깔린 부두의 장면이 이어진다. GM: 무엇을 하겠는가?") {
  return buildTrpgGmStructuredWireText(narration, {
    players: everyone.map((participantId) => ({ participantId, location: "마레노 부두" })),
    location: "마레노 부두",
    next_round_context: "",
    campaign_finished: false,
    ...extra,
  });
}

function gm(texts: Array<() => string>): TrpgEngineDeps {
  let call = 0;
  return {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({ text: "조용히 주변을 살핀다." }),
    gmCall: async () => {
      const make = texts[Math.min(call, texts.length - 1)]!;
      call += 1;
      return { text: make() };
    },
  };
}

function seedUsers(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
  `);
  for (const [id, nickname] of [[1, "렌"], [2, "현"], [3, "외부"]] as const) {
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (?,?,?,0)`).run(id, `${id}@t`, nickname);
    creditPointsWithIds(db, id, 5000, "PAID", `goal-confirm-credit-${id}`);
  }
  ensureTrpgTables(db);
}

function createParty(db: Database.Database) {
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
  const ai: number[] = [];
  for (const [slot, name] of [[2, "서하"], [3, "도윤"]] as const) {
    const id = insertParticipant(db, { campaignId, slotIndex: slot, kind: "ai_character", userId: null, characterId: null, displayName: name });
    writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
    ai.push(id);
  }
  const hostSeat = seat(1);
  const humanSeat = seat(2);
  return { campaignId, hostSeat, humanSeat, ai, everyone: [hostSeat, humanSeat, ...ai] };
}

async function round(db: Database.Database, campaignId: number, deps: TrpgEngineDeps) {
  submitTrpgAction(db, { campaignId, userId: 1, body: "원로 선원에게 해오라기호의 마지막 기적에 대해 묻는다.", actionType: "free" });
  submitTrpgAction(db, { campaignId, userId: 2, body: "부두를 살핀다.", actionType: "free" });
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

/** R0 = the real opening (real goal), R1 = the real claim + remove + add output. */
async function claimedParty(db: Database.Database) {
  seedUsers(db);
  const party = createParty(db);
  const opening = parseTrpgGmOutput(FIXTURE.A_R0_raw);
  const deps = gm([
    () =>
      plainText(party.everyone, { questsAdd: opening.delta.questsAdd }, opening.narration),
    () => claimText(party.everyone),
    () => plainText(party.everyone, { questsAdd: ["다음 단서 추적"] }),
  ]);
  await startTrpgCampaign(db, { campaignId: party.campaignId, userId: 1, deps });
  await round(db, party.campaignId, deps);
  return { ...party, deps };
}

const goalsOf = (db: Database.Database, campaignId: number) => loadCampaignLedger(db, campaignId).goals;
const goalByTitle = (db: Database.Database, campaignId: number, title: string) =>
  goalsOf(db, campaignId).find((goal) => goal.title === title);
const storedProjection = (db: Database.Database, campaignId: number) => {
  const row = db.prepare(`SELECT quests_json, goals_json FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as {
    quests_json: string;
    goals_json: string;
  };
  return { quests_json: row.quests_json, goals_json: row.goals_json };
};
const answer = (
  db: Database.Database,
  campaignId: number,
  userId: number,
  decision: TrpgGoalClaimDecision,
  over: { goalId?: string; claimedRound?: number } = {}
) => {
  const goal = goalByTitle(db, campaignId, TITLE)!;
  return answerTrpgGoalClaim(db, {
    campaignId,
    userId,
    decision,
    goalId: over.goalId ?? goal.id,
    claimedRound: over.claimedRound ?? goal.claimedRound!,
  });
};

const viewerCards = (db: Database.Database, campaignId: number, userId: number) => {
  const snapshot = loadTrpgSnapshot(db, campaignId, userId)!;
  return goalClaimItems(snapshot.goals, snapshot.viewerIsHost);
};

/** The host clears a proposal that lost its source; nobody else can, and the goal stays active. */
async function assertHostClearsStaleProposal(db: Database.Database, campaignId: number) {
  const projectionBefore = storedProjection(db, campaignId);
  const hostCards = viewerCards(db, campaignId, 1);
  assert.deepEqual(hostCards.map((card) => [card.mode, card.actions.map((action) => action.decision)]), [["stale", ["decline"]]]);
  assert.deepEqual(viewerCards(db, campaignId, 2).map((card) => [card.mode, card.actions.length]), [["readonly", 0]]);

  assert.throws(() => answer(db, campaignId, 2, "decline"), { message: TRPG_GOAL_HOST_ONLY_MESSAGE });
  assert.throws(() => answer(db, campaignId, 1, "confirm"), { message: TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE });
  assert.equal(goalByTitle(db, campaignId, TITLE)?.status, "active");

  const [card] = hostCards;
  const request = { campaignId, userId: 1, goalId: card.goalId, claimedRound: card.claimedRound, decision: "decline" as const };
  assert.equal(answerTrpgGoalClaim(db, request).outcome, "declined");
  assert.equal(answerTrpgGoalClaim(db, request).outcome, "already_declined", "a double click is a no-op");

  const cleared = goalByTitle(db, campaignId, TITLE)!;
  assert.equal(cleared.status, "active", "the goal stays active");
  assert.equal(cleared.evidence, undefined, "clearing never records a completion");
  for (const userId of [1, 2]) assert.deepEqual(viewerCards(db, campaignId, userId), [], "the waiting card is gone for everyone");
  assert.deepEqual(JSON.parse(storedProjection(db, campaignId).quests_json), JSON.parse(projectionBefore.quests_json), "active titles unchanged");
  assert.ok(!buildCampaignMemoryPrompt(db, campaignId).includes("goals_claimed_unverified"));
}

describe("host confirmation: the proposal and who can see and answer it", () => {
  it("the real claim is stored with the committed message it came from; the host sees it answerable, another human only sees it proposed", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    const goal = goalByTitle(db, campaignId, TITLE)!;
    assert.equal(goal.status, "active");
    assert.equal(goal.claimedRound, 1);
    assert.ok(goal.claimSource?.generationId && goal.claimSource.narrationDigest.length === 32);
    const host = loadTrpgSnapshot(db, campaignId, 1)!.goals!.find((item) => item.title === TITLE)!;
    assert.deepEqual([host.claimed, host.claimedRound, host.confirmable], [true, 1, true]);
    const other = loadTrpgSnapshot(db, campaignId, 2)!.goals!.find((item) => item.title === TITLE)!;
    assert.deepEqual([other.claimed, other.claimedRound, other.confirmable], [true, 1, undefined]);
    db.close();
  });

  it("confirm: completed with host_confirmed evidence naming the host seat; every reader agrees and nothing was billed or called", async () => {
    const db = new Database(":memory:");
    const { campaignId, hostSeat } = await claimedParty(db);
    const points = getPointBalanceOnDb(db, 1);
    const usageRows = () => (db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE usage_json IS NOT NULL OR gm_reroll_usage_json IS NOT NULL`).get() as { n: number }).n;
    const usageBefore = usageRows();
    const { outcome, campaign } = answer(db, campaignId, 1, "confirm");
    assert.equal(outcome, "confirmed");
    const goal = goalByTitle(db, campaignId, TITLE)!;
    assert.equal(goal.status, "completed");
    assert.deepEqual(goal.evidence, { kind: "host_confirmed", round: 1, participantId: hostSeat });
    assert.equal(goalCompletionBasis(goal), "host");
    assert.notEqual(goal.evidence?.kind, "reach_location");
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests, [NEXT_TITLE], "quests_json is the active projection");
    assert.deepEqual(JSON.parse(storedProjection(db, campaignId).quests_json), [NEXT_TITLE]);

    const gmPrompt = buildCampaignMemoryPrompt(db, campaignId);
    assert.match(gmPrompt, new RegExp(`goals_done: ${TITLE}`));
    assert.ok(!gmPrompt.includes("goals_claimed_unverified"));
    assert.match(buildTrpgBotMemoryBlock({ ledger: loadCampaignLedger(db, campaignId), sheets: [] }), new RegExp(`goals_done: ${TITLE}`));
    for (const snapshot of [campaign, loadTrpgSnapshot(db, campaignId, 2)!]) {
      const shown = snapshot.goals!.find((item) => item.title === TITLE)!;
      assert.deepEqual([shown.status, shown.claimed, shown.basis, shown.confirmable], ["completed", false, "host", undefined]);
    }
    assert.deepEqual(getPointBalanceOnDb(db, 1), points, "no billing");
    assert.equal(usageRows(), usageBefore, "no provider usage recorded");
    db.close();
  });

  it("the next round after a confirmation keeps it and the new goal", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone, deps } = await claimedParty(db);
    answer(db, campaignId, 1, "confirm");
    await round(db, campaignId, deps);
    assert.equal(goalByTitle(db, campaignId, TITLE)?.status, "completed");
    assert.equal(goalByTitle(db, campaignId, TITLE)?.evidence?.kind, "host_confirmed");
    assert.equal(goalByTitle(db, campaignId, "다음 단서 추적")?.status, "active");
    assert.equal(everyone.length, 4);
    db.close();
  });

  it("only the host answers: another human, a stranger and a missing campaign are refused and nothing changes", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    const before = storedProjection(db, campaignId);
    for (const userId of [2, 3]) {
      assert.throws(() => answer(db, campaignId, userId, "confirm"), { message: TRPG_GOAL_HOST_ONLY_MESSAGE });
      assert.throws(() => answer(db, campaignId, userId, "decline"), { message: TRPG_GOAL_HOST_ONLY_MESSAGE });
    }
    assert.throws(() => answerTrpgGoalClaim(db, { campaignId: 999, userId: 1, goalId: "x", claimedRound: 1, decision: "confirm" }), /찾을 수 없/);
    assert.deepEqual(storedProjection(db, campaignId), before);
    db.close();
  });

  it("a duplicate confirm is a no-op; a stale round, an unknown goal and a retired goal are refused", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    const goal = goalByTitle(db, campaignId, TITLE)!;
    assert.throws(() => answer(db, campaignId, 1, "confirm", { claimedRound: 7 }), /해결 제안이 바뀌었/);
    assert.throws(() => answer(db, campaignId, 1, "confirm", { goalId: "goal-9-9" }), /목표를 찾을 수 없/);
    answer(db, campaignId, 1, "confirm");
    const done = storedProjection(db, campaignId);
    assert.equal(answer(db, campaignId, 1, "confirm", { goalId: goal.id, claimedRound: 1 }).outcome, "already_confirmed");
    assert.deepEqual(storedProjection(db, campaignId), done, "byte-identical after the duplicate");
    assert.throws(() => answer(db, campaignId, 1, "decline", { goalId: goal.id, claimedRound: 1 }), /이미 닫힌/);
    const retired = goalByTitle(db, campaignId, NEXT_TITLE)!;
    db.prepare(`UPDATE trpg_campaign_state SET goals_json=? WHERE campaign_id=?`).run(
      serializeGoals(goalsOf(db, campaignId).map((item) => (item.id === retired.id ? { ...item, status: "retired" as const } : item))),
      campaignId
    );
    assert.throws(() => answer(db, campaignId, 1, "confirm", { goalId: retired.id, claimedRound: 1 }), /이미 닫힌/);
    db.close();
  });
});

describe("host confirmation: declining keeps the goal and a later claim is a new proposal", () => {
  it("decline keeps the goal active, stops the pending proposal everywhere, and a repeat is a no-op", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    assert.equal(answer(db, campaignId, 1, "decline").outcome, "declined");
    const goal = goalByTitle(db, campaignId, TITLE)!;
    assert.equal(goal.status, "active");
    assert.equal(goal.declinedRound, 1);
    assert.ok(!buildCampaignMemoryPrompt(db, campaignId).includes("goals_claimed_unverified"));
    const shown = loadTrpgSnapshot(db, campaignId, 1)!.goals!.find((item) => item.title === TITLE)!;
    assert.deepEqual([shown.status, shown.claimed, shown.confirmable], ["active", false, undefined]);
    assert.deepEqual(loadCampaignLedger(db, campaignId).quests.includes(TITLE), true);
    assert.equal(answer(db, campaignId, 1, "decline").outcome, "already_declined");
    assert.throws(() => answer(db, campaignId, 1, "confirm"), /해결 제안이 바뀌었/);
    db.close();
  });

  it("a claim in a later round re-opens the proposal with no cooldown, and the host can then confirm it", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = await claimedParty(db);
    answer(db, campaignId, 1, "decline");
    const deps = gm([() => claimText(everyone, { questsAdd: [], questsRemove: [] })]);
    await round(db, campaignId, deps);
    const goal = goalByTitle(db, campaignId, TITLE)!;
    assert.equal(goal.claimedRound, 2);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)!.goals!.find((item) => item.title === TITLE)!.confirmable, true);
    assert.equal(answer(db, campaignId, 1, "confirm").outcome, "confirmed");
    assert.equal(goalByTitle(db, campaignId, TITLE)?.evidence?.kind === "host_confirmed" ? goalByTitle(db, campaignId, TITLE)!.evidence!.round : null, 2);
    db.close();
  });
});

describe("host confirmation: a reroll that changes the GM's message invalidates the old claim", () => {
  it("a reroll without the claim: the proposal can no longer be confirmed; declining and a fresh claim still work", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = await claimedParty(db);
    const before = storedProjection(db, campaignId);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps: gm([() => plainText(everyone, {}, "다르게 쓰인 장면이다. GM: 무엇을 하겠는가?")]) });
    assert.deepEqual(storedProjection(db, campaignId), before, "a reroll never touches the ledger");
    const shown = loadTrpgSnapshot(db, campaignId, 1)!.goals!.find((item) => item.title === TITLE)!;
    assert.deepEqual([shown.claimed, shown.confirmable], [true, undefined]);
    assert.throws(() => answer(db, campaignId, 1, "confirm"), { message: TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE });
    assert.equal(goalByTitle(db, campaignId, TITLE)?.status, "active");
    assert.equal(answer(db, campaignId, 1, "decline").outcome, "declined");
    db.close();
  });

  it("a reroll that still names the goal but is a different generation and narration is not the claim that was recorded", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = await claimedParty(db);
    await regenerateTrpgNarration(db, {
      campaignId,
      userId: 1,
      deps: gm([() => claimText(everyone, {}, "같은 목표를 다시 해결했다고 쓰지만 다른 장면이다. GM: 무엇을 하겠는가?")]),
    });
    assert.throws(() => answer(db, campaignId, 1, "confirm"), { message: TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE });
    db.close();
  });

  it("a claim whose stored message no longer names the goal is refused even if generation and narration match", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    db.prepare(`UPDATE trpg_gm_messages SET structured_json=? WHERE round_id=(SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1)`).run(
      JSON.stringify({ delta: { questsClaimDone: [] } }),
      campaignId
    );
    assert.throws(() => answer(db, campaignId, 1, "confirm"), { message: TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE });
    db.close();
  });
});

describe("host confirmation: the host can clear a proposal that lost its source", () => {
  it("valid proposal: the host card offers confirm + decline, another human is read-only", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    assert.deepEqual(viewerCards(db, campaignId, 1).map((card) => [card.mode, card.actions.map((action) => action.decision)]), [["confirmable", ["confirm", "decline"]]]);
    assert.deepEqual(viewerCards(db, campaignId, 2).map((card) => [card.mode, card.actions.length]), [["readonly", 0]]);
    assert.equal(answer(db, campaignId, 1, "confirm").outcome, "confirmed");
    for (const userId of [1, 2]) assert.deepEqual(viewerCards(db, campaignId, userId), []);
    db.close();
  });

  it("after a reroll changed the GM message", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = await claimedParty(db);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps: gm([() => plainText(everyone, {}, "다르게 쓰인 장면이다. GM: 무엇을 하겠는가?")]) });
    await assertHostClearsStaleProposal(db, campaignId);
    db.close();
  });

  it("after a reroll that still names the goal but is a different generation", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = await claimedParty(db);
    await regenerateTrpgNarration(db, {
      campaignId,
      userId: 1,
      deps: gm([() => claimText(everyone, {}, "같은 목표를 다시 해결했다고 쓰지만 다른 장면이다. GM: 무엇을 하겠는가?")]),
    });
    await assertHostClearsStaleProposal(db, campaignId);
    db.close();
  });

  it("a later claim after clearing is a fresh, confirmable proposal (no cooldown)", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = await claimedParty(db);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps: gm([() => plainText(everyone, {}, "다르게 쓰인 장면이다. GM: 무엇을 하겠는가?")]) });
    assert.equal(answer(db, campaignId, 1, "decline").outcome, "declined");
    await round(db, campaignId, gm([() => claimText(everyone, {}, "해오라기호의 행방이 밝혀졌다. 다시 한번 해결을 알린다. GM: 무엇을 하겠는가?")]));
    assert.deepEqual(viewerCards(db, campaignId, 1).map((card) => card.mode), ["confirmable"]);
    db.close();
  });
});

describe("host confirmation: concurrency between the GM commit and the host", () => {
  function twoConnections() {
    const path = join(tmpdir(), `goal-host-confirm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const gmSide = new Database(path);
    gmSide.pragma("journal_mode = WAL");
    const hostSide = new Database(path);
    hostSide.pragma("journal_mode = WAL");
    const cleanup = () => {
      gmSide.close();
      hostSide.close();
      for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
    };
    return { gmSide, hostSide, cleanup };
  }

  it("a host confirmation written after the GM commit read the ledger and before it wrote is kept, and the GM's new goal is added", async () => {
    const { gmSide, hostSide, cleanup } = twoConnections();
    try {
      const { campaignId, everyone, deps } = await claimedParty(gmSide);
      const goal = goalByTitle(gmSide, campaignId, TITLE)!;
      let fired = false;
      let goalsReads = 0;
      const originalPrepare = gmSide.prepare.bind(gmSide);
      gmSide.prepare = ((sql: string) => {
        if (sql.includes("SELECT goals_json FROM trpg_campaign_state")) goalsReads += 1;
        if (!fired && goalsReads > 0 && sql.includes("SELECT round_number FROM trpg_rounds WHERE id=?")) {
          fired = true;
          const result = answerTrpgGoalClaim(hostSide, { campaignId, userId: 1, goalId: goal.id, claimedRound: 1, decision: "confirm" });
          assert.equal(result.outcome, "confirmed");
        }
        return originalPrepare(sql);
      }) as typeof gmSide.prepare;
      await round(gmSide, campaignId, deps);
      gmSide.prepare = originalPrepare as typeof gmSide.prepare;
      assert.ok(fired, "the host answer was interleaved inside the GM commit window");
      const done = goalByTitle(gmSide, campaignId, TITLE)!;
      assert.equal(done.status, "completed");
      assert.equal(done.evidence?.kind, "host_confirmed");
      assert.equal(goalByTitle(gmSide, campaignId, "다음 단서 추적")?.status, "active");
      assert.deepEqual(JSON.parse(storedProjection(gmSide, campaignId).quests_json), [NEXT_TITLE, "다음 단서 추적"]);
    } finally {
      cleanup();
    }
  });

  it("two connections answering the same proposal: one confirms, the other is a no-op, state is written once", async () => {
    const { gmSide, hostSide, cleanup } = twoConnections();
    try {
      const { campaignId } = await claimedParty(gmSide);
      const goal = goalByTitle(gmSide, campaignId, TITLE)!;
      const request = { campaignId, userId: 1, goalId: goal.id, claimedRound: 1, decision: "confirm" as const };
      const first = answerTrpgGoalClaim(gmSide, request).outcome;
      const second = answerTrpgGoalClaim(hostSide, request).outcome;
      assert.deepEqual([first, second], ["confirmed", "already_confirmed"]);
      assert.equal(goalsOf(gmSide, campaignId).filter((item) => item.status === "completed").length, 1);
    } finally {
      cleanup();
    }
  });

  it("settleLedgerForCommit recomputes from the stored state when the goal state moved, and not otherwise", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    const loaded = { ledger: loadCampaignLedger(db, campaignId), goalsJson: loadStoredGoalsJson(db, campaignId) };
    const delta = { questsAdd: ["새 목표"] };
    const apply = (current: ReturnType<typeof loadCampaignLedger>) => applyCampaignLedger(current, delta, { round: 5 });
    const computed = apply(loaded.ledger);
    const untouched = settleLedgerForCommit(db, campaignId, loaded, apply, computed);
    assert.equal(untouched.recomputed, false);
    assert.equal(untouched.ledger, computed);
    answer(db, campaignId, 1, "confirm");
    const moved = settleLedgerForCommit(db, campaignId, loaded, apply, computed);
    assert.equal(moved.recomputed, true);
    assert.equal(moved.ledger.goals.find((item) => item.title === TITLE)?.status, "completed");
    assert.ok(moved.ledger.goals.some((item) => item.title === "새 목표"));
    db.close();
  });

  it("a conditional write against a state that moved writes nothing and says so", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    const stale = loadStoredGoalsJson(db, campaignId);
    answer(db, campaignId, 1, "confirm");
    const after = storedProjection(db, campaignId);
    assert.equal(persistGoalsIfUnchanged(db, campaignId, stale, []), false);
    assert.throws(
      () => persistCampaignLedger(db, campaignId, 9, { ...loadCampaignLedger(db, campaignId), goals: [], quests: [] }, stale),
      CampaignGoalsConflictError
    );
    assert.deepEqual(storedProjection(db, campaignId), after);
    db.close();
  });
});

describe("host confirmation: server-verified completion stays separate and first", () => {
  it("a goal the server completed cannot be answered, and reports a server basis", () => {
    const db = new Database(":memory:");
    seedUsers(db);
    const { campaignId, hostSeat } = createParty(db);
    const goals: TrpgGoal[] = [
      {
        id: "goal-0-1",
        title: "등대로 간다",
        status: "completed",
        source: "gm",
        createdRound: 0,
        closedRound: 1,
        claimedRound: 1,
        evidence: { kind: "reach_location", round: 1, participantId: hostSeat, location: "곶 끝의 등대" },
      },
    ];
    db.prepare(`UPDATE trpg_campaign_state SET goals_json=?, quests_json='[]' WHERE campaign_id=?`).run(serializeGoals(goals), campaignId);
    assert.throws(() => answerTrpgGoalClaim(db, { campaignId, userId: 1, goalId: "goal-0-1", claimedRound: 1, decision: "confirm" }), /이미 닫힌/);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)!.goals![0]!.basis, "server");
    db.close();
  });
});

describe("host confirmation: rollback and re-upgrade", () => {
  /** Frozen copy of the field handling of `parseGoal` before host_confirmed existed (PR HEAD 67f3249d). */
  function olderBuildRewrite(raw: string): string {
    const parsed = JSON.parse(raw) as { version: number; goals: Array<Record<string, unknown>> };
    const goals = parsed.goals.map((item) => {
      const goal: Record<string, unknown> = {
        id: item.id,
        title: item.title,
        status: item.status,
        source: item.source === "gm" ? "gm" : "legacy",
        createdRound: item.createdRound,
      };
      for (const key of ["criterion", "claimedRound", "closedRound"]) if (item[key] !== undefined) goal[key] = item[key];
      const evidence = item.evidence as { kind?: string } | undefined;
      if (item.status === "completed" && (evidence?.kind === "reach_location" || evidence?.kind === "end_encounter")) {
        goal.evidence = evidence;
      }
      return goal;
    });
    return JSON.stringify({ version: parsed.version, goals });
  }

  it("data written before this change reads and upgrades cleanly (no claim fields, no evidence)", () => {
    const legacy = JSON.stringify({
      version: 1,
      goals: [{ id: "goal-0-1", title: TITLE, status: "active", source: "gm", createdRound: 0, claimedRound: 2 }],
    });
    const goals = parseGoalsJson(legacy)!;
    assert.equal(goals[0]!.claimedRound, 2);
    assert.equal(goals[0]!.claimSource, undefined);
  });

  it("host-confirmed completion -> an older build rewrites goals_json -> the new build: still completed, basis unrecorded, never shown as server- or host-verified", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    answer(db, campaignId, 1, "confirm");
    const raw = loadStoredGoalsJson(db, campaignId)!;
    assert.equal(JSON.parse(raw).version, 1, "the format version is unchanged");
    const rewritten = olderBuildRewrite(raw);
    assert.ok(!rewritten.includes("host_confirmed"));
    db.prepare(`UPDATE trpg_campaign_state SET goals_json=? WHERE campaign_id=?`).run(rewritten, campaignId);
    const goal = goalByTitle(db, campaignId, TITLE)!;
    assert.equal(goal.status, "completed");
    assert.equal(goal.claimedRound, 1);
    assert.equal(goal.evidence, undefined);
    assert.equal(goalCompletionBasis(goal), "unrecorded");
    const shown = loadTrpgSnapshot(db, campaignId, 1)!.goals!.find((item) => item.title === TITLE)!;
    assert.deepEqual([shown.status, shown.basis], ["completed", "unrecorded"]);
    assert.match(buildCampaignMemoryPrompt(db, campaignId), new RegExp(`goals_done: ${TITLE}`));
    db.close();
  });

  it("a pending proposal an older build rewrote has lost its source: it stays visible as proposed but can never be confirmed, only answered no", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    db.prepare(`UPDATE trpg_campaign_state SET goals_json=? WHERE campaign_id=?`).run(
      olderBuildRewrite(loadStoredGoalsJson(db, campaignId)!),
      campaignId
    );
    const shown = loadTrpgSnapshot(db, campaignId, 1)!.goals!.find((item) => item.title === TITLE)!;
    assert.deepEqual([shown.claimed, shown.confirmable], [true, undefined]);
    assert.throws(() => answer(db, campaignId, 1, "confirm"), { message: TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE });
    assert.equal(answer(db, campaignId, 1, "decline").outcome, "declined");
    db.close();
  });

  it("a proposal an older build re-saved without claimSource is shown to the host as clearable and cleared without completing", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    db.prepare(`UPDATE trpg_campaign_state SET goals_json=? WHERE campaign_id=?`).run(
      olderBuildRewrite(loadStoredGoalsJson(db, campaignId)!),
      campaignId
    );
    await assertHostClearsStaleProposal(db, campaignId);
    db.close();
  });

  it("rollback to the production build, which writes only quests_json, then re-upgrade: the completion and its evidence are intact", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    answer(db, campaignId, 1, "confirm");
    const before = goalByTitle(db, campaignId, TITLE)!;
    db.prepare(`UPDATE trpg_campaign_state SET quests_json=? WHERE campaign_id=?`).run(
      JSON.stringify([NEXT_TITLE, "구버전이 추가한 목표"]),
      campaignId
    );
    const after = goalsOf(db, campaignId);
    assert.deepEqual(after.find((item) => item.title === TITLE), before);
    assert.equal(after.find((item) => item.title === "구버전이 추가한 목표")?.source, "legacy");
    db.close();
  });

  it("a pending proposal that the production build removed from quests_json is retired on re-upgrade, never completed", async () => {
    const db = new Database(":memory:");
    const { campaignId } = await claimedParty(db);
    db.prepare(`UPDATE trpg_campaign_state SET quests_json=? WHERE campaign_id=?`).run(JSON.stringify([NEXT_TITLE]), campaignId);
    const goal = goalByTitle(db, campaignId, TITLE)!;
    assert.equal(goal.status, "retired");
    assert.equal(goal.evidence, undefined);
    db.close();
  });
});
