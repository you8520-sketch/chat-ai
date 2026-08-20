import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMechanicsOwnedDelta } from "./mechanicsMerge";
import { resolveRoundMechanics, shouldCallMechanicsFlash } from "./mechanicsResolve";
import { totalOngoingDamageCap } from "./mechanicsDice";
import type { FlashMechanicsOutput, MechanicsActorInput, MechanicsResolution, TrpgOngoingEffect } from "./mechanicsTypes";
import type { TrpgSheetSnapshot } from "./types";

function sheet(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return {
    participantId: 1,
    name: "렌",
    playerName: "유저",
    level: 1,
    hp: 25,
    maxHp: 25,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: [],
    inventory: ["붕대", "해독제"],
    location: "",
    modifiersNote: "",
    ...partial,
  };
}

function actor(partial: Partial<MechanicsActorInput> = {}): MechanicsActorInput {
  return {
    participantId: 1,
    name: "렌",
    actionType: "attack",
    body: "검으로 벤다",
    tier: "FAILURE",
    d20: 6,
    modifier: 1,
    finalScore: 7,
    dc: 12,
    statKey: "str",
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
    treatmentMode: "item_or_support",
    requiredItem: null,
    actionModifier: 0,
    metadata: {},
    ...partial,
  };
}

function paralysis(partial: Partial<TrpgOngoingEffect> = {}): TrpgOngoingEffect {
  return {
    id: 11,
    campaignId: 1,
    participantId: 1,
    label: "마비",
    kind: "control",
    severity: "LIGHT",
    stackKey: "paralysis",
    stackPolicy: "refresh",
    sourceRound: 4,
    appliedRound: 4,
    startsRound: 5,
    tickClass: null,
    remainingTicks: 2,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: "generic_support",
    requiredItem: null,
    actionModifier: -1,
    metadata: {},
    ...partial,
  };
}

function flashHarm(klass: FlashMechanicsOutput["effects"][number]["directClass"]): FlashMechanicsOutput {
  return {
    effects: [
      {
        participantId: 1,
        directEffect: "harm",
        directClass: klass,
        cause: "enemy_counter",
      },
    ],
  };
}

function resolve(partial: Partial<Parameters<typeof resolveRoundMechanics>[0]>): MechanicsResolution {
  return resolveRoundMechanics({
    campaignId: 1,
    roundId: 100,
    roundNumber: 6,
    sheets: [sheet()],
    effects: [],
    actors: [actor()],
    flash: null,
    fallback: "none",
    calledFlash: true,
    model: "deepseek-v4-flash-0731",
    latencyMs: 12,
    baseDc: 12,
    rng: () => 4,
    recoveryRng: () => 4,
    ...partial,
  });
}

