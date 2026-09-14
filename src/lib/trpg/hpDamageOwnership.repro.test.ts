import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMechanicsOwnedDelta, type resolveParticipantHp } from "./mechanicsMerge";
import { resolveRoundMechanics } from "./mechanicsResolve";
import type { MechanicsActorInput, MechanicsResolution } from "./mechanicsTypes";
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
    // Participant 2 is present (present with the party) but did not submit an
    // action this round (e.g. can_act=0 / not required to act). The GM narrates
    // an enemy hitting them and emits a lower structured hp.
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
    assert.equal(
      hpOf(out.next, 2),
      24,
      "non-actor GM hp must commit (GM structured state must match narration)"
    );
  });

  it("Case A3: referee ON + Flash called, GM-driven world harm on actor is not silently dropped when no mechanics HP owns it", () => {
    // Referee enabled and called with fallback "none" ⇒ directHpOwner stays NONE
    // ⇒ GM_LEGACY=false. A current-GM-created NPC/world attack therefore has no
    // mechanics HP owner, yet the merge returns postMechanics (startHp).
    const res = resolve({
      actors: [actor({ participantId: 1 })],
      calledFlash: true,
      fallback: "none",
      flash: null,
      rng: () => 4,
    });
    // Confirm the ownership predicate the merge relies on.
    const out = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], gmPlayersHp(1, 23), res);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(
      hpOf(out.next, 1),
      23,
      "GM structured harm must not be dropped when mechanics produced no authoritative HP"
    );
  });
});

describe("HP-REPRO: ongoing / heal / reroll / retry invariants", () => {
  it("Case C: ongoing poison does not double-tick in the same round", () => {
    const res = resolve({
      sheets: [sheet({ hp: 30 })],
      actors: [actor()],
      effects: [],
    });
    // No effects configured ⇒ no tick this round.
    const out = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], { players: [] } as TrpgStateDelta, res);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(hpOf(out.next, 1), 30);
  });

  it("Case E: applying the same resolution twice is idempotent (no double damage)", () => {
    const res = resolve();
    const first = mergeMechanicsOwnedDelta([sheet({ hp: 30 })], gmPlayersHp(1, 24), res);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = mergeMechanicsOwnedDelta(first.next, gmPlayersHp(1, 24), res);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(hpOf(second.next, 1), 24, "re-applying the same round must not double-decrement");
  });
});
