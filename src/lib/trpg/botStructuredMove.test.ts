import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { evaluateAdventure, type TrpgAdventure } from "./adventure";
import {
  parseBotExplorationLockLogLine,
  TRPG_BOT_EXPLORATION_LOCK_LOG_PREFIX,
  type BotExplorationLockDiagnostic,
} from "./botExplorationLockDiagnostic";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadCampaignLedger } from "./campaignLedger";
import { loadExplorationState, saveExplorationState } from "./explorationStore";
import {
  BOT_EXPLORATION_DEPART,
  BOT_EXPLORATION_NO_MOVE,
  EXPLORATION_DEPARTED_LOCATION,
  EXPLORATION_ENTRANCE,
  EXPLORATION_EXIT_ROOM,
} from "./explorationMap";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { ensureTrpgTables } from "./schema";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { insertParticipant } from "./store";

const TEA: TrpgAdventure = {
  start: "teahouse",
  places: [
    { key: "teahouse", name: "모밀찻집", summary: "비를 피해 들어온 작고 아늑한 찻집.", role: "start" },
    { key: "table", name: "중앙 테이블", summary: "세 사람이 둘러앉은 나무 테이블.", role: "site" },
    { key: "counter", name: "계산대", summary: "주인이 서 있는 나무 계산대.", role: "site" },
    { key: "door", name: "출입문", summary: "빗소리가 들리는 유리문.", role: "goal" },
  ],
  links: [
    { from: "teahouse", to: "table" },
    { from: "table", to: "counter" },
    { from: "counter", to: "door" },
    { from: "table", to: "door", opensBy: "event_finish_tea" },
  ],
  events: [
    {
      key: "event_finish_tea",
      place: "table",
      trigger: "careful_search",
      kind: "clue",
      text: "빈 찻잔이 식어 있다.",
    },
  ],
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','데모유저',50000)`).run();
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

function apOf(db: Database.Database, campaignId: number, participantId: number): number | undefined {
  return loadExplorationState(db, campaignId)?.apRemaining[String(participantId)];
}

function structured(opts: { prose: string; intent: string; movePlan: string; actionType?: string }): string {
  return JSON.stringify({
    prose: opts.prose,
    actionType: opts.actionType ?? "free",
    intent: opts.intent,
    movePlan: opts.movePlan,
  });
}

function captureLockDiagnostics(): {
  logs: BotExplorationLockDiagnostic[];
  restore: () => void;
} {
  const logs: BotExplorationLockDiagnostic[] = [];
  const original = console.info;
  console.info = (line: unknown, ...rest: unknown[]) => {
    if (typeof line === "string" && line.startsWith(TRPG_BOT_EXPLORATION_LOCK_LOG_PREFIX)) {
      logs.push(parseBotExplorationLockLogLine(line));
    } else {
      original.call(console, line, ...rest);
    }
  };
  return {
    logs,
    restore: () => {
      console.info = original;
    },
  };
}

async function playTea(opts: {
  provider: string;
  humanBody?: string;
  humanCommands?: unknown;
  visitedRoomIds?: string[];
}): Promise<{
  db: Database.Database;
  campaignId: number;
  hostId: number;
  botId: number;
  gm: string;
  lock: BotExplorationLockDiagnostic | undefined;
}> {
  assert.deepEqual(evaluateAdventure(TEA).issues, []);
  const db = memoryDb();
  const templateId = insertScenarioTemplate(db, 1, {
    title: "찻집",
    summary: "비 오는 밤",
    content: "차를 마신다.",
    visibility: "private",
    startLocation: "",
    scenarioPlan: {
      startingSituation: "비를 피해 찻집에 들어온다",
      centralConflict: "평온한 밤을 어떻게 마무리할지 정한다",
      goal: "차를 마시고 헤어진다",
      endingConditions: ["문을 나서 헤어진다"],
      adventure: TEA,
    },
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number })
    .id;
  const botId = insertParticipant(db, {
    campaignId,
    slotIndex: 2,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "권태현",
  });
  writeSheet(db, campaignId, botId, "권태현", EVEN_STATS, "모밀찻집");
  const gmPrompts: string[] = [];
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    structuredBotOutput: true,
    rollD20: () => 16,
    botCall: async () => ({ text: opts.provider }),
    gmCall: async ({ user }) => {
      gmPrompts.push(user);
      return {
        text: buildTrpgGmStructuredWireText("서버가 정한 자리만 잇는다. GM: 무엇을 하겠는가.", {
          players: [],
          location: loadCampaignLedger(db, campaignId).location || "모밀찻집",
          next_round_context: "다음",
          campaign_finished: false,
        }),
      };
    },
  };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  writeSheet(db, campaignId, botId, "권태현", EVEN_STATS, "모밀찻집");
  if (opts.visitedRoomIds) {
    const latest = loadExplorationState(db, campaignId);
    assert.ok(latest);
    saveExplorationState(db, campaignId, { ...latest, visitedRoomIds: opts.visitedRoomIds });
  }
  const diag = captureLockDiagnostics();
  submitTrpgAction(db, {
    campaignId,
    userId: 1,
    body: opts.humanBody ?? "출입문 앞에서 두 사람이 나오기를 기다린다.",
    explorationCommands: opts.humanCommands,
  });
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
  diag.restore();
  return {
    db,
    campaignId,
    hostId,
    botId,
    gm: gmPrompts.at(-1) ?? "",
    lock: diag.logs.at(-1),
  };
}

