import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignLedger } from "./campaignLedger";
import { loadExplorationState, saveExplorationState } from "./explorationStore";
import {
  emptyExplorationState,
  EXPLORATION_ENTRANCE,
  EXPLORATION_EXIT_ROOM,
  type ExplorationState,
  visibleExplorationNeighbors,
} from "./explorationMap";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { ensureTrpgTables } from "./schema";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { insertParticipant } from "./store";
import { TRPG_ACTION_MAX_CHARS } from "./types";

const PLAN = {
  startingSituation: "닫힌 시설의 현관에 도착한다",
  centralConflict: "경보가 살아 있는 구역을 지나 나가야 한다",
  goal: "출구에 도착한다",
  endingConditions: ["출구에 도착한다"],
  exploration: true,
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','현이',50000)`).run();
  ensureTrpgTables(db);
  return db;
}

function locationOf(db: Database.Database, participantId: number): string {
  return (
    db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(participantId) as {
      location: string;
    }
  ).location;
}

function lockedBody(db: Database.Database, participantId: number): string {
  return (
    db
      .prepare(`SELECT body FROM trpg_action_submissions WHERE participant_id=? ORDER BY id DESC LIMIT 1`)
      .get(participantId) as { body: string }
  ).body;
}

function neighbors(state: ExplorationState, roomId: string): string[] {
  return visibleExplorationNeighbors(state, roomId);
}

function latestRound(db: Database.Database, campaignId: number): {
  phase: string;
  error_json: string | null;
} {
  return db
    .prepare(`SELECT phase, error_json FROM trpg_rounds WHERE campaign_id=? ORDER BY id DESC LIMIT 1`)
    .get(campaignId) as { phase: string; error_json: string | null };
}

