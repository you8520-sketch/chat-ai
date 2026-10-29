import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignLedger } from "./campaignLedger";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { answerTrpgGoalClaim } from "./goalConfirm";
import { explorationPromptForRound, loadExplorationState, saveExplorationState } from "./explorationStore";
import {
  emptyExplorationState,
  EXPLORATION_DEPARTED_LOCATION,
  EXPLORATION_ENTRANCE,
  EXPLORATION_EXIT_ROOM,
  explorationCommandsFromMovementBody,
  adventureExplorationState,
  legacyPartyEscapeFact,
  priceExplorationCommands,
  type ExplorationState,
} from "./explorationMap";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { ensureTrpgTables } from "./schema";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { insertParticipant } from "./store";
import type { TrpgAdventure } from "./adventure";

const GOAL = "센터 탈출: 봉쇄된 출구의 잠금을 해제하고 탈출한다";
const R16 =
  '출구에 합류한 태현과 이현을 확인하고, 열린 방폭문 너머 지상 슬로프와 바깥쪽을 살핀다. "형, 이현, 이제 나가자. 더 머물 이유 없어." 경보실 쪽을 마지막으로 경계한 뒤 기존 기둥 뒤 엄폐를 풀고, 이미 열린 방폭 게이트를 통과해 지상 슬로프를 따라 센터 밖으로 나가려 한다. 동료들에게도 열린 탈출로를 가리킨다.';

const PLAN = {
  startingSituation: "닫힌 시설의 현관에 도착한다",
  centralConflict: "경보가 살아 있는 구역을 지나 나가야 한다",
  goal: "출구에 도착한다",
  endingConditions: ["출구에 도착한다"],
  exploration: true,
};

const GHOST: TrpgAdventure = {
  start: "platform",
  places: [
    { key: "platform", name: "폐역 승강장", summary: "승강장", role: "start" },
    { key: "car", name: "객차", summary: "객차", role: "hub" },
    { key: "engine", name: "기관실", summary: "기관실", role: "goal" },
  ],
  links: [
    { from: "platform", to: "car" },
    { from: "car", to: "engine" },
  ],
  events: [],
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','렌',50000)`).run();
  ensureTrpgTables(db);
  return db;
}

function alarmExit(state: ExplorationState): ExplorationState {
  return { ...state, risk: 28, alarmFlagged: true };
}