async function playFacility(opts: {
  provider: string;
  alarm?: boolean;
  botRoom?: string;
}): Promise<{
  db: Database.Database;
  campaignId: number;
  botId: number;
  lock: BotExplorationLockDiagnostic | undefined;
}> {
  const db = memoryDb();
  const templateId = insertScenarioTemplate(db, 1, {
    title: "시설",
    summary: "출구",
    content: "출구에서 나간다.",
    visibility: "private",
    startLocation: EXPLORATION_ENTRANCE,
    scenarioPlan: {
      startingSituation: "닫힌 시설의 현관에 도착한다",
      centralConflict: "경보가 살아 있는 구역을 지나 나가야 한다",
      goal: "출구에 도착한다",
      endingConditions: ["출구에 도착한다"],
      exploration: true,
    },
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const botId = insertParticipant(db, {
    campaignId,
    slotIndex: 2,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "권태현",
  });
  writeSheet(db, campaignId, botId, "권태현", EVEN_STATS, EXPLORATION_ENTRANCE);
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    structuredBotOutput: true,
    rollD20: () => 16,
    botCall: async () => ({ text: opts.provider }),
    gmCall: async () => ({
      text: buildTrpgGmStructuredWireText("서버가 정한 자리만 잇는다.", {
        players: [],
        location: loadCampaignLedger(db, campaignId).location || EXPLORATION_ENTRANCE,
        next_round_context: "다음",
        campaign_finished: false,
      }),
    }),
  };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  const latest = loadExplorationState(db, campaignId);
  assert.ok(latest);
  const botRoom = opts.botRoom ?? EXPLORATION_EXIT_ROOM;
  saveExplorationState(db, campaignId, {
    ...latest,
    alarmFlagged: opts.alarm !== false,
    visitedRoomIds: [...new Set([...latest.visitedRoomIds, botRoom])],
  });
  writeSheet(db, campaignId, botId, "권태현", EVEN_STATS, botRoom);
  const diag = captureLockDiagnostics();
  submitTrpgAction(db, { campaignId, userId: 1, body: "출구 앞에서 기다린다." });
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
  diag.restore();
  return { db, campaignId, botId, lock: diag.logs.at(-1) };
}

describe("structured bot move plans", () => {
  it("locks 모밀찻집 → 중앙 테이블 from a structured table plan", async () => {
    const played = await playTea({
      provider: structured({
        prose: '목덜미의 빗물을 털고 테이블 쪽으로 발걸음을 옮긴다.\n\n"먼저 앉지."',
        intent: "중앙 테이블로 이동한다.",
        movePlan: "table",
      }),
    });
    assert.equal(locationOf(played.db, played.botId), "중앙 테이블");
    assert.equal(locationOf(played.db, played.hostId), "모밀찻집");
    assert.match(lockedBody(played.db, played.botId), /^중앙 테이블로 이동한다\./);
    assert.match(lockedBody(played.db, played.botId), /먼저 앉지/);
    assert.equal(apOf(played.db, played.campaignId, played.botId), 2);
    assert.equal(played.lock?.fallbackBranch, "structured-full-lock");
    assert.deepEqual(played.lock?.declaredRoomIds, ["table"]);
    assert.match(played.gm, /권태현: moved 모밀찻집 → 중앙 테이블/);
    played.db.close();
  });

  it("rejects a fog-unknown multi-hop that the public map has not shown yet", async () => {
    const played = await playTea({
      provider: structured({
        prose: "계산대를 지나 문으로 간다.",
        intent: "출입문으로 이동한다.",
        movePlan: "table>counter>door",
      }),
    });
    assert.equal(locationOf(played.db, played.botId), "모밀찻집");
    assert.equal(played.lock?.fallbackBranch, "invalid-structured-plan");
    assert.doesNotMatch(lockedBody(played.db, played.botId), /출입문으로 이동한다/);
    played.db.close();
  });

  it("rejects a structured door hop that is not a legal candidate", async () => {
    const played = await playTea({
      provider: structured({
        prose: "출입문으로 곧장 걸어간다.",
        intent: "출입문으로 이동한다.",
        movePlan: "door",
      }),
    });
    assert.equal(locationOf(played.db, played.botId), "모밀찻집");
    assert.equal(apOf(played.db, played.campaignId, played.botId), undefined);
    assert.equal(played.lock?.fallbackBranch, "invalid-structured-plan");
    assert.doesNotMatch(played.gm, /moved 모밀찻집 → 출입문/);
    played.db.close();
  });

  it("keeps a door-seeking prose when the chosen plan is the legal table hop", async () => {
    const played = await playTea({
      provider: structured({
        prose: '출입문이 보고 싶지만 먼저 테이블로 간다.\n\n"오늘은 여기까지다."',
        intent: "출입문을 향해 걷되 일단 중앙 테이블로 이동한다.",
        movePlan: "table",
      }),
    });
    assert.equal(locationOf(played.db, played.botId), "중앙 테이블");
    assert.match(lockedBody(played.db, played.botId), /^중앙 테이블로 이동한다\./);
    assert.match(lockedBody(played.db, played.botId), /오늘은 여기까지다/);
    assert.doesNotMatch(lockedBody(played.db, played.botId), /출입문으로 이동한다/);
    assert.equal(played.lock?.fallbackBranch, "structured-full-lock");
    assert.match(played.gm, /권태현: moved 모밀찻집 → 중앙 테이블/);
    assert.doesNotMatch(played.gm, /moved 모밀찻집 → 출입문/);
    played.db.close();
  });

  it("does not force a move when the model chooses NO_MOVE", async () => {
    const played = await playTea({
      provider: structured({
        prose: '우산을 고쳐 쥐고 그 자리에 선다.\n\n"먼저 나가."',
        intent: "제자리에 서서 출입문 쪽을 바라본다.",
        movePlan: BOT_EXPLORATION_NO_MOVE,
      }),
    });
    assert.equal(locationOf(played.db, played.botId), "모밀찻집");
    assert.equal(apOf(played.db, played.campaignId, played.botId), undefined);
    assert.match(lockedBody(played.db, played.botId), /먼저 나가/);
    assert.equal(played.lock?.fallbackBranch, "structured-no-move");
    assert.doesNotMatch(played.gm, /moved 모밀찻집 →/);
    played.db.close();
  });

  it("keeps talk and investigate when NO_MOVE is chosen", async () => {
    const played = await playTea({
      provider: structured({
        prose: "젖은 우산의 물기를 털며 주인을 돌아본다.",
        intent: "찻집 안을 둘러보며 주인의 표정을 살핀다.",
        actionType: "investigate",
        movePlan: BOT_EXPLORATION_NO_MOVE,
      }),
    });
    assert.equal(locationOf(played.db, played.botId), "모밀찻집");
    assert.match(lockedBody(played.db, played.botId), /주인의 표정을 살핀다/);
    assert.equal(played.lock?.fallbackBranch, "structured-no-move");
    played.db.close();
  });

  it("strips a door-walk remainder instead of converting NO_MOVE into a table hop", async () => {
    const played = await playTea({
      provider: structured({
        prose: '출입문으로 걸어간다.\n\n"잘 가."',
        intent: "출입문으로 이동한다.",
        movePlan: BOT_EXPLORATION_NO_MOVE,
      }),
    });
    assert.equal(locationOf(played.db, played.botId), "모밀찻집");
    assert.equal(apOf(played.db, played.campaignId, played.botId), undefined);
    assert.match(lockedBody(played.db, played.botId), /잘 가/);
    assert.doesNotMatch(lockedBody(played.db, played.botId), /출입문으로 이동한다/);
    assert.doesNotMatch(lockedBody(played.db, played.botId), /중앙 테이블로 이동한다/);
    assert.equal(played.lock?.fallbackBranch, "structured-no-move");
    played.db.close();
  });

  it("fail-closes on malformed structured output instead of extracting a NL door hop", async () => {
    const cases = [
      '{"prose":"출입문으로 걸어간다.","actionType":"free","intent":"출입문으로 이동한다."',
      "출입문으로 이동한다.",
      JSON.stringify({
        prose: "출입문으로 걸어간다.",
        actionType: "free",
        intent: "출입문으로 이동한다.",
      }),
    ];
    for (const provider of cases) {
      const played = await playTea({ provider });
      assert.equal(locationOf(played.db, played.botId), "모밀찻집");
      assert.equal(played.lock?.fallbackBranch, "malformed-structured-output");
      assert.doesNotMatch(lockedBody(played.db, played.botId), /출입문으로 이동한다/);
      played.db.close();
    }
  });

  it("still prices a legal multi-step plan and a human map click", async () => {
    const multi = await playTea({
      visitedRoomIds: ["teahouse", "table"],
      provider: structured({
        prose: "테이블과 계산대를 지나 문 쪽으로 걷는다.",
        intent: "계산대를 거쳐 출입문으로 이동한다.",
        movePlan: "table>counter>door",
      }),
    });
    assert.equal(locationOf(multi.db, multi.botId), "출입문");
    assert.match(lockedBody(multi.db, multi.botId), /중앙 테이블로 이동한다/);
    assert.match(lockedBody(multi.db, multi.botId), /계산대로 이동한다/);
    assert.match(lockedBody(multi.db, multi.botId), /출입문으로 이동한다/);
    assert.equal(apOf(multi.db, multi.campaignId, multi.botId), 0);
    assert.equal(multi.lock?.fallbackBranch, "structured-full-lock");
    multi.db.close();

    const human = await playTea({
      provider: structured({
        prose: "그 자리에 선다.",
        intent: "제자리에 선다.",
        movePlan: BOT_EXPLORATION_NO_MOVE,
      }),
      humanBody: "중앙 테이블로 이동한다.",
      humanCommands: [{ op: "move", roomId: "table" }],
    });
    assert.equal(locationOf(human.db, human.hostId), "중앙 테이블");
    assert.equal(locationOf(human.db, human.botId), "모밀찻집");
    human.db.close();
  });

  it("lets a v1 bot choose DEPART at the open exit and does not invent it when the latch is shut", async () => {
    const left = await playFacility({
      provider: structured({
        prose: "열린 방폭 게이트를 지나 밖으로 나선다.",
        intent: "시설 밖으로 나간다.",
        movePlan: BOT_EXPLORATION_DEPART,
      }),
    });
    assert.equal(locationOf(left.db, left.botId), EXPLORATION_DEPARTED_LOCATION);
    assert.deepEqual(loadExplorationState(left.db, left.campaignId)?.departedParticipantIds, [left.botId]);
    assert.match(lockedBody(left.db, left.botId), /시설 밖으로 나간다/);
    assert.equal(left.lock?.fallbackBranch, "structured-full-lock");
    left.db.close();

    const shut = await playFacility({
      alarm: false,
      provider: structured({
        prose: "문을 밀고 나간다.",
        intent: "시설 밖으로 나간다.",
        movePlan: BOT_EXPLORATION_DEPART,
      }),
    });
    assert.equal(locationOf(shut.db, shut.botId), EXPLORATION_EXIT_ROOM);
    assert.deepEqual(loadExplorationState(shut.db, shut.campaignId)?.departedParticipantIds, []);
    assert.equal(shut.lock?.fallbackBranch, "invalid-structured-plan");
    shut.db.close();
  });
});
