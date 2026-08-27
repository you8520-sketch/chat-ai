import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  actionNeedsCheck,
  classifyChallengeKind,
  hasChallengeSignal,
  isTalkOnlyAction,
  resolveTrpgActionCheckDecision,
  stripQuotedDialogue,
  stripTalkWrappers,
} from "./actionCheck";
import { parseTrpgBotAction } from "./botActionParse";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { insertParticipant } from "./store";
import { ensureTrpgTables } from "./schema";
import {
  buildRoundPresentationActors,
  walkCinematicPresentation,
} from "./roundPresentation";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(narration = "장면이 이어진다."): string {
  return `<<<NARRATION>>>\n${narration}\n<<<DELTA>>>\n${JSON.stringify({
    players: [],
    location: "폐허",
    next_round_context: "다음",
    campaign_finished: false,
  })}`;
}

const CASE_49_PROSE =
  "이현은 셔터에 어깨를 댄 채 시선을 좁혔다. 천장 돌기는 렌의 머리 위에서 내려올 타이밍을 재고 있었고, 발밑 포자층은 이미 함몰 경계까지 얇게 갈라져 있었다. 「태현, 천천히.」";
const CASE_49_INTENT =
  "강이현은 셔터를 버티며 벽면 함몰과 숙주 사이 포자 흐름 위로 내밀어 통로를 유지하려 한다.";

const CASE_48_PROSE =
  "태현은 이미 한 발을 문턱 안쪽으로 들여놓고 있었다. 통로가 넓어졌다는 말은 곧 렌이 등을 비운다는 뜻이었다. 그는 뒤로 빠지지 않았다.";
const CASE_48_INTENT =
  "권태현은 렌 앞을 가로막으며 출입구 안쪽에서 마체테를 세운 채 사각을 막으려 했다.";