describe("TRPG mechanics referee — direct damage", () => {
  it("A. investigate FAILURE without physical threat deals 0", () => {
    const out = resolve({
      actors: [actor({ actionType: "investigate", body: "단서를 살핀다", tier: "FAILURE" })],
      flash: flashHarm("HEAVY"),
    });
    assert.equal(out.actors[0]?.direct?.effect, "none");
    assert.equal(out.hpAfter["1"], 25);
  });

  it("B. persuade CRITICAL_FAILURE without physical threat deals 0", () => {
    const out = resolve({
      actors: [actor({ actionType: "persuade", body: "회유한다", tier: "CRITICAL_FAILURE" })],
      flash: flashHarm("CRITICAL"),
    });
    assert.equal(out.actors[0]?.direct?.effect, "none");
    assert.equal(out.hpAfter["1"], 25);
  });

  it("C. melee attack FAILURE with enemy threat may harm", () => {
    const out = resolve({
      actors: [actor({ actionType: "attack", body: "근접으로 벤다", tier: "FAILURE" })],
      flash: flashHarm("HEAVY"),
      rng: () => 5,
    });
    assert.equal(out.actors[0]?.direct?.effect, "harm");
    assert.equal(out.actors[0]?.direct?.class, "HEAVY");
    assert.equal(out.actors[0]?.direct?.dice?.amount, 5);
    assert.equal(out.hpAfter["1"], 20);
  });

  it("D. PARTIAL_SUCCESS caps at MEDIUM", () => {
    const out = resolve({
      actors: [actor({ tier: "PARTIAL_SUCCESS" })],
      flash: flashHarm("CRITICAL"),
    });
    assert.equal(out.actors[0]?.direct?.class, "MEDIUM");
  });

  it("E. SUCCESS with Flash CRITICAL harm is downgraded", () => {
    const out = resolve({
      actors: [actor({ tier: "SUCCESS" })],
      flash: flashHarm("CRITICAL"),
    });
    assert.equal(out.actors[0]?.direct?.class, "CHIP");
    assert.equal(out.validation, "downgraded");
  });

  it("F. unknown participant is rejected", () => {
    const out = resolve({
      actors: [actor({ participantId: 99, name: "유령" })],
      flash: flashHarm("LIGHT"),
    });
    assert.equal(out.actors[0]?.direct?.rejected, true);
    assert.equal(out.actors[0]?.direct?.rejectReason, "unknown_participant");
    assert.equal(out.validation, "rejected_partial");
  });

  it("G. damage over current HP clamps to 0", () => {
    const out = resolve({
      sheets: [sheet({ hp: 3 })],
      flash: flashHarm("HEAVY"),
      rng: () => 8,
    });
    assert.equal(out.actors[0]?.direct?.hpAfter, 0);
    assert.equal(out.hpAfter["1"], 0);
    assert.deepEqual(out.incapacitated, [{ participantId: 1, reason: "hp_zero" }]);
  });

  it("H. heal over maxHP clamps", () => {
    const out = resolve({
      sheets: [sheet({ hp: 23, inventory: ["구급키트"] })],
      actors: [actor({ actionType: "use_item", body: "구급키트를 사용한다", tier: "GREAT_SUCCESS" })],
      flash: {
        effects: [{ participantId: 1, directEffect: "heal", directClass: "HEAVY", cause: "healing" }],
      },
      rng: () => 8,
    });
    assert.equal(out.actors[0]?.direct?.effect, "heal");
    assert.equal(out.hpAfter["1"], 25);
  });
});

