import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMechanicsOwnedDelta, hpOwnershipOf, resolveParticipantHp } from "./mechanicsMerge";
import { resolveRoundMechanics } from "./mechanicsResolve";
import type {
  MechanicsActorInput,
  MechanicsResolution,
  TrpgOngoingEffect,
} from "./mechanicsTypes";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

function sheet(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return {
    participantId: 1,
    name: "강이현",
    playerName: "현",
    level: 1,
    hp: 30,
    maxHp: 30,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: [],
    inventory: [],
    location: "",
    modifiersNote: "",
    ...partial,
  };
}

function actor(partial: Partial<MechanicsActorInput> = {}): MechanicsActorInput {
  return {
    participantId: 1,
    name: "강이현",
    actionType: "attack",
    body: "적을 공격한다",
    tier: "SUCCESS",
    d20: 14,
    modifier: 1,
    finalScore: 15,
    dc: 12,
    statKey: "str",
    ...partial,
  };
}

/** Deterministic periodic_harm ongoing effect (poison), ticks LIGHT each round. */
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
    recoveryMode: "treatment",
    recoveryStat: "res",
    treatmentMode: "generic_support",
    requiredItem: null,
    actionModifier: 0,
    metadata: {},
    ...partial,
  };
}

/** Referee OFF (production default): fallback gm_legacy, calledFlash=false. */
function resolve(partial: Partial<Parameters<typeof resolveRoundMechanics>[0]> = {}): MechanicsResolution {
  return resolveRoundMechanics({
    campaignId: 1,
    roundId: 900,
    roundNumber: 6,
    sheets: [sheet()],
    effects: [],
    actors: [actor()],
    flash: null,
    fallback: "gm_legacy",
    calledFlash: false,
    model: null,
    latencyMs: 0,
    baseDc: 12,
    rng: () => 4,
    recoveryRng: () => 1,
    scene: "적대적 위협이 눈앞에 있다.",
    ...partial,
  });
}

function gmPlayersHp(participantId: number, hp: number): TrpgStateDelta {
  return { players: [{ participantId, hp }] } as TrpgStateDelta;
}

function hpOf(next: TrpgSheetSnapshot[], participantId: number): number {
  return next.find((s) => s.participantId === participantId)!.hp;
}

describe("HP-REPRO: GM_LEGACY direct-damage ownership (referee OFF, production default)", () => {
  it("Case A: acting PC + GM structured hp lower → HP must decrease", () => {
    const res = resolve();
    const out = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], gmPlayersHp(1, 22), res);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 1), 22, "acting PC GM hp must commit");
  });

  it("Case B: no harm (GM hp equals start) → HP unchanged", () => {
    const res = resolve();
    const out = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], gmPlayersHp(1, 30), res);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 1), 30);
  });

  it("Case A2: non-actor participant (no submission) + GM structured hp lower → HP must decrease", () => {
    const res = resolve({
      sheets: [sheet({ participantId: 1, hp: 30 }), sheet({ participantId: 2, name: "렌", hp: 30 })],
      actors: [actor({ participantId: 1 })],
    });
    const out = mergeMechanicsOwnedDelta(
      [sheet({ participantId: 1, hp: 30 }), sheet({ participantId: 2, name: "렌", hp: 30 })],
      gmPlayersHp(2, 24),
      res
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 2), 24, "non-actor GM hp must commit");
  });

  it("Case A3: referee ON + Flash called, GM world harm on actor with no authoritative HP is not dropped", () => {
    const res = resolve({
      actors: [actor({ participantId: 1 })],
      calledFlash: true,
      fallback: "none",
      flash: null,
      rng: () => 4,
    });
    const out = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], gmPlayersHp(1, 23), res);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 1), 23);
  });
});