describe("TRPG action-check semantic alignment", () => {
  it("CASE_49_EQUIVALENT: hazard vocabulary + coordination dialogue skips check", () => {
    const decision = resolveTrpgActionCheckDecision({
      body: CASE_49_PROSE,
      intent: CASE_49_INTENT,
      actionType: "support",
    });
    assert.equal(decision.needsCheck, false);
    assert.equal(decision.reason, "support_setup");
  });

  it("CASE_48_EQUIVALENT: visible physical entry keeps check despite setup intent", () => {
    const decision = resolveTrpgActionCheckDecision({
      body: CASE_48_PROSE,
      intent: CASE_48_INTENT,
      actionType: "support",
    });
    assert.equal(decision.needsCheck, true);
    assert.equal(decision.reason, "challenge");
  });

  it("TALK_HAZARD_NOUN_ONLY: discussing spores is not a roll", () => {
    assert.equal(
      actionNeedsCheck({ body: "「저쪽 포자 위험한데?」", actionType: "free" }),
      false
    );
    assert.equal(
      actionNeedsCheck({ body: "포자 얘기를 한다.", actionType: "free" }),
      false
    );
  });

  it("AMBIENT_HAZARD_MENTION_ONLY: looking at debris/spores is not a roll", () => {
    assert.equal(
      actionNeedsCheck({ body: "잔해를 바라본다.", actionType: "free" }),
      false
    );
    assert.equal(
      actionNeedsCheck({
        body: "천장 돌기를 재고 있었고, 발밑 포자층이 갈라져 있었다.",
        actionType: "support",
      }),
      false
    );
    assert.equal(
      actionNeedsCheck({ body: "수상한 것 같다고 말한다.", actionType: "free" }),
      false
    );
    assert.equal(
      actionNeedsCheck({ body: "잠긴 문이라고 알려준다.", actionType: "free" }),
      false
    );
  });

  it("VISIBLE_HAZARD_ACTION: committed hazard attempts still roll", () => {
    assert.equal(
      actionNeedsCheck({ body: "잔해를 뛰어넘는다.", actionType: "free" }),
      true
    );
    assert.equal(
      actionNeedsCheck({ body: "포자 지대로 들어간다.", actionType: "free" }),
      true
    );
    assert.equal(
      actionNeedsCheck({ body: "맨손으로 위험물을 붙잡는다.", actionType: "free" }),
      true
    );
    assert.equal(
      actionNeedsCheck({ body: "잠긴 문을 억지로 연다.", actionType: "free" }),
      true
    );
  });

  it("INTENT_CANNOT_DOWNGRADE_VISIBLE_RISK", () => {
    assert.equal(
      resolveTrpgActionCheckDecision({
        body: CASE_48_PROSE,
        intent: CASE_48_INTENT,
        actionType: "support",
      }).needsCheck,
      true
    );
  });

  it("INTENT_CANNOT_UPGRADE_PURE_TALK_TO_INVISIBLE_RISK", () => {
    assert.equal(
      resolveTrpgActionCheckDecision({
        body: "「알겠어. 포자 조심해.」",
        intent: "포자 지대를 맨몸으로 가로질러 들어가려 한다.",
        actionType: "support",
      }).needsCheck,
      false
    );
  });

  it("intent may disambiguate genuinely ambiguous non-talk action", () => {
    assert.equal(
      resolveTrpgActionCheckDecision({
        body: "권태현은 몸을 낮추며 앞으로 간다.",
        intent: "권태현은 렌 앞을 가로막으며 형체의 진입을 막으려 했다.",
        actionType: "support",
      }).needsCheck,
      true
    );
  });

  it("explicit resolution types remain authoritative", () => {
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "「조용히 갈게.」", actionType: "stealth" }).reason,
      "explicit_resolution"
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "주변을 본다.", actionType: "investigate" }).needsCheck,
      true
    );
  });

  it("use_item regressions: ordinary therapeutic vs hazardous application", () => {
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "붕대를 사용한다.", actionType: "use_item" }).needsCheck,
      false
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "잠긴 문에 공구를 억지로 들이민다.", actionType: "use_item" })
        .needsCheck,
      true
    );
    assert.equal(
      resolveTrpgActionCheckDecision({ body: "상처를 응급처치한다.", actionType: "support" }).needsCheck,
      true
    );
  });

  it("hazard noun tokens are context-dependent, not bare triggers", () => {
    const ambient = "포자층이 갈라져 있었다.";
    const action = "포자 지대를 가로질러 들어간다.";
    assert.equal(hasChallengeSignal(ambient), false);
    assert.equal(classifyChallengeKind(ambient), null);
    assert.equal(hasChallengeSignal(action), true);
    assert.equal(stripTalkWrappers("「포자 위험해.」"), "");
    assert.equal(isTalkOnlyAction("「포자 위험해.」"), true);
  });

  it("PURE_SPOKEN_HAZARD_WITH_ACTION_VERB: warning dialogue is not an actor hazard attempt", () => {
    const body = "「포자 지대로 들어가면 위험해.」";
    assert.equal(actionNeedsCheck({ body, actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body, actionType: "support" }), false);
    assert.equal(stripQuotedDialogue(body), "");
  });

  it("SPOKEN_FORCED_DOOR: warning about forcing a door is not a roll", () => {
    const body = "「잠긴 문을 억지로 열면 위험해.」";
    assert.equal(actionNeedsCheck({ body, actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body, actionType: "support" }), false);
  });

  it("STAGE_DIRECTION_REAL_HAZARD: *stage* hazard action still rolls", () => {
    const body = "*포자 지대로 들어간다* 「뒤따라와.」";
    assert.equal(actionNeedsCheck({ body, actionType: "free" }), true);
    assert.equal(classifyChallengeKind(stripQuotedDialogue(body)), "hazard");
  });

  it("STAGE_DIRECTION_FORCED_DOOR: *stage* forced entry still rolls", () => {
    const body = "*잠긴 문을 억지로 연다.*";
    assert.equal(actionNeedsCheck({ body, actionType: "free" }), true);
    assert.equal(classifyChallengeKind(stripQuotedDialogue(body)), "hazard");
  });

  it("MIXED_HARMLESS_ACTION_PLUS_RISK_SPEECH: flavor action with quoted hazard talk skips check", () => {
    const body = "고개를 끄덕인다. 「포자 지대로 들어가야 할 것 같아.」";
    assert.equal(actionNeedsCheck({ body, actionType: "free" }), false);
    assert.equal(classifyChallengeKind(stripQuotedDialogue(body)), null);
  });
});