describe("legacy facility departure", () => {
  it("prices 센터 밖 as a departure from the open exit, not a move into 센터", () => {
    const state = alarmExit(emptyExplorationState("layout"));
    const body = "센터 밖으로 나간다.";
    const commands = explorationCommandsFromMovementBody(state.map, body);
    assert.deepEqual(commands, [{ op: "depart" }]);
    assert.equal(commands.some((command) => command.op === "move" && command.roomId === "센터"), false);
    const priced = priceExplorationCommands({
      state,
      fromRoomId: EXPLORATION_EXIT_ROOM,
      commands,
      apRemaining: 3,
    });
    assert.equal(priced.spent, 1);
  });

  it("accepts the same outside intent for 시설 밖 and the blast gate", () => {
    const map = emptyExplorationState("layout").map;
    assert.deepEqual(explorationCommandsFromMovementBody(map, "시설 밖으로 나간다."), [{ op: "depart" }]);
    assert.deepEqual(explorationCommandsFromMovementBody(map, "외부 탈출로로 나간다."), [{ op: "depart" }]);
    assert.deepEqual(explorationCommandsFromMovementBody(map, "방폭 게이트를 통과한다."), [{ op: "depart" }]);
    assert.deepEqual(explorationCommandsFromMovementBody(map, "센터 밖으로 나간다. 시설 밖으로 나간다."), [{ op: "depart" }]);
  });

  it("accepts the transcribed R16 text as one departure from the open exit", () => {
    const state = alarmExit(emptyExplorationState("layout"));
    const commands = explorationCommandsFromMovementBody(state.map, R16);
    assert.deepEqual(commands, [{ op: "depart" }]);
    assert.equal(commands.some((command) => command.op === "move"), false);
    assert.equal(
      priceExplorationCommands({ state, fromRoomId: EXPLORATION_EXIT_ROOM, commands, apRemaining: 3 }).spent,
      1
    );
  });

  it("does not turn a negated or quoted blast gate into a departure", () => {
    const map = emptyExplorationState("layout").map;
    assert.deepEqual(explorationCommandsFromMovementBody(map, "방폭 게이트를 통과하지 않는다. 중앙홀로 이동한다"), [
      { op: "move", roomId: "중앙홀" },
    ]);
    assert.deepEqual(
      explorationCommandsFromMovementBody(map, "“방폭 게이트를 통과해!”라고 외친다. 중앙홀로 이동한다"),
      [{ op: "move", roomId: "중앙홀" }]
    );
  });

  it("prices 출구 밖 as a departure and rejects it from any other room", () => {
    const state = alarmExit(emptyExplorationState("layout"));
    const commands = explorationCommandsFromMovementBody(state.map, "출구 밖으로 나간다");
    assert.deepEqual(commands, [{ op: "depart" }]);
    assert.equal(
      priceExplorationCommands({ state, fromRoomId: EXPLORATION_EXIT_ROOM, commands, apRemaining: 3 }).spent,
      1
    );
    assert.throws(
      () => priceExplorationCommands({ state, fromRoomId: EXPLORATION_ENTRANCE, commands, apRemaining: 3 }),
      /연결되지 않은 곳으로는 이동할 수 없습니다/
    );
  });

  it("rejects departure from another room, a shut latch, no AP, and an unknown room", () => {
    const open = alarmExit(emptyExplorationState("layout"));
    const shut = emptyExplorationState("layout");
    const depart = [{ op: "depart" as const }];
    assert.throws(
      () => priceExplorationCommands({ state: open, fromRoomId: EXPLORATION_ENTRANCE, commands: depart, apRemaining: 3 }),
      /연결되지 않은 곳으로는 이동할 수 없습니다/
    );
    assert.throws(
      () => priceExplorationCommands({ state: shut, fromRoomId: EXPLORATION_EXIT_ROOM, commands: depart, apRemaining: 3 }),
      /출구 빗장/
    );
    assert.throws(
      () => priceExplorationCommands({ state: open, fromRoomId: EXPLORATION_EXIT_ROOM, commands: depart, apRemaining: 0 }),
      /행동력/
    );
    assert.throws(
      () =>
        priceExplorationCommands({
          state: open,
          fromRoomId: EXPLORATION_EXIT_ROOM,
          commands: explorationCommandsFromMovementBody(open.map, "없는방으로 이동한다."),
          apRemaining: 3,
        }),
      /연결되지 않은 곳으로는 이동할 수 없습니다/
    );
  });

  it("does not turn an outside boundary of a real room into a facility departure on a v2 map", () => {
    const state = adventureExplorationState(GHOST, "ghost");
    assert.deepEqual(explorationCommandsFromMovementBody(state.map, "폐역 승강장 밖으로 나간다."), []);
    assert.deepEqual(explorationCommandsFromMovementBody(state.map, "방폭 게이트를 통과한다."), []);
    assert.deepEqual(explorationCommandsFromMovementBody(state.map, "기관실로 이동한다."), [{ op: "move", roomId: "engine" }]);
  });

  it("does not call party escape until every sheet has departed", () => {
    const state = { ...alarmExit(emptyExplorationState("layout")), departedParticipantIds: [1] };
    assert.equal(legacyPartyEscapeFact(state, [1, 2]), false);
    assert.equal(legacyPartyEscapeFact({ ...state, departedParticipantIds: [1, 2] }, [1, 2]), true);
  });
});

function campaignStatus(db: Database.Database, campaignId: number): string {
  return (db.prepare(`SELECT status FROM trpg_campaigns WHERE id=?`).get(campaignId) as { status: string }).status;
}

function sheetLocationOf(db: Database.Database, participantId: number): string {
  return (db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(participantId) as { location: string })
    .location;
}

function escapeGoal(db: Database.Database, campaignId: number) {
  const goal = loadCampaignLedger(db, campaignId).goals.find((item) => item.id === "goal-0-1");
  assert.ok(goal);
  return goal;
}

function latestCommitMessage(db: Database.Database, campaignId: number): { roundId: number; stored: Record<string, unknown> } {
  const row = db
    .prepare(
      `SELECT m.round_id AS roundId, m.structured_json AS json
       FROM trpg_gm_messages m
       JOIN trpg_rounds r ON r.id = m.round_id
       WHERE r.campaign_id=? AND r.phase='ROUND_COMPLETE'
       ORDER BY r.round_number DESC LIMIT 1`
    )
    .get(campaignId) as { roundId: number; json: string };
  return { roundId: row.roundId, stored: JSON.parse(row.json) as Record<string, unknown> };
}