async function startWithBot(
  db: Database.Database,
  botLine: () => string
): Promise<{ campaignId: number; hostId: number; botId: number; deps: TrpgEngineDeps }> {
  const templateId = insertScenarioTemplate(db, 7, {
    title: "대기 경로",
    summary: "동료 이동",
    content: "현관에서 갈림을 고른다.",
    visibility: "public",
    startLocation: EXPLORATION_ENTRANCE,
    scenarioPlan: PLAN,
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
  const botId = insertParticipant(db, {
    campaignId,
    slotIndex: 2,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "서하",
  });
  writeSheet(db, campaignId, botId, "서하", EVEN_STATS, EXPLORATION_ENTRANCE);
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 16,
    botCall: async () => ({ text: botLine() }),
    gmCall: async () => ({
      text: buildTrpgGmStructuredWireText("서버가 정한 자리만 잇는다. GM: 무엇을 하겠는가.", {
        players: [],
        location: loadCampaignLedger(db, campaignId).location || EXPLORATION_ENTRANCE,
        next_round_context: "다음",
        campaign_finished: false,
      }),
    }),
  };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { campaignId, hostId, botId, deps };
}

describe("bot exploration stay fallback", () => {
  it("locks an adjacent move and spends AP", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
    const { campaignId, hostId, botId, deps } = await startWithBot(db, () => botLine);
    const fork = neighbors(loadExplorationState(db, campaignId)!, EXPLORATION_ENTRANCE).find(
      (roomId) => roomId !== EXPLORATION_EXIT_ROOM
    );
    assert.ok(fork);
    botLine = `${fork}로 이동한다.`;
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), fork);
    assert.equal(locationOf(db, hostId), EXPLORATION_ENTRANCE);
    assert.match(lockedBody(db, botId), new RegExp(`${fork}.+이동한다`));
    assert.equal(loadExplorationState(db, campaignId)?.apRemaining[String(botId)], 2);
    db.close();
  });

  it("replaces a lone illegal exit dash with the stay sentence and does not move", async () => {
    const db = memoryDb();
    let botLine = "출구로 이동한다.";
    const { campaignId, hostId, botId, deps } = await startWithBot(db, () => botLine);
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(locationOf(db, hostId), EXPLORATION_ENTRANCE);
    assert.equal(lockedBody(db, botId), "서하은 제자리에 서서 상황을 살핀다.");
    assert.equal(lockedBody(db, botId).includes(EXPLORATION_EXIT_ROOM), false);
    assert.equal(loadExplorationState(db, campaignId)?.visitedRoomIds.includes(EXPLORATION_EXIT_ROOM), false);
    db.close();
  });

  it("keeps independent cover prose when an illegal move is rejected", async () => {
    const db = memoryDb();
    let botLine = "출구로 이동한다. 현이 옆에서 방어선을 유지한다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(lockedBody(db, botId), "현이 옆에서 방어선을 유지한다");
    assert.equal(lockedBody(db, botId).includes(EXPLORATION_EXIT_ROOM), false);
    assert.equal(latestRound(db, campaignId).phase, "ACTION_INPUT");
    db.close();
  });

  it("does not lock a deictic search that depends on a rejected move", async () => {
    const db = memoryDb();
    let botLine = "출구로 이동한다. 그곳의 제어 패널을 조사한다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(lockedBody(db, botId), "서하은 제자리에 서서 상황을 살핀다.");
    assert.equal(lockedBody(db, botId).includes("제어 패널"), false);
    assert.equal(loadExplorationState(db, campaignId)?.apRemaining[String(botId)], undefined);
    assert.equal(latestRound(db, campaignId).phase, "ACTION_INPUT");
    db.close();
  });

  it("does not lock an exit-panel search after a rejected exit move", async () => {
    const db = memoryDb();
    let botLine = "출구로 이동한다. 출구의 제어 패널을 조사한다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(lockedBody(db, botId), "서하은 제자리에 서서 상황을 살핀다.");
    assert.equal(lockedBody(db, botId).includes("제어 패널"), false);
    db.close();
  });

  it("does not lock cover beside a companion who is not here", async () => {
    const db = memoryDb();
    let botLine = "출구로 이동한다. 권태현의 옆에서 방어선을 유지한다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(lockedBody(db, botId), "서하은 제자리에 서서 상황을 살핀다.");
    assert.equal(lockedBody(db, botId).includes("권태현"), false);
    db.close();
  });

  it("does not confirm a move beside a missing companion", async () => {
    const db = memoryDb();
    let botLine = "권태현의 옆으로 이동한다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(lockedBody(db, botId), "서하은 제자리에 서서 상황을 살핀다.");
    db.close();
  });

  it("does not keep later prose that names a room other than the applied destination", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    const fork = neighbors(loadExplorationState(db, campaignId)!, EXPLORATION_ENTRANCE).find(
      (roomId) => roomId !== EXPLORATION_EXIT_ROOM
    );
    assert.ok(fork);
    botLine = `출구로 이동한다. ${fork}로 이동한다. 그곳의 제어 패널을 조사한다.`;
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), fork);
    assert.match(lockedBody(db, botId), new RegExp(`${fork}.+이동한다`));
    assert.equal(lockedBody(db, botId).includes("제어 패널"), false);
    assert.equal(lockedBody(db, botId).includes(EXPLORATION_EXIT_ROOM), false);
    db.close();
  });

  it("does not confirm standing beside a companion who already left", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
    const { campaignId, hostId, botId, deps } = await startWithBot(db, () => botLine);
    const fork = neighbors(loadExplorationState(db, campaignId)!, EXPLORATION_ENTRANCE).find(
      (roomId) => roomId !== EXPLORATION_EXIT_ROOM
    );
    assert.ok(fork);
    submitTrpgAction(db, { campaignId, userId: 1, body: `${fork}로 이동한다.` });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, hostId), fork);
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    botLine = "출구로 이동한다. 현이 옆에서 방어선을 유지한다.";
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(lockedBody(db, botId), "서하은 제자리에 서서 상황을 살핀다.");
    assert.equal(lockedBody(db, botId).includes("현이"), false);
    db.close();
  });

  it("falls back to stay when salvage remainder is overlong", async () => {
    const db = memoryDb();
    let botLine = `출구로 이동한다. 현이 옆에서 ${"가".repeat(TRPG_ACTION_MAX_CHARS)}`;
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = latestRound(db, campaignId);
    assert.equal(lockedBody(db, botId), "서하은 제자리에 서서 상황을 살핀다.");
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(loadExplorationState(db, campaignId)?.apRemaining[String(botId)], undefined);
    assert.doesNotMatch(round.error_json ?? "", /행동이 너무 깁니다/);
    assert.equal(round.phase, "ACTION_INPUT");
    db.close();
  });

  it("applies a later adjacent move and drops only the illegal exit clause", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    const fork = neighbors(loadExplorationState(db, campaignId)!, EXPLORATION_ENTRANCE).find(
      (roomId) => roomId !== EXPLORATION_EXIT_ROOM
    );
    assert.ok(fork);
    botLine = `출구로 이동한다. ${fork}로 이동한다. ${fork}에서 동료를 엄호한다.`;
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), fork);
    assert.match(lockedBody(db, botId), new RegExp(`${fork}.+이동한다`));
    assert.match(lockedBody(db, botId), /동료를 엄호한다/);
    assert.equal(lockedBody(db, botId).includes(EXPLORATION_EXIT_ROOM), false);
    db.close();
  });

  it("applies only the moves that fit remaining AP", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    const fork = neighbors(loadExplorationState(db, campaignId)!, EXPLORATION_ENTRANCE).find(
      (roomId) => roomId !== EXPLORATION_EXIT_ROOM
    );
    assert.ok(fork);
    botLine = `${fork}로 이동한다. 현관홀로 이동한다. ${fork}로 이동한다. 현관홀로 이동한다.`;
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), fork);
    assert.equal(loadExplorationState(db, campaignId)?.apRemaining[String(botId)], 0);
    assert.equal(lockedBody(db, botId).split("이동한다").length - 1, 3);
    db.close();
  });

  it("keeps a legal hop when the in-place remainder would overflow the locked body", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    const fork = neighbors(loadExplorationState(db, campaignId)!, EXPLORATION_ENTRANCE).find(
      (roomId) => roomId !== EXPLORATION_EXIT_ROOM
    );
    assert.ok(fork);
    const padding = "가".repeat(TRPG_ACTION_MAX_CHARS - 12);
    botLine = `${fork}로 이동한다. ${fork}에서 ${padding}`;
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), fork);
    assert.match(lockedBody(db, botId), new RegExp(`${fork}.+이동한다`));
    assert.equal(lockedBody(db, botId).includes("제자리에 서서"), false);
    assert.equal(lockedBody(db, botId).includes(padding), false);
    db.close();
  });

  it("from 남쪽복도 keeps the legal 경보실 hop when 출구 is not yet open", async () => {
    const db = memoryDb();
    let botLine = "자리를 지킨다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    saveExplorationState(db, campaignId, emptyExplorationState("layout"));
    writeSheet(db, campaignId, botId, "서하", EVEN_STATS, "남쪽복도");
    botLine = "경보실로 이동한다. 출구로 이동한다. 경보실로 이동한다.";
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), "경보실");
    assert.match(lockedBody(db, botId), /경보실로 이동한다/);
    assert.equal(lockedBody(db, botId).includes("출구로 이동한다"), false);
    assert.equal(lockedBody(db, botId).includes("제자리에 서서"), false);
    assert.equal(loadExplorationState(db, campaignId)?.apRemaining[String(botId)], 2);
    db.close();
  });

  it("stays in 남쪽복도 when the only declared move is a disconnected 출구", async () => {
    const db = memoryDb();
    let botLine = "출구로 이동한다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    saveExplorationState(db, campaignId, emptyExplorationState("layout"));
    writeSheet(db, campaignId, botId, "서하", EVEN_STATS, "남쪽복도");
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), "남쪽복도");
    assert.equal(lockedBody(db, botId), "서하은 제자리에 서서 상황을 살핀다.");
    assert.equal(loadExplorationState(db, campaignId)?.apRemaining[String(botId)], undefined);
    db.close();
  });

  it("saves an aimed shot that the parser does not price as a move", async () => {
    const db = memoryDb();
    let botLine = "출구를 향해 화살을 쏜다.";
    const { campaignId, botId, deps } = await startWithBot(db, () => botLine);
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(lockedBody(db, botId), "출구를 향해 화살을 쏜다.");
    db.close();
  });
});