describe("TRPG persistRolls presentation integration", () => {
  it("persists roll on risky support actor3 only and presentation follows ownership", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      gmCall: async () => ({ text: gmText() }),
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const allyA = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "강이현",
    });
    const allyB = insertParticipant(db, {
      campaignId,
      slotIndex: 2,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "권태현",
    });
    writeSheet(db, campaignId, allyA, "강이현", EVEN_STATS, "");
    writeSheet(db, campaignId, allyB, "권태현", EVEN_STATS, "");
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });

    const human = db
      .prepare(`SELECT participant_id AS id FROM trpg_character_sheets WHERE campaign_id=?`)
      .get(campaignId) as { id: number };
    const round = db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number DESC LIMIT 1`)
      .get(campaignId) as { id: number };

    submitTrpgAction(db, { campaignId, userId: 1, body: "검으로 벤다.", actionType: "attack" });
    db.prepare(
      `INSERT INTO trpg_action_submissions
        (round_id, participant_id, body, action_type, locked, source)
       VALUES (?, ?, ?, 'support', 1, 'bot_model')`
    ).run(
      round.id,
      allyA,
      `${CASE_49_PROSE}\n\n<<<INTENT>>>\n${CASE_49_INTENT}\n\n<<<ACTION_TYPE>>>\nsupport`
    );
    db.prepare(
      `INSERT INTO trpg_action_submissions
        (round_id, participant_id, body, action_type, locked, source)
       VALUES (?, ?, ?, 'support', 1, 'bot_model')`
    ).run(
      round.id,
      allyB,
      `${CASE_48_PROSE}\n\n<<<INTENT>>>\n${CASE_48_INTENT}\n\n<<<ACTION_TYPE>>>\nsupport`
    );

    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });

    const rolls = db
      .prepare(
        `SELECT s.participant_id AS participantId
         FROM trpg_dice_rolls r
         JOIN trpg_action_submissions s ON s.id = r.submission_id
         WHERE r.round_id=?`
      )
      .all(round.id) as { participantId: number }[];

    const rollSet = new Set(rolls.map((row) => row.participantId));
    assert.equal(rollSet.has(human.id), true, "actor1 roll");
    assert.equal(rollSet.has(allyA), false, "actor2 no roll");
    assert.equal(rollSet.has(allyB), true, "actor3 roll");

    const resolutionOrder = [human.id, allyA, allyB];
    const actions = resolutionOrder.map((participantId, index) => {
      const row = db
        .prepare(`SELECT body FROM trpg_action_submissions WHERE round_id=? AND participant_id=?`)
        .get(round.id, participantId) as { body: string };
      const parsed = parseTrpgBotAction(row.body);
      return {
        participantId,
        name: index === 0 ? "렌" : index === 1 ? "강이현" : "권태현",
        body: parsed.prose,
        revealed: true,
        kind: index === 0 ? "human" : "ai_character",
        actionType: "support" as const,
      };
    });
    const rollRows = db
      .prepare(
        `SELECT s.participant_id AS participantId, r.d20, r.stat_key AS statKey, r.dc, r.tier, r.final_score AS finalScore
         FROM trpg_dice_rolls r
         JOIN trpg_action_submissions s ON s.id = r.submission_id
         WHERE r.round_id=?`
      )
      .all(round.id) as Array<{
      participantId: number;
      d20: number;
      statKey: string;
      dc: number;
      tier: string;
      finalScore: number;
    }>;

    const actors = buildRoundPresentationActors({
      resolutionOrder,
      actions,
      rolls: rollRows.map((row) => ({
        participantId: row.participantId,
        name: actions.find((action) => action.participantId === row.participantId)?.name ?? "",
        d20: row.d20,
        statKey: row.statKey,
        dc: row.dc,
        tier: row.tier,
        finalScore: row.finalScore,
        success: row.tier === "SUCCESS" || row.tier === "CRITICAL_SUCCESS",
        actionBody: "",
        actionType: "support" as const,
        kind: row.participantId === human.id ? "human" : "ai_character",
      })),
    });

    const frames = walkCinematicPresentation(actors);
    const diceFrames = frames.filter((frame) => frame.phase === "actor-dice");
    assert.deepEqual(
      diceFrames.map((frame) => frame.activeRollActorId),
      [human.id, allyB]
    );
    assert.equal(diceFrames.some((frame) => frame.activeRollActorId === allyA), false);

    const allyAIndex = actors.findIndex((actor) => actor.actorId === allyA);
    const allyBIndex = actors.findIndex((actor) => actor.actorId === allyB);
    const allyADiceIdx = frames.findIndex(
      (frame) => frame.phase === "actor-dice" && frame.presentationIndex === allyAIndex
    );
    assert.equal(allyADiceIdx, -1);
    const allyBActionIdx = frames.findIndex(
      (frame) => frame.phase === "actor-action" && frame.presentationIndex === allyBIndex
    );
    const allyBDiceIdx = frames.findIndex(
      (frame) => frame.phase === "actor-dice" && frame.presentationIndex === allyBIndex
    );
    assert.ok(allyBActionIdx >= 0 && allyBDiceIdx > allyBActionIdx);

    db.close();
  });
});