describe("TRPG mechanics referee — ongoing", () => {
  it("I. poison applied on R5 does not tick on R5", () => {
    const out = resolve({
      roundNumber: 5,
      flash: {
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingAdd: [
              {
                label: "중독",
                kind: "periodic_harm",
                severity: "MEDIUM",
                tickClass: "LIGHT",
                durationBand: "MEDIUM",
                recoveryMode: "save_or_treatment",
                recoveryStat: "res",
                treatmentMode: "item_or_support",
                stackKey: "poison",
              },
            ],
          },
        ],
      },
    });
    assert.equal(out.ongoingTicks.length, 0);
    assert.equal(out.ongoingAdds[0]?.startsRound, 6);
    assert.equal(out.ongoingAdds[0]?.remainingTicks, 3);
  });

  it("J. R6 poison ticks exactly once", () => {
    const out = resolve({
      roundNumber: 6,
      effects: [poison()],
      recoveryRng: () => 1,
      rng: () => 3,
    });
    assert.equal(out.ongoingTicks.length, 1);
    assert.equal(out.ongoingTicks[0]?.dice?.amount, 3);
    assert.equal(out.hpAfter["1"], 22);
  });

  it("K. same R6 retry does not retick", () => {
    const first = resolve({
      roundNumber: 6,
      effects: [poison()],
      recoveryRng: () => 1,
      rng: () => 3,
    });
    const retry = resolve({
      roundNumber: 6,
      effects: [poison()],
      existing: first,
      recoveryRng: () => 20,
      rng: () => 8,
    });
    assert.equal(retry.ongoingTicks.length, 1);
    assert.equal(retry.ongoingTicks[0]?.dice?.amount, 3);
    assert.equal(retry.hpAfter["1"], 22);
  });

  it("L. poison recovery success applies current tick then clears", () => {
    const r6 = resolve({
      roundNumber: 6,
      effects: [poison()],
      recoveryRng: () => 18,
      rng: () => 2,
    });
    assert.equal(r6.ongoingTicks.length, 1);
    assert.equal(r6.recoveries.some((row) => row.timing === "after_tick" && row.success && row.cleared), true);
    assert.ok(r6.ongoingClearedIds.includes(10));
    const r7 = resolve({
      roundNumber: 7,
      effects: [poison({ remainingTicks: 0, lastTickRound: 6 })],
    });
    assert.equal(r7.ongoingTicks.length, 0);
  });

  it("M. paralysis recovery success removes this-round modifier", () => {
    const out = resolve({
      effects: [paralysis()],
      recoveryRng: () => 18,
    });
    assert.equal(out.actionModifiers["1"] ?? 0, 0);
    assert.equal(out.preActionRecoveries[0]?.success, true);
  });

  it("N. paralysis recovery failure keeps modifier", () => {
    const out = resolve({
      effects: [paralysis()],
      recoveryRng: () => 2,
    });
    assert.equal(out.actionModifiers["1"], -1);
    assert.equal(out.preActionRecoveries[0]?.success, false);
  });

  it("O. bleeding + bandage SUCCESS clears", () => {
    const bleed = poison({
      id: 12,
      label: "출혈",
      stackKey: "bleed",
      severity: "LIGHT",
      tickClass: "CHIP",
    });
    const out = resolve({
      effects: [bleed],
      actors: [actor({ actionType: "use_item", body: "붕대로 지혈한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [12],
            consumeItem: "붕대",
          },
        ],
      },
      recoveryRng: () => 1,
    });
    assert.ok(out.ongoingClearedIds.includes(12));
    assert.deepEqual(out.consumeItems, [{ participantId: 1, item: "붕대" }]);
  });

  it("P. poison + valid antidote SUCCESS clears and consumes once", () => {
    const out = resolve({
      effects: [poison()],
      actors: [actor({ actionType: "use_item", body: "해독제를 마신다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [10],
            consumeItem: "해독제",
          },
        ],
      },
      recoveryRng: () => 1,
    });
    assert.ok(out.ongoingClearedIds.includes(10));
    assert.equal(out.consumeItems.length, 1);
    assert.equal(out.consumeItems[0]?.item, "해독제");
  });

  it("Q. missing antidote consume is rejected", () => {
    const out = resolve({
      sheets: [sheet({ inventory: ["붕대"] })],
      actors: [actor({ actionType: "use_item", body: "없는 약을 쓴다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            consumeItem: "신비한 해독제",
          },
        ],
      },
    });
    assert.equal(out.consumeItems.length, 0);
    assert.equal(out.validation, "downgraded");
  });

  it("R. persistent poison without scenario source is downgraded", () => {
    const out = resolve({
      specialRules: "",
      flash: {
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingAdd: [
              {
                label: "중독",
                kind: "periodic_harm",
                severity: "MEDIUM",
                tickClass: "LIGHT",
                durationBand: "PERSISTENT",
                recoveryMode: "persistent",
                recoveryStat: "res",
                treatmentMode: "specific_item",
                requiredItem: "전설의해독제",
                stackKey: "poison",
              },
            ],
          },
        ],
      },
    });
    assert.equal(out.ongoingAdds[0]?.recoveryMode, "save_or_treatment");
    assert.equal(out.ongoingAdds[0]?.remainingTicks, 3);
    assert.equal(out.ongoingAdds[0]?.treatmentMode, "item_or_support");
  });

  it("S. same poison reapplies as refresh/upgrade, not a second tick", () => {
    const out = resolve({
      roundNumber: 7,
      effects: [poison({ remainingTicks: 2, lastTickRound: 6 })],
      flash: {
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingAdd: [
              {
                label: "중독",
                kind: "periodic_harm",
                severity: "HEAVY",
                tickClass: "MEDIUM",
                durationBand: "LONG",
                recoveryMode: "save_or_treatment",
                recoveryStat: "res",
                treatmentMode: "item_or_support",
                stackKey: "poison",
                stackPolicy: "upgrade",
              },
            ],
          },
        ],
      },
      recoveryRng: () => 1,
    });
    assert.equal(out.ongoingAdds.length, 0);
    assert.equal(out.ongoingUpdates.some((row) => row.id === 10 && row.severity === "HEAVY"), true);
    assert.equal(out.ongoingTicks.filter((row) => row.label === "중독").length, 1);
  });

  it("T. multiple ongoing effects honor the per-round cap", () => {
    const cap = totalOngoingDamageCap(25);
    assert.equal(cap, 9);
    const out = resolve({
      effects: [
        poison({ id: 21, stackKey: "poison", tickClass: "MEDIUM" }),
        poison({ id: 22, stackKey: "bleed", label: "출혈", tickClass: "MEDIUM" }),
      ],
      rng: () => 6,
      recoveryRng: () => 1,
    });
    const total = out.ongoingTicks.reduce((sum, row) => sum + (row.dice?.amount ?? 0), 0);
    assert.ok(total <= cap);
    assert.equal(out.hpAfter["1"], 25 - total);
  });

  it("U. Flash failure still processes existing poison ticks", () => {
    const out = resolve({
      flash: null,
      fallback: "flash_failure",
      calledFlash: false,
      effects: [poison()],
      rng: () => 4,
      recoveryRng: () => 1,
    });
    assert.equal(out.ongoingTicks.length, 1);
    assert.equal(out.fallback, "flash_failure");
    assert.equal(out.hpAfter["1"], 21);
  });
});