describe("HP-REPRO: layered ownership boundaries (L1-L4)", () => {
  it("L1: non-actor + ongoing tick + GM current direct harm → tick once AND GM harm composed", () => {
    const p2poison = poison({ id: 21, participantId: 2 });
    const res = resolve({
      sheets: [sheet({ participantId: 1, hp: 30 }), sheet({ participantId: 2, name: "렌", hp: 30 })],
      actors: [actor({ participantId: 1 })],
      effects: [p2poison],
    });
    const ownership = hpOwnershipOf(res, 2);
    assert.equal(ownership.SERVER_PREACTION, true, "p2 has a pre-action tick layer");
    assert.equal(ownership.GM_LEGACY, false, "p2 is a non-actor");
    const tick = res.ongoingTicks.find((row) => row.participantId === 2);
    assert.ok(tick, "ongoing tick must be scheduled for p2");
    const tickedHp = 30 - (tick!.hpBefore - tick!.hpAfter);

    // GM narrates a world/NPC attack and returns a lower resulting hp for p2.
    const out = mergeMechanicsOwnedDelta(
      [sheet({ participantId: 1, hp: 30 }), sheet({ participantId: 2, name: "렌", hp: 30 })],
      gmPlayersHp(2, 22),
      res
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(
      hpOf(out.next, 2),
      22,
      `GM current harm must not be dropped by the pre-action tick layer (tickedHp=${tickedHp})`
    );
    assert.notEqual(hpOf(out.next, 2), tickedHp, "tick must not be the only applied layer");
  });

  it("L2: actor + ongoing tick + GM current direct harm → same composed result as L1", () => {
    const p1poison = poison({ id: 22, participantId: 1 });
    const res = resolve({
      sheets: [sheet({ participantId: 1, hp: 30 })],
      actors: [actor({ participantId: 1 })],
      effects: [p1poison],
    });
    assert.equal(hpOwnershipOf(res, 1).GM_LEGACY, true);
    assert.equal(hpOwnershipOf(res, 1).SERVER_PREACTION, true);
    const out = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], gmPlayersHp(1, 22), res);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 1), 22, "actor GM_LEGACY harm composes over the tick layer");
  });

  it("L3: authoritative FLASH harm wins; GM hp must not override it", () => {
    const res = resolve({
      sheets: [sheet({ hp: 30 })],
      actors: [actor({ participantId: 1 })],
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "MEDIUM", cause: "enemy_counter" }],
      },
      fallback: "none",
      calledFlash: true,
      rng: () => 4,
    });
    assert.equal(hpOwnershipOf(res, 1).FLASH_REFEREE, true);
    const stored = res.hpAfter["1"];
    assert.notEqual(stored, undefined);
    const out = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], gmPlayersHp(1, 12), res);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 1), stored, "GM hp must not override authoritative FLASH HP");
  });

  it("L4: SERVER_RECOVERY floor composes with GM_LEGACY harm (layered recovery + GM)", () => {
    // Mirrors mechanicsOwnership.test.ts "5. A heals B +4 and B GM_LEGACY harm".
    const res = resolve({
      sheets: [sheet({ participantId: 1, hp: 20 }), sheet({ participantId: 2, name: "렌", hp: 10, maxHp: 25 })],
      actors: [
        actor({ participantId: 1, body: "렌의 상처를 응급처치한다", actionType: "support", tier: "SUCCESS" }),
        actor({ participantId: 2, name: "렌", actionType: "attack", body: "반격한다", tier: "FAILURE" }),
      ],
      fallback: "gm_legacy",
      calledFlash: false,
      rng: () => 4,
    });
    const bFlags = hpOwnershipOf(res, 2);
    assert.equal(bFlags.SERVER_RECOVERY, true);
    assert.equal(bFlags.GM_LEGACY, true);
    assert.equal(
      resolveParticipantHp({ startHp: 10, maxHp: 25, resolution: res, participantId: 2, gmHp: 7 }),
      11,
      "recovery floor (+4) and GM harm (7) compose to 11"
    );
    const out = mergeMechanicsOwnedDelta(
      [sheet({ participantId: 1, hp: 20 }), sheet({ participantId: 2, name: "렌", hp: 10, maxHp: 25 })],
      gmPlayersHp(2, 7),
      res
    );
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 2), 11);
  });
});

describe("HP-REPRO: actual periodic_harm tick semantics", () => {
  it("ONGOING-1: first application ticks exactly once and sets owner flags", () => {
    const res = resolve({
      sheets: [sheet({ hp: 30 })],
      actors: [actor({ participantId: 1 })],
      effects: [poison({ id: 31, participantId: 1 })],
    });
    assert.equal(res.ongoingTicks.filter((t) => t.participantId === 1).length, 1, "exactly one tick");
    assert.equal(hpOwnershipOf(res, 1).SERVER_PREACTION, true);
    const out = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], { players: [] } as TrpgStateDelta, res);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 1), res.ongoingTicks[0]!.hpAfter, "tick floor applies");
  });

  it("ONGOING-2: re-applying the same resolution does not tick twice", () => {
    const res = resolve({
      sheets: [sheet({ hp: 30 })],
      actors: [actor({ participantId: 1 })],
      effects: [poison({ id: 32, participantId: 1, lastTickRound: 6 })],
    });
    assert.equal(res.ongoingTicks.length, 0, "already ticked this round → no second tick");
  });

  it("ONGOING-3: next eligible round ticks once", () => {
    const res = resolve({
      roundNumber: 7,
      sheets: [sheet({ hp: 27 })],
      actors: [actor({ participantId: 1 })],
      effects: [poison({ id: 33, participantId: 1, lastTickRound: 6, remainingTicks: 2 })],
    });
    assert.equal(res.ongoingTicks.filter((t) => t.participantId === 1).length, 1);
  });
});
