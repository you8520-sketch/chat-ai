import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { applyGoalTransition } from "./campaignGoals";
import { loadCampaignLedger } from "./campaignLedger";
import { gmAiActionText, lockedSpokenLines } from "./canonicalAttempt";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import {
  R17_BOT_KANG_LOCK,
  R17_BOT_KWON_LOCK,
  R17_NARRATION,
  R17_PLAYER_LOCK,
  R17_QUEST_ADD,
} from "./endingSceneFixture";
import {
  EXPLORATION_ENTRANCE,
  EXPLORATION_EXIT_ROOM,
  type ExplorationState,
} from "./explorationMap";
import { loadExplorationState, saveExplorationState } from "./explorationStore";
import { answerTrpgGoalClaim } from "./goalConfirm";
import {
  buildTrpgGmUserBlock,
  formatTrpgGmRoundHead,
  lastNarrationSentence,
  narrationDemandsNextAction,
  settleFinishedSceneNarration,
  shouldRequestTrpgPlayerGoalRegistration,
  TRPG_GM_ENDING_FINISH_HEAD,
  TRPG_GM_SYSTEM,
} from "./gmPrompt";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { ensureTrpgTables } from "./schema";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { insertParticipant } from "./store";

const GOAL = "센터 탈출: 봉쇄된 출구의 잠금을 해제하고 탈출한다";
const R16 =
  '출구에 합류한 태현과 이현을 확인하고, 열린 방폭문 너머 지상 슬로프와 바깥쪽을 살핀다. "형, 이현, 이제 나가자. 더 머물 이유 없어." 경보실 쪽을 마지막으로 경계한 뒤 기존 기둥 뒤 엄폐를 풀고, 이미 열린 방폭 게이트를 통과해 지상 슬로프를 따라 센터 밖으로 나가려 한다. 동료들에게도 열린 탈출로를 가리킨다.';
const CONTINUING_QUEST = "산책로에서 따뜻한 식사를 한다";

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
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','렌',50000)`).run();
  ensureTrpgTables(db);
  return db;
}

function alarmExit(state: ExplorationState): ExplorationState {
  return { ...state, risk: 28, alarmFlagged: true };
}

function latestAppliedJson(db: Database.Database, campaignId: number): string {
  const row = db
    .prepare(
      `SELECT l.applied_json AS json
       FROM trpg_state_change_log l
       JOIN trpg_rounds r ON r.id = l.round_id
       WHERE l.campaign_id=?
       ORDER BY r.round_number DESC LIMIT 1`
    )
    .get(campaignId) as { json: string } | undefined;
  if (!row) throw new Error("missing trpg_state_change_log row");
  return row.json;
}

function spokenLines(narration: string, name: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`${name}: "([^"]+)"`, "g");
  for (const match of narration.matchAll(pattern)) found.push(match[1] ?? "");
  return found;
}

