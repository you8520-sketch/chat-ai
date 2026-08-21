import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CONTEXTUAL_FIRST_AID_DRAFT,
  CONTEXTUAL_PARALYSIS_TREAT_DRAFT,
  CONTEXTUAL_SAFE_REST_DRAFT,
  contextualFirstAidDraft,
  contextualSafeRestDraft,
  contextualStatusTreatDraft,
  showContextualFirstAid,
  showContextualStatusTreat,
} from "./actionComposer";
import { TRPG_ACTION_TYPES } from "./actionTypes";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { resolveRoundMechanics } from "./mechanicsResolve";
import { insertOngoingEffect, loadLatestCompleteMechanics } from "./mechanicsStore";
import { formatMechanicsHudLines } from "./sheetHud";
import { evaluateSafeRestEligibility } from "./mechanicsValidate";
import { basicFirstAidHpCeiling, safeRestHealAmount } from "./mechanicsDice";
import type { MechanicsActorInput, MechanicsResolution, TrpgOngoingEffect } from "./mechanicsTypes";
import type { TrpgSheetSnapshot } from "./types";
import { ensureTrpgTables } from "./schema";

function sheet(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return {
    participantId: 1,
    name: "강이현",
    playerName: "현",
    level: 1,
    hp: 20,
    maxHp: 25,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: [],
    inventory: [],
    location: "",
    modifiersNote: "",
    ...partial,
  };
}

function ally(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return sheet({ participantId: 2, name: "렌", playerName: "렌", inventory: [], ...partial });
}

function extra(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return sheet({ participantId: 3, name: "카이", playerName: "카이", inventory: ["해독제"], ...partial });
}

function actor(partial: Partial<MechanicsActorInput> = {}): MechanicsActorInput {
  return {
    participantId: 1,
    name: "강이현",
    actionType: "support",
    body: "상처를 응급처치한다",
    tier: "SUCCESS",
    d20: 14,
    modifier: 1,
    finalScore: 15,
    dc: 12,
    statKey: "wis",
    ...partial,
  };
}

function poison(partial: Partial<TrpgOngoingEffect> = {}): TrpgOngoingEffect {
  return {
    id: 10,
    campaignId: 1,
    participantId: 1,
    label: "중독",
    kind: "periodic_harm",
    severity: "MEDIUM",
    stackKey: "poison",
    stackPolicy: "refresh",
    sourceRound: 5,
    appliedRound: 5,
    startsRound: 6,
    tickClass: "LIGHT",
    remainingTicks: 3,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: "specific_item",
    requiredItem: "해독제",
    actionModifier: 0,
    metadata: {},
    ...partial,
  };
}

function resolve(partial: Partial<Parameters<typeof resolveRoundMechanics>[0]>): MechanicsResolution {
  return resolveRoundMechanics({
    campaignId: 1,
    roundId: 300,
    roundNumber: 6,
    sheets: [sheet()],
    effects: [],
    actors: [actor()],
    flash: null,
    fallback: "none",
    calledFlash: true,
    model: "deepseek-v4-flash-0731",
    latencyMs: 4,
    baseDc: 12,
    rng: () => 4,
    recoveryRng: () => 1,
    scene: "안전한 폐허 안쪽. 적이 보이지 않는다.",
    ...partial,
  });
}