function rewindLastCommit(db: Database.Database, campaignId: number): void {
  const committed = db
    .prepare(
      `SELECT id, round_number, gm_committed_generation_id AS token
       FROM trpg_rounds
       WHERE campaign_id=? AND phase='ROUND_COMPLETE' AND gm_committed_generation_id IS NOT NULL
       ORDER BY round_number DESC LIMIT 1`
    )
    .get(campaignId) as { id: number; round_number: number; token: string };
  db.prepare(`DELETE FROM trpg_rounds WHERE campaign_id=? AND round_number>?`).run(campaignId, committed.round_number);
  db.prepare(
    `UPDATE trpg_rounds
     SET phase='APPLYING_STATE',
         gm_generation_id=?,
         lock_holder_request_id=?,
         gm_generation_heartbeat_at=datetime('now', '-180 seconds'),
         updated_at=datetime('now', '-180 seconds')
     WHERE id=?`
  ).run(committed.token, committed.token, committed.id);
  db.prepare(`UPDATE trpg_campaigns SET status='ACTION_INPUT' WHERE id=?`).run(campaignId);
}

describe("campaign #44 departure, goal confirmation, and ending", () => {
  it("keeps a partial exit inside, then completes only after host confirmation and a later GM ending", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
    let mode: "opening" | "finish" | "claim" = "opening";
    const templateId = insertScenarioTemplate(db, 7, {
      title: "이탈",
      summary: "출구",
      content: "출구에서 나간다.",
      visibility: "public",
      startLocation: EXPLORATION_ENTRANCE,
      scenarioPlan: PLAN,
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: 2,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "강이현",
    });
    writeSheet(db, campaignId, botId, "강이현", EVEN_STATS, EXPLORATION_ENTRANCE);
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      botCall: async () => ({ text: botLine }),
      gmCall: async () => {
        const opening = mode === "opening";
        const claim = mode === "claim";
        return {
          text: buildTrpgGmStructuredWireText(
            claim ? "전원이 시설 밖으로 나왔다. 탈출 목표는 해결되었다." : "서버가 정한 이탈만 잇는다.",
            {
              players: [],
              location: EXPLORATION_EXIT_ROOM,
              next_round_context: "다음",
              campaign_finished: !opening,
              ...(opening ? { questsAdd: [GOAL] } : {}),
              ...(claim ? { questsClaimDone: [GOAL] } : {}),
            }
          ),
        };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    mode = "finish";
    const openedGoal = escapeGoal(db, campaignId);
    assert.equal(openedGoal.status, "active");
    assert.equal(openedGoal.criterion, undefined);
    const opened = alarmExit(loadExplorationState(db, campaignId)!);
    saveExplorationState(db, campaignId, opened);
    writeSheet(db, campaignId, hostId, "렌", EVEN_STATS, EXPLORATION_EXIT_ROOM);
    writeSheet(db, campaignId, botId, "강이현", EVEN_STATS, EXPLORATION_EXIT_ROOM);

    assert.throws(() => submitTrpgAction(db, { campaignId, userId: 1, body: "없는방으로 이동한다." }), /연결되지 않은/);

    submitTrpgAction(db, { campaignId, userId: 1, body: "센터 밖으로 나간다." });
    const roundId = (db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? ORDER BY id DESC LIMIT 1`).get(campaignId) as { id: number }).id;
    const prompt = explorationPromptForRound(db, {
      campaignId,
      roundId,
      opening: false,
      actors: [
        { participantId: hostId, name: "렌", tier: null },
        { participantId: botId, name: "강이현", tier: null },
      ],
    });
    assert.match(prompt, /렌 left the facility/);
    assert.match(prompt, /Party escape is not a server fact/);
    assert.doesNotMatch(prompt, /move\(roomId="센터"\)|센터로 이동/);

    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadExplorationState(db, campaignId)!.departedParticipantIds, [hostId]);
    assert.equal(sheetLocationOf(db, hostId), EXPLORATION_DEPARTED_LOCATION);
    assert.equal(sheetLocationOf(db, botId), EXPLORATION_EXIT_ROOM);
    assert.notEqual(campaignStatus(db, campaignId), "CAMPAIGN_COMPLETE");
    assert.equal(escapeGoal(db, campaignId).status, "active");
    const partialRead = loadTrpgSnapshot(db, campaignId, 1);
    assert.ok(partialRead);
    assert.equal(partialRead.sheets.find((card) => card.participantId === hostId)?.sheet.location, EXPLORATION_DEPARTED_LOCATION);
    assert.equal(partialRead.sheets.find((card) => card.participantId === botId)?.sheet.location, EXPLORATION_EXIT_ROOM);
    assert.deepEqual(loadExplorationState(db, campaignId)!.departedParticipantIds, [hostId]);
    const partialStored = latestCommitMessage(db, campaignId).stored;
    assert.equal(partialStored.campaignFinished, true);
    assert.equal(partialStored.effectiveCampaignFinished, false);
    delete partialStored.effectiveCampaignFinished;
    db.prepare(`UPDATE trpg_gm_messages SET structured_json=? WHERE round_id=?`).run(
      JSON.stringify(partialStored),
      latestCommitMessage(db, campaignId).roundId
    );
    rewindLastCommit(db, campaignId);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.notEqual(campaignStatus(db, campaignId), "CAMPAIGN_COMPLETE");
    assert.deepEqual(loadExplorationState(db, campaignId)!.departedParticipantIds, [hostId]);
    assert.equal(sheetLocationOf(db, botId), EXPLORATION_EXIT_ROOM);

    botLine = "센터 밖으로 나간다.";
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const both = loadExplorationState(db, campaignId)!;
    assert.deepEqual(both.departedParticipantIds.sort((a, b) => a - b), [hostId, botId].sort((a, b) => a - b));
    assert.equal(both.apRemaining[String(botId)], 2);
    assert.equal(both.apRemaining[String(hostId)], undefined);
    assert.equal(sheetLocationOf(db, botId), EXPLORATION_DEPARTED_LOCATION);
    assert.match(
      (db.prepare(`SELECT body FROM trpg_action_submissions WHERE participant_id=? ORDER BY id DESC LIMIT 1`).get(botId) as { body: string }).body,
      /시설 밖/
    );
    assert.notEqual(campaignStatus(db, campaignId), "CAMPAIGN_COMPLETE");
    assert.equal(escapeGoal(db, campaignId).claimedRound, undefined);
    const bothStored = latestCommitMessage(db, campaignId).stored;
    assert.equal(bothStored.campaignFinished, true);
    assert.equal(bothStored.effectiveCampaignFinished, false);
    const roundsBeforeRecovery = (db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as { n: number }).n;
    rewindLastCommit(db, campaignId);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.notEqual(campaignStatus(db, campaignId), "CAMPAIGN_COMPLETE");
    assert.equal(escapeGoal(db, campaignId).status, "active");
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as { n: number }).n,
      roundsBeforeRecovery
    );
    assert.deepEqual(
      loadExplorationState(db, campaignId)!.departedParticipantIds.sort((a, b) => a - b),
      [hostId, botId].sort((a, b) => a - b)
    );

    botLine = "자리를 지킨다.";
    mode = "claim";
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const claimed = escapeGoal(db, campaignId);
    assert.equal(claimed.status, "active");
    assert.equal(typeof claimed.claimedRound, "number");
    assert.notEqual(campaignStatus(db, campaignId), "CAMPAIGN_COMPLETE");
    const answered = answerTrpgGoalClaim(db, {
      campaignId,
      userId: 1,
      goalId: "goal-0-1",
      claimedRound: claimed.claimedRound!,
      decision: "confirm",
    });
    assert.equal(answered.outcome, "confirmed");
    const confirmed = escapeGoal(db, campaignId);
    assert.equal(confirmed.status, "completed");
    assert.equal(confirmed.evidence?.kind, "host_confirmed");
    assert.notEqual(campaignStatus(db, campaignId), "CAMPAIGN_COMPLETE");
    const confirmedRead = loadTrpgSnapshot(db, campaignId, 1);
    assert.ok(confirmedRead);
    assert.equal(confirmedRead.goals.find((goal) => goal.id === "goal-0-1")?.status, "completed");
    assert.equal(confirmedRead.goals.find((goal) => goal.id === "goal-0-1")?.basis, "host");
    assert.equal(confirmedRead.sheets.find((card) => card.participantId === hostId)?.sheet.location, EXPLORATION_DEPARTED_LOCATION);
    assert.equal(confirmedRead.sheets.find((card) => card.participantId === botId)?.sheet.location, EXPLORATION_DEPARTED_LOCATION);
    const claimStored = latestCommitMessage(db, campaignId).stored;
    assert.equal(claimStored.campaignFinished, true);
    assert.equal(claimStored.effectiveCampaignFinished, false);
    rewindLastCommit(db, campaignId);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.notEqual(campaignStatus(db, campaignId), "CAMPAIGN_COMPLETE");
    assert.equal(escapeGoal(db, campaignId).status, "completed");
    assert.equal(escapeGoal(db, campaignId).evidence?.kind, "host_confirmed");

    mode = "finish";
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(campaignStatus(db, campaignId), "CAMPAIGN_COMPLETE");
    assert.equal(escapeGoal(db, campaignId).status, "completed");
    assert.equal(escapeGoal(db, campaignId).evidence?.kind, "host_confirmed");
    const finishedRead = loadTrpgSnapshot(db, campaignId, 1);
    assert.ok(finishedRead);
    assert.equal(finishedRead.campaignStatus, "CAMPAIGN_COMPLETE");
    assert.equal(finishedRead.goals.find((goal) => goal.id === "goal-0-1")?.basis, "host");
    db.close();
  });
});
