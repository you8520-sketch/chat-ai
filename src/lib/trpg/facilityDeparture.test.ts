import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignLedger } from "./campaignLedger";
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
    assert.deepEqual(explorationCommandsFromMovementBody(state.map, "기관실로 이동한다."), [{ op: "move", roomId: "engine" }]);
  });

  it("does not call party escape until every sheet has departed", () => {
    const state = { ...alarmExit(emptyExplorationState("layout")), departedParticipantIds: [1] };
    assert.equal(legacyPartyEscapeFact(state, [1, 2]), false);
    assert.equal(legacyPartyEscapeFact({ ...state, departedParticipantIds: [1, 2] }, [1, 2]), true);
  });
});

describe("campaign #44 R16 departure through commit", () => {
  it("records one departure, keeps the other inside, and finishes only after both have left", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
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
      gmCall: async () => ({
        text: buildTrpgGmStructuredWireText("서버가 정한 이탈만 잇는다.", {
          players: [],
          location: EXPLORATION_EXIT_ROOM,
          next_round_context: "다음",
          campaign_finished: true,
        }),
      }),
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
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
    const after = loadExplorationState(db, campaignId)!;
    assert.deepEqual(after.departedParticipantIds, [hostId]);
    assert.equal(
      (db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(hostId) as { location: string }).location,
      EXPLORATION_DEPARTED_LOCATION
    );
    assert.equal(
      (db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(botId) as { location: string }).location,
      EXPLORATION_EXIT_ROOM
    );
    assert.equal(
      (db.prepare(`SELECT status FROM trpg_campaigns WHERE id=?`).get(campaignId) as { status: string }).status === "CAMPAIGN_COMPLETE",
      false
    );
    assert.equal(loadCampaignLedger(db, campaignId).goals.some((goal) => goal.status === "completed"), false);
    const reloaded = loadExplorationState(db, campaignId)!;
    assert.deepEqual(reloaded.departedParticipantIds, [hostId]);

    botLine = "센터 밖으로 나간다.";
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const done = loadExplorationState(db, campaignId)!;
    assert.deepEqual(done.departedParticipantIds.sort((a, b) => a - b), [hostId, botId].sort((a, b) => a - b));
    assert.equal(
      (db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(botId) as { location: string }).location,
      EXPLORATION_DEPARTED_LOCATION
    );
    assert.equal(
      (db.prepare(`SELECT status FROM trpg_campaigns WHERE id=?`).get(campaignId) as { status: string }).status,
      "CAMPAIGN_COMPLETE"
    );
    assert.equal(loadCampaignLedger(db, campaignId).goals.some((goal) => goal.status === "completed"), false);
    db.close();
  });
});