describe("TRPG P0-2 + universal recovery", () => {
  it("A. HP3 + poison4 + attack → pre-action HP0, no d20 path in resolution", () => {
    const pre = resolve({
      sheets: [sheet({ hp: 3 })],
      effects: [poison({ treatmentMode: "item_or_support", requiredItem: null })],
      actors: [actor({ actionType: "attack", body: "벤다", tier: "FAILURE" })],
      preActionOnly: true,
      rng: () => 4,
    });
    assert.equal(pre.preActionOwnerComplete, true);
    assert.equal(pre.complete, false);
    assert.equal(pre.applied, false);
    assert.equal(pre.hpAfter["1"], 0);
    assert.equal(pre.ongoingTicks.length, 1);
    assert.ok((pre.incapacitated ?? []).some((row) => row.participantId === 1));

    const out = resolve({
      sheets: [sheet({ hp: 3 })],
      effects: [poison({ treatmentMode: "item_or_support", requiredItem: null })],
      actors: [actor({ actionType: "attack", body: "벤다", tier: "FAILURE" })],
      existing: pre,
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "HEAVY", cause: "enemy_counter" }],
      },
      rng: () => 4,
    });
    assert.equal(out.actors[0]?.skipReason, "PRE_ACTION_HP_ZERO");
    assert.equal(out.actors[0]?.direct?.effect, "none");
    assert.match(out.packet, /PRE_ACTION_HP_ZERO/);
    assert.equal(out.ongoingTicks[0]?.dice?.amount, pre.ongoingTicks[0]?.dice?.amount);
  });

  it("B. support FAILURE + Flash HEAVY heal → heal 0", () => {
    const out = resolve({
      actors: [actor({ body: "상처를 응급처치한다", tier: "FAILURE" })],
      flash: {
        effects: [{ participantId: 1, directEffect: "heal", directClass: "HEAVY", cause: "healing" }],
      },
    });
    assert.equal(out.actors[0]?.direct?.effect, "none");
    assert.equal(out.hpAfter["1"], 20);
  });

  it("C. support SUCCESS cover fire + Flash heal → heal 0", () => {
    const out = resolve({
      actors: [actor({ actionType: "support", body: "엄호 사격한다", tier: "SUCCESS" })],
      flash: {
        effects: [{ participantId: 1, directEffect: "heal", directClass: "MEDIUM", cause: "healing" }],
      },
    });
    assert.equal(out.actors[0]?.direct?.effect, "none");
    assert.equal(out.hpAfter["1"], 20);
  });

  it("D. support SUCCESS first aid → heal allowed", () => {
    const out = resolve({
      sheets: [sheet({ hp: 8 })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "SUCCESS" })],
    });
    assert.equal(out.actors[0]?.direct?.effect, "heal");
    assert.ok((out.hpAfter["1"] ?? 0) > 8);
  });

  it("E. itemless basic first aid maxHP30 / current8 → heal allowed", () => {
    const out = resolve({
      sheets: [sheet({ hp: 8, maxHp: 30, inventory: [] })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "SUCCESS" })],
    });
    assert.equal(out.actors[0]?.direct?.effect, "heal");
    assert.ok((out.hpAfter["1"] ?? 0) > 8);
    assert.ok((out.hpAfter["1"] ?? 0) <= basicFirstAidHpCeiling(30));
  });

  it("F. repeated itemless first aid cannot exceed 70% ceiling", () => {
    const ceiling = basicFirstAidHpCeiling(30);
    assert.equal(ceiling, 21);
    const out = resolve({
      sheets: [sheet({ hp: 20, maxHp: 30, inventory: [] })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "CRITICAL_SUCCESS" })],
      rng: () => 8,
    });
    assert.ok((out.hpAfter["1"] ?? 0) <= 21);
    const again = resolve({
      sheets: [sheet({ hp: 21, maxHp: 30, inventory: [] })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "CRITICAL_SUCCESS" })],
      rng: () => 8,
    });
    assert.equal(again.hpAfter["1"], 21);
  });

  it("G. valid medkit treatment may exceed 70% ceiling", () => {
    const out = resolve({
      sheets: [sheet({ hp: 20, maxHp: 30, inventory: ["구급키트"] })],
      actors: [actor({ actionType: "use_item", body: "구급키트를 사용한다", tier: "GREAT_SUCCESS" })],
      rng: () => 8,
    });
    assert.equal(out.actors[0]?.direct?.effect, "heal");
    assert.ok((out.hpAfter["1"] ?? 0) > basicFirstAidHpCeiling(30));
  });

  it("H. A has no antidote, C has it → C unchanged, treatment rejected", () => {
    const out = resolve({
      sheets: [sheet({ inventory: [] }), ally({ hp: 12 }), extra({ inventory: ["해독제"] })],
      effects: [poison({ participantId: 2 })],
      actors: [actor({ actionType: "support", body: "렌에게 해독제를 사용한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [10],
            consumeItem: "해독제",
          },
        ],
      },
    });
    assert.ok(!out.ongoingClearedIds.includes(10));
    assert.deepEqual(out.consumeItems, []);
    assert.deepEqual(extra().inventory, ["해독제"]);
  });

  it("I. ally heal HUD is target-owned", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 20 }), ally({ hp: 10 })],
      actors: [actor({ body: "렌의 상처를 응급처치한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "heal",
            directClass: "LIGHT",
            cause: "healing",
          },
        ],
      },
    });
    const applied = { ...resolution, applied: true };
    const sourceLines = formatMechanicsHudLines(applied, 1);
    const targetLines = formatMechanicsHudLines(applied, 2);
    assert.equal(sourceLines.some((line) => line.startsWith("회복")), false);
    assert.equal(targetLines.some((line) => line.startsWith("회복")), true);
    assert.match(targetLines.join("\n"), /HP 10 →/);
  });

  it("J. complete=true applied=false hides HUD damage", () => {
    const resolution = resolve({
      actors: [actor({ actionType: "attack", body: "벤다", tier: "FAILURE" })],
      scene: "적이 받아친다. 전투.",
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "HEAVY", cause: "enemy_counter" }],
      },
    });
    assert.equal(resolution.complete, true);
    assert.equal(resolution.applied, false);
    assert.deepEqual(formatMechanicsHudLines(resolution, 1), []);
  });

  it("K. same source direct B + C → exactly one target modified", () => {
    const out = resolve({
      sheets: [sheet({ hp: 20 }), ally({ hp: 10 }), extra({ hp: 10, inventory: [] })],
      actors: [actor({ body: "상처를 응급처치한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "heal",
            directClass: "LIGHT",
            cause: "healing",
          },
          {
            sourceParticipantId: 1,
            targetParticipantId: 3,
            directEffect: "heal",
            directClass: "LIGHT",
            cause: "healing",
          },
        ],
      },
    });
    const changed = [out.hpAfter["2"] !== 10, out.hpAfter["3"] !== 10].filter(Boolean).length;
    assert.equal(changed, 1);
    assert.equal(out.hpAfter["3"] === 10 || out.hpAfter["2"] === 10, true);
  });

  it("L. safe rest in safe scene → no d20, deterministic 20% heal", () => {
    const out = resolve({
      sheets: [sheet({ hp: 10, maxHp: 25 })],
      actors: [actor({ actionType: "free", body: "안전한 곳에서 잠시 휴식하며 상처를 추스른다.", tier: null, d20: null })],
      calledFlash: false,
      flash: null,
    });
    const expected = safeRestHealAmount(25);
    assert.equal(expected, 5);
    assert.equal(out.safeRests?.[0]?.allowed, true);
    assert.equal(out.safeRests?.[0]?.amount, expected);
    assert.equal(out.hpAfter["1"], 15);
    assert.equal(out.actors[0]?.direct?.effect, "none");
    assert.match(out.packet, /SAFE REST/);
    assert.match(out.packet, /no d20/);
  });

  it("M. safe rest during combat → heal 0", () => {
    const out = resolve({
      sheets: [sheet({ hp: 10 })],
      actors: [actor({ actionType: "free", body: "휴식한다", tier: null, d20: null })],
      scene: "총격이 오가는 전투. 적습이 계속된다.",
    });
    assert.equal(out.safeRests?.[0]?.allowed, false);
    assert.equal(out.safeRests?.[0]?.reason, "physical_threat");
    assert.equal(out.hpAfter["1"], 10);
  });

  it("N. safe rest cooldown violation → heal 0", () => {
    const out = resolve({
      sheets: [sheet({ hp: 10 })],
      actors: [actor({ actionType: "free", body: "휴식한다", tier: null, d20: null })],
      lastSafeRestByParticipant: { "1": 3 },
      roundNumber: 6,
    });
    assert.equal(out.safeRests?.[0]?.allowed, false);
    assert.equal(out.safeRests?.[0]?.reason, "cooldown");
    assert.equal(out.hpAfter["1"], 10);
  });

  it("O. safe rest while poisoned → HP recovers, poison remains", () => {
    const out = resolve({
      sheets: [sheet({ hp: 14 })],
      effects: [poison({ treatmentMode: "item_or_support", requiredItem: null, tickClass: "LIGHT" })],
      actors: [actor({ actionType: "free", body: "안전한 곳에서 쉰다", tier: null, d20: null })],
      rng: () => 3,
    });
    assert.ok((out.ongoingTicks[0]?.hpAfter ?? 14) < 14);
    assert.equal(out.safeRests?.[0]?.allowed, true);
    assert.ok((out.hpAfter["1"] ?? 0) > (out.ongoingTicks[0]?.hpAfter ?? 0));
    assert.ok(!out.ongoingClearedIds.includes(10));
  });

  it("P/Q. safe rest GM failure leaves DB unchanged; retry does not double heal", () => {
    const first = resolve({
      sheets: [sheet({ hp: 10, maxHp: 25 })],
      actors: [actor({ actionType: "free", body: "휴식한다", tier: null, d20: null })],
    });
    assert.equal(first.applied, false);
    assert.equal(first.hpAfter["1"], 15);
    assert.equal(first.complete, true);
    const retry = resolve({ existing: { ...first, complete: true, applied: false } });
    assert.equal(retry.hpAfter["1"], 15);
    assert.equal(retry.safeRests?.[0]?.amount, first.safeRests?.[0]?.amount);
  });
});

