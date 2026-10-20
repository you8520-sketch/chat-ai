import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { evaluateAdventure, type TrpgAdventure } from "./adventure";
import { resolveTrpgCanonicalAttempt } from "./canonicalAttempt";
import { loadCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { explorationCommandsFromMovementBody } from "./explorationMap";
import { loadExplorationState } from "./explorationStore";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { ensureTrpgTables } from "./schema";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { insertParticipant } from "./store";

const FOLLOW =
  "서하는 주 통로로 진입하는 데모유저의 뒤를 따라 이동하며, 손전등으로 바닥의 파편과 연구원들의 이동 흔적을 비추어 데모유저의 조사와 전진을 보조하려 했다.";

const ROUND2_PROVIDER = `도킹 베이의 찌그러진 격벽 문틀 너머로 붉은 조준 광선이 빗발치듯 흔들리는 광경이 서하의 망막에 맺혔다. 미세 중력 제어가 불안정한 탓에 전술 보호복의 발목이 허공으로 살짝 뜨는 것을 느끼며, 그녀는 한 손으로 문틀 모서리를 꽉 쥐어 몸의 중심을 잡았다.

오작동 드론의 오른쪽으로 기운 로터 소리와 고주파 전류음이 좁은 통로를 날카롭게 긁어대고 있었다. 저 붉은 광선이 완전히 고정되기 전에 움직여야 했다. 서하는 손전등의 출력을 최소로 낮추어 빛이 드론의 광학 센서에 직접 닿지 않도록 손바닥으로 갓을 반쯤 가렸다. 바닥에 늘어진 고압 전선과 흩어진 파편 사이로 발을 디딜 안전한 틈새를 빠르게 눈으로 훑었다.

"자세 낮추세요. 저도 유지보수실 쪽으로 바로 붙을게요."

서하는 몸을 잔뜩 웅크린 채 찌그러진 유압 격벽 틈새를 빠져나와 주 통로로 발을 디뎠다. 데모유저가 확보하려는 경로의 그림자 속으로 파고들며, 바닥의 날카로운 복합 장갑 파편과 전선 더미를 피해 좌측 유지보수실 해치 방향으로 신속하고 조심스럽게 걸음을 옮겼다.

<<<ACTION_TYPE>>>
stealth
<<<INTENT>>>
서하는 손전등 빛을 가려 드론의 센서에 발각되지 않도록 주의하며, 데모유저의 동선을 따라 도킹 베이에서 주 통로를 거쳐 좌측 유지보수실 해치 방향으로 몸을 낮추고 은밀하게 이동하려 했다.`;

const STAY = "서하은 제자리에 서서 상황을 살핀다.";

const STATION: TrpgAdventure = {
  start: "docking_bay",
  places: [
    { key: "docking_bay", name: "도킹 베이", summary: "구조팀이 도착한 정거장의 입구.", role: "start" },
    { key: "main_corridor", name: "주 통로", summary: "정거장을 잇는 주 통로.", role: "hub" },
    { key: "maintenance_room", name: "유지보수실", summary: "산소 공급 장치와 배선 패널이 있다.", role: "site" },
    { key: "comm_room", name: "통신실", summary: "손상된 통신 콘솔이 있다.", role: "site" },
    { key: "quarantine_zone", name: "격리 구역", summary: "잠긴 연구 구역.", role: "goal" },
  ],
  links: [
    { from: "docking_bay", to: "main_corridor" },
    { from: "main_corridor", to: "maintenance_room" },
    { from: "main_corridor", to: "comm_room" },
    { from: "main_corridor", to: "quarantine_zone", opensBy: "unlock_quarantine" },
  ],
  events: [
    { key: "find_log", place: "maintenance_room", trigger: "search", kind: "clue", text: "유지보수 로그에서 잠금 단서를 찾는다." },
    {
      key: "unlock_quarantine",
      place: "maintenance_room",
      trigger: "careful_search",
      kind: "item",
      text: "배선 패널에서 격리 구역 잠금 해제 코드를 얻는다.",
      item: "잠금 해제 코드",
      requires: ["find_log"],
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

type Played = {
  db: Database.Database;
  campaignId: number;
  hostId: number;
  botId: number;
  gm: string;
};

function locationOf(db: Database.Database, participantId: number): string {
  return (
    db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(participantId) as {
      location: string;
    }
  ).location;
}

function hpOf(db: Database.Database, participantId: number): number {
  return (
    db.prepare(`SELECT hp FROM trpg_character_sheets WHERE participant_id=?`).get(participantId) as { hp: number }
  ).hp;
}

function lockedRow(db: Database.Database, participantId: number): { body: string; action_type: string | null } {
  return db
    .prepare(`SELECT body, action_type FROM trpg_action_submissions WHERE participant_id=? ORDER BY id DESC LIMIT 1`)
    .get(participantId) as { body: string; action_type: string | null };
}

function explorationLines(prompt: string): string[] {
  const start = prompt.indexOf("[EXPLORATION");
  if (start < 0) return [];
  const rest = prompt.slice(start);
  const end = rest.indexOf("\n[");
  const block = end < 0 ? rest : rest.slice(0, end);
  return block.split("\n").filter((line) => line.startsWith("데모유저") || line.startsWith("서하"));
}

async function play(provider: string, humanBody = "숨을 고르며 주변을 살핀다.", humanCommands?: unknown): Promise<Played> {
  assert.deepEqual(evaluateAdventure(STATION).issues, []);
  const db = memoryDb();
  const templateId = insertScenarioTemplate(db, 1, {
    title: "정거장",
    summary: "동료 이동",
    content: "도킹 베이에서 시작한다.",
    visibility: "private",
    startLocation: "도킹 베이",
    scenarioPlan: {
      startingSituation: "도킹 베이에 도착한다",
      centralConflict: "잠긴 구역",
      goal: "격리 구역에 닿는다",
      endingConditions: ["격리 구역에 닿는다"],
      adventure: STATION,
    },
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "데모유저", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "데모유저", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
  const botId = insertParticipant(db, {
    campaignId,
    slotIndex: 2,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "서하",
  });
  writeSheet(db, campaignId, botId, "서하", EVEN_STATS, "도킹 베이");
  const gmPrompts: string[] = [];
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 16,
    botCall: async () => ({ text: provider }),
    gmCall: async ({ user }) => {
      gmPrompts.push(user);
      return {
        text: buildTrpgGmStructuredWireText("서버가 정한 자리만 잇는다. GM: 무엇을 하겠는가.", {
          players: [],
          location: loadCampaignLedger(db, campaignId).location || "도킹 베이",
          next_round_context: "다음",
          campaign_finished: false,
        }),
      };
    },
  };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  submitTrpgAction(db, { campaignId, userId: 1, body: humanBody, explorationCommands: humanCommands });
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { db, campaignId, hostId, botId, gm: gmPrompts.at(-1) ?? "" };
}

describe("companion movement uses the same fact as the server", () => {
  it("prices the measured follow sentence through the existing adjacent move", async () => {
    const provider = `도킹 베이 문턱에서 손전등을 들어 바닥을 살핀다.\n\n<<<INTENT>>>\n${FOLLOW}`;
    const played = await play(provider);
    const beforeLock = explorationCommandsFromMovementBody(loadExplorationState(played.db, played.campaignId)!.map, provider);
    assert.deepEqual(beforeLock, [{ op: "move", roomId: "main_corridor" }]);
    const locked = lockedRow(played.db, played.botId);
    const canon = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: locked.body,
      actionType: locked.action_type,
    });
    assert.equal(locationOf(played.db, played.botId), "주 통로");
    assert.equal(locationOf(played.db, played.hostId), "도킹 베이");
    assert.equal(loadExplorationState(played.db, played.campaignId)?.apRemaining[String(played.botId)], 2);
    assert.match(locked.body, /^주 통로로 이동한다\./);
    assert.equal(canon.canonicalAttempt, FOLLOW);
    assert.deepEqual(explorationLines(played.gm), [
      "데모유저 is in 도킹 베이.",
      "서하 started in 도킹 베이 and is now in 주 통로.",
      "서하: moved 도킹 베이 → 주 통로.",
    ]);
    const snap = loadTrpgSnapshot(played.db, played.campaignId, 1);
    const companion = snap?.sheets.find((card) => card.participantId === played.botId);
    assert.equal(companion?.sheet.location, "주 통로");
    assert.match(companion?.html ?? "", /주 통로/);
    assert.equal(hpOf(played.db, played.botId), hpOf(played.db, played.hostId));
    assert.equal((played.db.prepare(`SELECT points FROM users WHERE id=1`).get() as { points: number }).points, 50000);
    played.db.close();
  });

  it("prices an explicit open adjacent move and leaves a watcher in place", async () => {
    const explicit = await play("주 통로로 이동한다.");
    assert.equal(locationOf(explicit.db, explicit.botId), "주 통로");
    assert.equal(loadExplorationState(explicit.db, explicit.campaignId)?.apRemaining[String(explicit.botId)], 2);
    assert.match(lockedRow(explicit.db, explicit.botId).body, /주 통로로 이동한다/);
    explicit.db.close();

    const watched = await play("데모유저가 주 통로로 들어가는 것을 본다.", "숨을 고른다.", [{ op: "move", roomId: "main_corridor" }]);
    assert.equal(locationOf(watched.db, watched.hostId), "주 통로");
    assert.equal(locationOf(watched.db, watched.botId), "도킹 베이");
    assert.equal(loadExplorationState(watched.db, watched.campaignId)?.apRemaining[String(watched.botId)], undefined);
    assert.equal(lockedRow(watched.db, watched.botId).body, "데모유저가 주 통로로 들어가는 것을 본다.");
    watched.db.close();
  });

  it("does not move for dialogue, negation, or holding position", async () => {
    for (const line of [
      '"주 통로로 이동하자." 하고 도킹 베이에서 말한다.',
      "주 통로로 이동하지 않고 도킹 베이에 남는다.",
      "제자리에 서서 도킹 베이를 비춘다.",
    ]) {
      const played = await play(line);
      assert.equal(locationOf(played.db, played.botId), "도킹 베이", line);
      assert.equal(lockedRow(played.db, played.botId).body, line);
      assert.equal(loadExplorationState(played.db, played.campaignId)?.apRemaining[String(played.botId)], undefined);
      played.db.close();
    }
  });

  it("keeps the stay fallback for a locked way, an unknown place, and a rejected direction", async () => {
    for (const line of ["격리 구역으로 이동한다.", "함교로 이동한다."]) {
      const played = await play(line);
      assert.equal(locationOf(played.db, played.botId), "도킹 베이", line);
      assert.equal(lockedRow(played.db, played.botId).body, STAY);
      assert.equal(lockedRow(played.db, played.botId).body.includes(line.slice(0, 2)), false);
      played.db.close();
    }
    const direction = await play(ROUND2_PROVIDER);
    assert.deepEqual(
      explorationCommandsFromMovementBody(loadExplorationState(direction.db, direction.campaignId)!.map, ROUND2_PROVIDER),
      [{ op: "move", roomId: "maintenance_room" }]
    );
    assert.equal(locationOf(direction.db, direction.botId), "도킹 베이");
    assert.equal(lockedRow(direction.db, direction.botId).body, STAY);
    assert.equal(lockedRow(direction.db, direction.botId).body.includes("주 통로"), false);
    assert.equal(lockedRow(direction.db, direction.botId).body.includes("유지보수실"), false);
    assert.deepEqual(
      explorationLines(direction.gm).filter((line) => line.startsWith("서하")),
      ["서하 is in 도킹 베이."]
    );
    direction.db.close();
  });

  it("applies only the prefix of several moves that the server still allows", async () => {
    const partial = await play("격리 구역으로 이동한다. 주 통로로 이동한다.");
    assert.equal(locationOf(partial.db, partial.botId), "주 통로");
    assert.equal(lockedRow(partial.db, partial.botId).body.includes("격리 구역"), false);
    assert.match(lockedRow(partial.db, partial.botId).body, /주 통로로 이동한다/);
    partial.db.close();

    const capped = await play("주 통로로 이동한다. 유지보수실로 이동한다. 주 통로로 이동한다. 통신실로 이동한다.");
    assert.equal(locationOf(capped.db, capped.botId), "주 통로");
    assert.equal(loadExplorationState(capped.db, capped.campaignId)?.apRemaining[String(capped.botId)], 0);
    assert.equal(lockedRow(capped.db, capped.botId).body.split("이동한다").length - 1, 3);
    assert.equal(lockedRow(capped.db, capped.botId).body.includes("통신실"), false);
    capped.db.close();
  });

  it("refuses a human general submit of the follow sentence and prices a pure move", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 1, {
      title: "정거장",
      summary: "사람 제출",
      content: "도킹 베이에서 시작한다.",
      visibility: "private",
      startLocation: "도킹 베이",
      scenarioPlan: {
        startingSituation: "도킹 베이에 도착한다",
        centralConflict: "잠긴 구역",
        goal: "격리 구역에 닿는다",
        endingConditions: ["격리 구역에 닿는다"],
        adventure: STATION,
      },
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "데모유저", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "데모유저", stats: EVEN_STATS });
    const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      botCall: async () => ({ text: "제자리에 서서 도킹 베이를 살핀다." }),
      gmCall: async () => ({
        text: buildTrpgGmStructuredWireText("서버가 정한 자리만 잇는다. GM: 무엇을 하겠는가.", {
          players: [],
          location: "도킹 베이",
          next_round_context: "다음",
          campaign_finished: false,
        }),
      }),
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.throws(() => submitTrpgAction(db, { campaignId, userId: 1, body: FOLLOW }), /일반 행동입니다/);
    assert.equal(locationOf(db, hostId), "도킹 베이");
    submitTrpgAction(db, { campaignId, userId: 1, body: "주 통로로 이동한다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, hostId), "주 통로");
    assert.match(lockedRow(db, hostId).body, /주 통로로 이동한다/);
    db.close();
  });
});