describe("TRPG mechanics referee — GM merge and retry", () => {
  it("Y. GM HP overwrite loses to mechanics", () => {
    const resolution = resolve({
      flash: flashHarm("HEAVY"),
      rng: () => 5,
    });
    const merged = mergeMechanicsOwnedDelta(
      [sheet()],
      { players: [{ participantId: 1, hp: 25 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next[0]?.hp, 20);
  });

  it("Z. omitting 중독 from GM conditions does not clear structured poison", () => {
    const resolution = resolve({
      effects: [poison()],
      recoveryRng: () => 1,
      rng: () => 2,
    });
    assert.ok(!resolution.ongoingClearedIds.includes(10) || resolution.recoveries.some((row) => row.effectId === 10));
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ conditions: ["중독"] })],
      { players: [{ participantId: 1, conditions: ["긴장"] }] },
      { ...resolution, fallback: "none" }
    );
    assert.equal(merged.ok, true);
    if (merged.ok) {
      assert.deepEqual(merged.next[0]?.conditions, ["긴장"]);
      assert.equal(merged.next[0]?.hp, resolution.hpAfter["1"]);
    }
    assert.equal(resolution.ongoingTicks[0]?.label, "중독");
  });

  it("AA. historical completed round does not retick", () => {
    const first = resolve({
      effects: [poison()],
      recoveryRng: () => 1,
      rng: () => 3,
    });
    const loaded = resolve({
      effects: [poison({ lastTickRound: 6, remainingTicks: 2 })],
      existing: first,
      rng: () => 8,
    });
    assert.equal(loaded.ongoingTicks[0]?.dice?.amount, 3);
    assert.equal(loaded.complete, true);
  });

  it("AB. HP 0 marks hp_zero incapacitation; already-down actor skips self-heal", () => {
    const down = resolve({
      sheets: [sheet({ hp: 2 })],
      flash: flashHarm("HEAVY"),
      rng: () => 8,
    });
    assert.deepEqual(down.incapacitated, [{ participantId: 1, reason: "hp_zero" }]);
    const heal = resolve({
      sheets: [sheet({ hp: 0 })],
      actors: [actor({ actionType: "support", body: "치료한다", tier: "SUCCESS" })],
      flash: {
        effects: [{ participantId: 1, directEffect: "heal", directClass: "LIGHT", cause: "healing" }],
      },
      rng: () => 4,
    });
    assert.equal(heal.actors[0]?.skippedPhysicalAction, true);
    assert.equal(heal.actors[0]?.skipReason, "PRE_ACTION_HP_ZERO");
    assert.equal(heal.hpAfter["1"], 0);
    assert.deepEqual(heal.incapacitated, [{ participantId: 1, reason: "hp_zero" }]);
  });

  it("does not call Flash on opening or roll-less rounds", () => {
    assert.equal(shouldCallMechanicsFlash({ opening: true, rolls: 2, treatmentNeeded: true }), false);
    assert.equal(shouldCallMechanicsFlash({ opening: false, rolls: 0, treatmentNeeded: false }), false);
    assert.equal(shouldCallMechanicsFlash({ opening: false, rolls: 1, treatmentNeeded: false }), true);
    assert.equal(shouldCallMechanicsFlash({ opening: false, rolls: 0, treatmentNeeded: true }), true);
  });
});