describe("TRPG contextual recovery UI", () => {
  it("R. first aid click fills support draft and does not auto-submit", () => {
    const draft = contextualFirstAidDraft({ hp: 8, maxHp: 30, effectLabels: [] });
    assert.equal(draft.actionType, "support");
    assert.equal(draft.body, CONTEXTUAL_FIRST_AID_DRAFT);
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /data-contextual="first-aid"/);
    assert.match(room, /data-contextual="status-treat"/);
    assert.match(room, /onActionTypeChange\(firstAidDraft\.actionType\)/);
    assert.match(room, /onActionBodyChange\(firstAidDraft\.body\)/);
    assert.match(room, /onActionTypeChange\(statusTreatDraft\.actionType\)/);
    assert.match(room, /onActionBodyChange\(statusTreatDraft\.body\)/);
    assert.doesNotMatch(room, /data-contextual="first-aid"[\s\S]{0,400}onSendAction\(\)/);
    assert.doesNotMatch(room, /data-contextual="status-treat"[\s\S]{0,400}onSendAction\(\)/);
    assert.ok(!TRPG_ACTION_TYPES.includes("heal" as (typeof TRPG_ACTION_TYPES)[number]));
    assert.ok(!TRPG_ACTION_TYPES.includes("first_aid" as (typeof TRPG_ACTION_TYPES)[number]));
    assert.ok(!TRPG_ACTION_TYPES.includes("rest" as (typeof TRPG_ACTION_TYPES)[number]));
  });

  it("safe rest button visibility follows server eligibility only", () => {
    const damaged = evaluateSafeRestEligibility({
      hp: 10,
      maxHp: 25,
      scene: "안전한 방. 불이 꺼져 있다.",
      sameRoundCombat: false,
      lastSafeRestRound: null,
      currentRound: 2,
    });
    assert.equal(damaged.available, true);
    assert.equal(damaged.healAmount, 5);
    assert.equal(
      evaluateSafeRestEligibility({
        hp: 25,
        maxHp: 25,
        scene: "안전한 방",
        sameRoundCombat: false,
        lastSafeRestRound: null,
        currentRound: 2,
      }).available,
      false
    );
    assert.equal(
      evaluateSafeRestEligibility({
        hp: 10,
        maxHp: 25,
        scene: "총격과 적습이 계속된다.",
        sameRoundCombat: false,
        lastSafeRestRound: null,
        currentRound: 2,
      }).available,
      false
    );
    assert.equal(
      evaluateSafeRestEligibility({
        hp: 10,
        maxHp: 25,
        scene: "안전한 방",
        sameRoundCombat: true,
        lastSafeRestRound: null,
        currentRound: 2,
      }).blockedReason,
      "combat_active"
    );
    assert.equal(
      evaluateSafeRestEligibility({
        hp: 10,
        maxHp: 25,
        scene: "안전한 방",
        sameRoundCombat: false,
        lastSafeRestRound: 2,
        currentRound: 4,
      }).blockedReason,
      "cooldown"
    );
    assert.equal(showContextualFirstAid({ hp: 10, maxHp: 25, treatableOngoing: false }), true);
    assert.equal(showContextualFirstAid({ hp: 25, maxHp: 25, treatableOngoing: true }), false);
    assert.equal(showContextualStatusTreat({ treatableOngoing: true }), true);
    assert.equal(showContextualStatusTreat({ treatableOngoing: false }), false);
    assert.equal(contextualStatusTreatDraft(["마비"]).body, CONTEXTUAL_PARALYSIS_TREAT_DRAFT);
    const restDraft = contextualSafeRestDraft();
    assert.equal(restDraft.actionType, "free");
    assert.equal(restDraft.body, CONTEXTUAL_SAFE_REST_DRAFT);
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /data-contextual="safe-rest"/);
    assert.match(room, /snap\.safeRest/);
    assert.doesNotMatch(room, /hasPhysicalThreatCue/);
    assert.doesNotMatch(room, /data-contextual="safe-rest"[\s\S]{0,400}onSendAction\(\)/);
    const snap = readFileSync("src/lib/trpg/engineSnapshot.ts", "utf8");
    assert.match(snap, /evaluateSafeRestEligibility/);
  });
});