describe("ending scene originals", () => {
  it("R17 narration asks for another action, and the finish settler removes only that sentence", () => {
    assert.equal(narrationDemandsNextAction(R17_NARRATION), true);
    assert.match(lastNarrationSentence(R17_NARRATION), /어느 쪽으로 발걸음을 옮길 것인가/);
    const settled = settleFinishedSceneNarration(R17_NARRATION);
    assert.equal(narrationDemandsNextAction(settled), false);
    assert.doesNotMatch(settled, /어느 쪽으로 발걸음을 옮길 것인가/);
    assert.match(settled, /드론 두어 대/);
    assert.match(settled, /렌: "오늘은 여기까지\. 따뜻한 거 먹고 쉬자\."/);
    assert.match(settled, /내려다보인다\.$/);
    assert.equal(settleFinishedSceneNarration("세 사람은 정원에 섰다."), "세 사람은 정원에 섰다.");
    assert.equal(
      settleFinishedSceneNarration('강이현: "어디로 갈까?"'),
      '강이현: "어디로 갈까?"'
    );
  });

  it("R17 companion quotes add a payment the locks do not contain, and the authority owner names that boundary once", () => {
    const kwon = spokenLines(R17_NARRATION, "권태현").join("\n");
    const kang = spokenLines(R17_NARRATION, "강이현").join("\n");
    assert.match(kwon, /내가 제대로 사줄 테니까/);
    assert.doesNotMatch(R17_BOT_KWON_LOCK, /사줄/);
    assert.match(R17_BOT_KWON_LOCK, /사는 놈 뒤꽁무니나 얌전히 따라붙어/);
    assert.match(kang, /계산은 우리 듬직한 태현이 형님이 시원하게 쏘는 걸로/);
    assert.doesNotMatch(R17_BOT_KANG_LOCK, /태현이 형님/);
    assert.match(R17_BOT_KANG_LOCK, /렌한테 청구서 보낼 테니까/);
    assert.equal(
      (TRPG_GM_SYSTEM.match(/sole authority for that AI PC's locked dialogue, choice, promise, payment, and movement/g) ?? [])
        .length,
      1
    );
    assert.match(TRPG_GM_SYSTEM, /Allowed speaker lines: locked PC lines, NPC, world voice, GM closing aside/);
    assert.match(TRPG_GM_SYSTEM, /sole authority for that human PC's voluntary action/);
    assert.match(TRPG_GM_SYSTEM, /When the round head says a finish request would end the campaign/);
    assert.equal((TRPG_GM_SYSTEM.match(/\[ROUND CRAFT\]/g) ?? []).length, 1);
  });

  it("asks for a new goal only on a continuing round, and gives an ending-ready round one finish head", () => {
    assert.equal(
      shouldRequestTrpgPlayerGoalRegistration({
        opening: false,
        campaignComplete: false,
        activeGoalCount: 0,
      }),
      true
    );
    assert.equal(
      shouldRequestTrpgPlayerGoalRegistration({
        opening: false,
        campaignComplete: false,
        activeGoalCount: 0,
        endingFinishWouldStand: true,
      }),
      false
    );
    const continuing = formatTrpgGmRoundHead({ opening: false, requestPlayerGoalRegistration: true });
    assert.match(continuing, /There is no active player-visible goal yet/);
    assert.doesNotMatch(continuing, /would end the campaign/);
    const ending = formatTrpgGmRoundHead({
      opening: false,
      requestPlayerGoalRegistration: true,
      endingFinishWouldStand: true,
    });
    assert.equal(ending, TRPG_GM_ENDING_FINISH_HEAD);
    assert.equal((ending.match(/RESOLVE THIS ROUND/g) ?? []).length, 1);
    assert.doesNotMatch(ending, /There is no active player-visible goal yet/);
    const wired = buildTrpgGmUserBlock({
      worldBrief: "센터",
      memoryBlock: "",
      opening: false,
      endingFinishWouldStand: true,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: R17_PLAYER_LOCK,
          participantKind: "human",
          statKey: "dex",
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.equal((wired.match(/A finish request on this round would end the campaign/g) ?? []).length, 1);
    assert.doesNotMatch(wired, /There is no active player-visible goal yet/);
    const regen = buildTrpgGmUserBlock({
      worldBrief: "센터",
      memoryBlock: "",
      opening: false,
      regenerate: true,
      committedFinishStands: true,
      committedNarration: R17_NARRATION,
      actions: [
        {
          participantId: 2,
          name: "권태현",
          body: R17_BOT_KWON_LOCK,
          participantKind: "ai_character",
          statKey: "dex",
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.match(regen, /no next-action question and no new goal/);
    assert.match(regen, /beyond a locked PC action/);
    assert.doesNotMatch(regen, /There is no active player-visible goal yet/);
  });

  it("an unguarded goal transition still adds on a continuing delta, which a finish commit must omit", () => {
    const confirmed = applyGoalTransition(
      [],
      { questsAdd: [GOAL] },
      { round: 0, placeMatches: () => false }
    ).goals.map((goal) => ({
      ...goal,
      status: "completed" as const,
      evidence: { kind: "host_confirmed" as const, round: 16, participantId: 1 },
    }));
    const unguarded = applyGoalTransition(
      confirmed,
      { questsAdd: [R17_QUEST_ADD] },
      { round: 17, placeMatches: () => false }
    );
    assert.equal(unguarded.goals.some((goal) => goal.status === "active" && goal.title === R17_QUEST_ADD), true);
    const finished = applyGoalTransition(confirmed, {}, { round: 17, placeMatches: () => false });
    assert.equal(finished.goals.some((goal) => goal.status === "active"), false);
    assert.equal(finished.goals.find((goal) => goal.id === confirmed[0]?.id)?.evidence?.kind, "host_confirmed");
  });

  it("treats a quote-only line as the bot's speech and leaves a sign or someone else's quoted line in the narration", () => {
    assert.deepEqual(lockedSpokenLines(R17_BOT_KWON_LOCK), [
      "무사는 무슨. 이 정도로 뻗으면 얼굴 들고 장사 못 하지.",
      "따뜻한 밥이든 독한 술이든, 사는 놈 뒤꽁무니나 얌전히 따라붙어 줄 테니까 얼른 앞장서 봐.",
    ]);
    assert.deepEqual(lockedSpokenLines(R17_BOT_KANG_LOCK), [
      "와, 진짜 폐 털릴 뻔했네. 넥서스 놈들 보안 시설 수준 한번 살벌하더라? 내 소중한 특제 볼트 하나 날린 값은 나중에 렌한테 청구서 보낼 테니까 딱 기다려.",
      "따뜻한 거 좋지. 기왕이면 아주 비싸고 기름진 걸로 가자고. 오늘 살아남은 값은 든든하게 뽑아 먹어야 직성이 풀리겠거든.",
    ]);
    const mixed = [
      '정원 철문에는 "출구 폐쇄"라고 적힌 표지판이 남아 있었다. 녹슨 판에는 "출구"가 보였다.',
      '렌이 "오늘은 여기까지"라고 했던 말이 아직 귀에 남았다.',
      "",
      "“무사는 무슨. 이 정도로 뻗으면 얼굴 들고 장사 못 하지.”",
    ].join("\n");
    assert.deepEqual(lockedSpokenLines(mixed), ["무사는 무슨. 이 정도로 뻗으면 얼굴 들고 장사 못 하지."]);
    const wire = gmAiActionText("권태현은 마체테를 집어넣으려 했다.", mixed);
    assert.match(wire, /무사는 무슨/);
    assert.doesNotMatch(wire, /출구 폐쇄/);
    assert.doesNotMatch(wire, /오늘은 여기까지/);
  });
});

describe("ending round commit", () => {
  it("keeps a new goal on a round that does not finish", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "식사",
      summary: "정원",
      content: "정원에서 쉰다.",
      visibility: "public",
      startLocation: EXPLORATION_ENTRANCE,
      scenarioPlan: PLAN,
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    let round = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      gmCall: async () => {
        round += 1;
        const opening = round === 1;
        return {
          text: buildTrpgGmStructuredWireText(opening ? "현관이다." : "아직 캠페인은 이어진다. 어느 쪽으로 갈 것인가?", {
            players: [],
            location: EXPLORATION_ENTRANCE,
            next_round_context: "다음",
            campaign_finished: false,
            questsAdd: [opening ? GOAL : CONTINUING_QUEST],
          }),
        };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "주변을 살핀다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const goals = loadCampaignLedger(db, campaignId).goals;
    assert.equal(goals.filter((goal) => goal.status === "active").length, 2);
    assert.ok(goals.some((goal) => goal.title === CONTINUING_QUEST && goal.status === "active"));
    assert.notEqual(
      (db.prepare(`SELECT status FROM trpg_campaigns WHERE id=?`).get(campaignId) as { status: string }).status,
      "CAMPAIGN_COMPLETE"
    );
    const narration = (
      db.prepare(
        `SELECT m.narration AS narration FROM trpg_gm_messages m JOIN trpg_rounds r ON r.id=m.round_id
         WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
      ).get(campaignId) as { narration: string }
    ).narration;
    assert.match(narration, /어느 쪽으로 갈 것인가/);
    const continuingStored = JSON.parse(
      (
        db.prepare(
          `SELECT m.structured_json AS json FROM trpg_gm_messages m JOIN trpg_rounds r ON r.id=m.round_id
           WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
        ).get(campaignId) as { json: string }
      ).json
    ) as { delta?: { questsAdd?: string[] } };
    const continuingApplied = JSON.parse(latestAppliedJson(db, campaignId)) as { questsAdd?: string[] };
    assert.deepEqual(continuingStored.delta?.questsAdd, [CONTINUING_QUEST]);
    assert.deepEqual(continuingApplied.questsAdd, continuingStored.delta?.questsAdd);
    db.close();
  });

  it("drops a new active goal and the choice question when the finish stands, then keeps that through read, recovery, and regen", async () => {
    const db = memoryDb();
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
    const kwonId = insertParticipant(db, {
      campaignId,
      slotIndex: 2,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "권태현",
    });
    const kangId = insertParticipant(db, {
      campaignId,
      slotIndex: 3,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "강이현",
    });
    writeSheet(db, campaignId, kwonId, "권태현", EVEN_STATS, EXPLORATION_ENTRANCE);
    writeSheet(db, campaignId, kangId, "강이현", EVEN_STATS, EXPLORATION_ENTRANCE);
    let mode: "opening" | "depart" | "claim" | "ending" | "regen" = "opening";
    let finishUser = "";
    let finishSystem = "";
    let regenUser = "";
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      botCall: async (_system, user) => {
        if (mode === "depart") return { text: "센터 밖으로 나간다.\n<<<ACTION_TYPE>>>\nfree\n<<<INTENT>>>\n센터 밖으로 나간다." };
        if (user.includes("[NAME]\n권태현")) {
          return {
            text: `${R17_BOT_KWON_LOCK}\n<<<ACTION_TYPE>>>\nfree\n<<<INTENT>>>\n권태현은 마체테를 집어넣고 긴장을 풀며 렌과 강이현의 뒤를 따라 번화가 산책로 쪽으로 걸음을 옮기려 했다.`,
          };
        }
        if (user.includes("[NAME]\n강이현")) {
          return {
            text: `${R17_BOT_KANG_LOCK}\n<<<ACTION_TYPE>>>\nfree\n<<<INTENT>>>\n강이현은 소형 석궁을 접어 허리춤에 수납한 뒤, 센터 외부 정원에서 기지개를 켜며 긴장을 풀고 렌과 권태현을 향해 식사 제안을 능청스럽게 맞받아쳤다.`,
          };
        }
        return { text: "자리를 지킨다.\n<<<ACTION_TYPE>>>\nfree\n<<<INTENT>>>\n자리를 지킨다." };
      },
      gmCall: async ({ system, user }) => {
        if (mode === "ending") {
          finishUser = user;
          finishSystem = system;
        }
        if (mode === "regen") {
          regenUser = user;
          return {
            text: buildTrpgGmStructuredWireText(`정원 쪽 조경등이 한 번 더 깜빡였다.\n\n${R17_NARRATION}`, {
              players: [],
              location: EXPLORATION_ENTRANCE,
              next_round_context: "끝난 밤",
              campaign_finished: false,
              questsAdd: [R17_QUEST_ADD],
            }),
          };
        }
        const opening = mode === "opening";
        const claim = mode === "claim";
        const ending = mode === "ending";
        return {
          text: buildTrpgGmStructuredWireText(
            ending ? R17_NARRATION : claim ? "전원이 시설 밖으로 나왔다. 탈출 목표는 해결되었다." : "서버가 정한 이탈만 잇는다.",
            {
              players: [],
              location: EXPLORATION_EXIT_ROOM,
              next_round_context: ending ? "렌, 권태현, 강이현은 야외 정원에서 숨을 골랐다." : "다음",
              campaign_finished: !opening,
              ...(opening ? { questsAdd: [GOAL] } : {}),
              ...(claim ? { questsClaimDone: [GOAL] } : {}),
              ...(ending ? { questsAdd: [R17_QUEST_ADD] } : {}),
            }
          ),
        };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    mode = "depart";
    const opened = alarmExit(loadExplorationState(db, campaignId)!);
    saveExplorationState(db, campaignId, opened);
    const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
    for (const id of [hostId, kwonId, kangId]) {
      const name = id === hostId ? "렌" : id === kwonId ? "권태현" : "강이현";
      writeSheet(db, campaignId, id, name, EVEN_STATS, EXPLORATION_EXIT_ROOM);
    }
    submitTrpgAction(db, { campaignId, userId: 1, body: R16 });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.notEqual(
      (db.prepare(`SELECT status FROM trpg_campaigns WHERE id=?`).get(campaignId) as { status: string }).status,
      "CAMPAIGN_COMPLETE"
    );

    mode = "claim";
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고른다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const claimed = loadCampaignLedger(db, campaignId).goals.find((goal) => goal.id === "goal-0-1");
    assert.ok(claimed?.claimedRound);
    assert.equal(
      answerTrpgGoalClaim(db, {
        campaignId,
        userId: 1,
        goalId: "goal-0-1",
        claimedRound: claimed.claimedRound,
        decision: "confirm",
      }).outcome,
      "confirmed"
    );

    mode = "ending";
    submitTrpgAction(db, { campaignId, userId: 1, body: R17_PLAYER_LOCK });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });

    assert.match(finishSystem, /sole authority for that AI PC's locked dialogue, choice, promise, payment, and movement/);
    assert.match(finishUser, /A finish request on this round would end the campaign/);
    assert.doesNotMatch(finishUser, /There is no active player-visible goal yet/);
    assert.match(finishUser, /사는 놈 뒤꽁무니나 얌전히 따라붙어/);
    assert.match(finishUser, /렌한테 청구서 보낼 테니까/);
    assert.match(finishUser, /오늘은 여기까지/);

    const goals = loadCampaignLedger(db, campaignId).goals;
    assert.equal(goals.some((goal) => goal.status === "active"), false);
    assert.equal(goals.find((goal) => goal.id === "goal-0-1")?.status, "completed");
    assert.equal(goals.find((goal) => goal.id === "goal-0-1")?.evidence?.kind, "host_confirmed");
    const storedRow = db
      .prepare(
        `SELECT m.narration AS narration, m.structured_json AS json
         FROM trpg_gm_messages m JOIN trpg_rounds r ON r.id=m.round_id
         WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
      )
      .get(campaignId) as { narration: string; json: string };
    const stored = JSON.parse(storedRow.json) as {
      campaignFinished?: boolean;
      effectiveCampaignFinished?: boolean;
      delta?: { questsAdd?: string[] };
    };
    assert.equal(stored.campaignFinished, true);
    assert.equal(stored.effectiveCampaignFinished, true);
    assert.equal(stored.delta?.questsAdd, undefined);
    const applied = JSON.parse(latestAppliedJson(db, campaignId)) as { questsAdd?: string[] };
    assert.equal(applied.questsAdd, undefined);
    assert.equal(Object.hasOwn(applied, "questsAdd"), Object.hasOwn(stored.delta ?? {}, "questsAdd"));
    assert.equal(narrationDemandsNextAction(storedRow.narration), false);
    assert.match(storedRow.narration, /드론 두어 대/);
    assert.match(storedRow.narration, /렌: "둘 다 무사해서 다행이야\."/);
    const read = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(read?.campaignStatus, "CAMPAIGN_COMPLETE");
    assert.equal(read?.goals.some((goal) => goal.status === "active"), false);
    assert.equal(read?.goals.find((goal) => goal.id === "goal-0-1")?.basis, "host");
    await assert.rejects(
      () => regenerateTrpgNarration(db, { campaignId, userId: 1, deps }),
      /끝난 캠페인/
    );

    const committed = db
      .prepare(
        `SELECT id, round_number, gm_committed_generation_id AS token
         FROM trpg_rounds WHERE campaign_id=? AND gm_committed_generation_id IS NOT NULL
         ORDER BY round_number DESC LIMIT 1`
      )
      .get(campaignId) as { id: number; round_number: number; token: string };
    db.prepare(`DELETE FROM trpg_rounds WHERE campaign_id=? AND round_number>?`).run(campaignId, committed.round_number);
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='APPLYING_STATE', gm_generation_id=?, lock_holder_request_id=?,
           gm_generation_heartbeat_at=datetime('now', '-180 seconds'),
           updated_at=datetime('now', '-180 seconds')
       WHERE id=?`
    ).run(committed.token, committed.token, committed.id);
    db.prepare(`UPDATE trpg_campaigns SET status='ACTION_INPUT' WHERE id=?`).run(campaignId);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const recovered = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(recovered?.campaignStatus, "CAMPAIGN_COMPLETE");
    assert.equal(recovered?.goals.some((goal) => goal.status === "active"), false);
    assert.equal(recovered?.goals.find((goal) => goal.id === "goal-0-1")?.basis, "host");
    const recoveredNarration = (
      db.prepare(
        `SELECT m.narration AS narration FROM trpg_gm_messages m JOIN trpg_rounds r ON r.id=m.round_id
         WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
      ).get(campaignId) as { narration: string }
    ).narration;
    assert.equal(narrationDemandsNextAction(recoveredNarration), false);

    db.prepare(`UPDATE trpg_campaigns SET status='ACTION_INPUT' WHERE id=?`).run(campaignId);
    mode = "regen";
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    assert.match(regenUser, /no next-action question and no new goal/);
    assert.match(regenUser, /사는 놈 뒤꽁무니나 얌전히 따라붙어/);
    const regenerated = db
      .prepare(
        `SELECT m.narration AS narration, m.structured_json AS json
         FROM trpg_gm_messages m JOIN trpg_rounds r ON r.id=m.round_id
         WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
      )
      .get(campaignId) as { narration: string; json: string };
    const regeneratedStored = JSON.parse(regenerated.json) as {
      effectiveCampaignFinished?: boolean;
      delta?: { questsAdd?: string[] };
    };
    assert.equal(narrationDemandsNextAction(regenerated.narration), false);
    assert.match(regenerated.narration, /조경등이 한 번 더 깜빡였다/);
    assert.match(regenerated.narration, /드론 두어 대/);
    assert.equal(regeneratedStored.delta?.questsAdd, undefined);
    assert.equal(regeneratedStored.effectiveCampaignFinished, true);
    const appliedAfterRegen = JSON.parse(latestAppliedJson(db, campaignId)) as { questsAdd?: string[] };
    assert.equal(appliedAfterRegen.questsAdd, undefined);
    assert.equal(loadCampaignLedger(db, campaignId).goals.some((goal) => goal.status === "active"), false);
    assert.equal(
      loadCampaignLedger(db, campaignId).goals.find((goal) => goal.id === "goal-0-1")?.evidence?.kind,
      "host_confirmed"
    );
    db.close();
  });
});