describe("TRPG recovery engine persist / HUD commit", () => {
  it("A-engine. pre-action DOT-downed actor gets no d20 row or currentRoll", async () => {
      const db = new Database(":memory:");
      ensureTrpgTables(db);
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 6,
        rollDie: () => 4,
        gmCall: async () => ({
          text: `<<<NARRATION>>>
쓰러진다.
<<<DELTA>>>
{"players":[],"location":"폐허","next_round_context":"","campaign_finished":false}`,
        }),
      };
      const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });
      const host = db
        .prepare(`SELECT participant_id AS id FROM trpg_character_sheets WHERE campaign_id=?`)
        .get(campaignId) as { id: number };
      const round = db
        .prepare(`SELECT id, round_number FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number DESC LIMIT 1`)
        .get(campaignId) as { id: number; round_number: number };
      // maxHp=40 makes the minimum LIGHT tick 2 HP; hp=1 guarantees this test exercises the downed path.
      db.prepare(`UPDATE trpg_character_sheets SET hp=1 WHERE participant_id=?`).run(host.id);
      insertOngoingEffect(db, {
        campaignId,
        participantId: host.id,
        label: "중독",
        kind: "periodic_harm",
        severity: "LIGHT",
        stackKey: "poison",
        stackPolicy: "refresh",
        sourceRound: round.round_number - 1,
        appliedRound: round.round_number - 1,
        startsRound: round.round_number,
        tickClass: "LIGHT",
        remainingTicks: 2,
        lastTickRound: null,
        recoveryMode: "save_or_treatment",
        recoveryStat: "res",
        treatmentMode: "item_or_support",
        requiredItem: null,
        actionModifier: 0,
        metadata: {},
      });
      submitTrpgAction(db, { campaignId, userId: 1, body: "검으로 벤다.", actionType: "attack" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      const rolls = db
        .prepare(
          `SELECT r.id FROM trpg_dice_rolls r
           JOIN trpg_action_submissions s ON s.id = r.submission_id
           WHERE s.participant_id=? AND s.round_id=?`
        )
        .all(host.id, round.id) as Array<{ id: number }>;
      assert.equal(rolls.length, 0);
      const snap = loadTrpgSnapshot(db, campaignId, 1);
      assert.equal((snap?.currentRolls ?? []).some((row) => row.participantId === host.id), false);
      const stored = loadLatestCompleteMechanics(db, campaignId);
      assert.match(stored?.packet ?? "", /PRE_ACTION_HP_ZERO/);
      db.close();
  });
});
