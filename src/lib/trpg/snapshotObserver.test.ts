import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  afterSnapshotObservationSettled,
  allocateRequestSeq,
  decideSnapshotApply,
  foldSnapshotObservations,
  isTrpgSnapshotPhaseRegression,
  isTrpgSnapshotRegressive,
  shouldLaunchAdvanceKick,
  snapshotCompareState,
  TRPG_SNAPSHOT_MAIN_PHASE_PATH,
  TRPG_SNAPSHOT_POLL_MS,
  type SnapshotCompareState,
} from "./snapshotObserver";
import { TRPG_ROUND_PHASES } from "./types";

function state(
  phase: string,
  opts?: Partial<Omit<SnapshotCompareState, "phase" | "roundNumber">> & { roundNumber?: number }
): SnapshotCompareState {
  return {
    roundNumber: opts?.roundNumber ?? 1,
    phase,
    lockedActions: opts?.lockedActions ?? 0,
    rolls: opts?.rolls ?? 0,
    narrationLen: opts?.narrationLen ?? 0,
    draftLen: opts?.draftLen ?? 0,
  };
}

describe("trpg snapshotObserver", () => {
  it("rejects stale seq and cancelled observations", () => {
    assert.deepEqual(
      decideSnapshotApply({
        cancelled: true,
        responseSeq: 2,
        appliedSeq: 1,
        previous: state("BOT_ACTION"),
        next: state("GENERATING_NARRATION"),
      }),
      { apply: false, reason: "cancelled" }
    );
    assert.deepEqual(
      decideSnapshotApply({
        cancelled: false,
        responseSeq: 1,
        appliedSeq: 2,
        previous: state("GENERATING_NARRATION"),
        next: state("BOT_ACTION"),
      }),
      { apply: false, reason: "stale_seq" }
    );
  });

  it("OUT-OF-ORDER SNAPSHOT: older BOT_ACTION cannot regress GENERATING_NARRATION", () => {
    const final = foldSnapshotObservations([
      { seq: 1, state: state("BOT_ACTION", { lockedActions: 1 }) },
      {
        seq: 3,
        state: state("GENERATING_NARRATION", { lockedActions: 2, rolls: 2, draftLen: 20 }),
      },
      { seq: 2, state: state("BOT_ACTION", { lockedActions: 1 }) },
    ]);
    assert.equal(final?.appliedSeq, 3);
    assert.equal(final?.state.phase, "GENERATING_NARRATION");
  });

  it("PHASE_GRAPH_SAFE: required forward transitions are never regressions", () => {
    const forwards: Array<[string, string]> = [
      ["BOT_ACTION", "LOCKING_ACTIONS"],
      ["LOCKING_ACTIONS", "ADJUDICATING"],
      ["ADJUDICATING", "ROLLING"],
      ["ROLLING", "GENERATING_NARRATION"],
      ["GENERATING_NARRATION", "APPLYING_STATE"],
      ["APPLYING_STATE", "ROUND_COMPLETE"],
      ["GENERATING_NARRATION", "ERROR_RECOVERY"],
      ["ROLLING", "ERROR_RECOVERY"],
      ["ROUND_COMPLETE", "CAMPAIGN_COMPLETE"],
      ["APPLYING_STATE", "CAMPAIGN_COMPLETE"],
    ];
    for (const [from, to] of forwards) {
      assert.equal(
        isTrpgSnapshotPhaseRegression(from, to),
        false,
        `${from} → ${to} must be accepted`
      );
      assert.equal(
        isTrpgSnapshotRegressive(state(from, { lockedActions: 2, rolls: 2 }), state(to, { lockedActions: 2, rolls: 2 })),
        false,
        `${from} → ${to} decide accept`
      );
    }
  });

  it("ERROR_RECOVERY_ACCEPTED from high phases; CAMPAIGN_COMPLETE_ACCEPTED", () => {
    assert.equal(isTrpgSnapshotPhaseRegression("GENERATING_NARRATION", "ERROR_RECOVERY"), false);
    assert.equal(isTrpgSnapshotPhaseRegression("ROLLING", "ERROR_RECOVERY"), false);
    assert.equal(isTrpgSnapshotPhaseRegression("APPLYING_STATE", "ERROR_RECOVERY"), false);
    assert.equal(isTrpgSnapshotPhaseRegression("ROUND_COMPLETE", "CAMPAIGN_COMPLETE"), false);
    assert.deepEqual(
      decideSnapshotApply({
        cancelled: false,
        responseSeq: 5,
        appliedSeq: 4,
        previous: state("GENERATING_NARRATION", { draftLen: 40 }),
        next: state("ERROR_RECOVERY"),
      }),
      { apply: true },
      "ERROR_RECOVERY_ACCEPTED=true"
    );
    assert.deepEqual(
      decideSnapshotApply({
        cancelled: false,
        responseSeq: 6,
        appliedSeq: 5,
        previous: state("ROUND_COMPLETE"),
        next: state("CAMPAIGN_COMPLETE"),
      }),
      { apply: true },
      "CAMPAIGN_COMPLETE_ACCEPTED=true"
    );
  });

  it("phase matrix covers every TRPG_ROUND_PHASES live path value", () => {
    for (const phase of TRPG_ROUND_PHASES) {
      if (phase === "ERROR_RECOVERY") continue;
      assert.ok(
        TRPG_SNAPSHOT_MAIN_PHASE_PATH.includes(phase),
        `${phase} belongs on main path`
      );
    }
    assert.equal(TRPG_SNAPSHOT_MAIN_PHASE_PATH.includes("ERROR_RECOVERY"), false);
    // Adjacent main-path steps are forward.
    for (let i = 0; i < TRPG_SNAPSHOT_MAIN_PHASE_PATH.length - 1; i += 1) {
      const from = TRPG_SNAPSHOT_MAIN_PHASE_PATH[i]!;
      const to = TRPG_SNAPSHOT_MAIN_PHASE_PATH[i + 1]!;
      assert.equal(isTrpgSnapshotPhaseRegression(from, to), false, `${from}→${to}`);
      assert.equal(isTrpgSnapshotPhaseRegression(to, from), true, `${to}→${from} regresses`);
    }
  });

  it("new round accepted; old round rejected", () => {
    assert.equal(
      isTrpgSnapshotRegressive(state("ROUND_COMPLETE", { roundNumber: 2 }), state("ACTION_INPUT", { roundNumber: 3 })),
      false
    );
    assert.equal(
      isTrpgSnapshotRegressive(state("ACTION_INPUT", { roundNumber: 3 }), state("ROUND_COMPLETE", { roundNumber: 2 })),
      true
    );
  });

  it("SYNC_COMPARISON_REF: back-to-back accepts compare against just-accepted state", () => {
    const folded = foldSnapshotObservations([
      { seq: 1, state: state("ROLLING", { lockedActions: 2, rolls: 2 }) },
      { seq: 2, state: state("GENERATING_NARRATION", { lockedActions: 2, rolls: 2, draftLen: 5 }) },
      { seq: 3, state: state("APPLYING_STATE", { lockedActions: 2, rolls: 2, narrationLen: 40 }) },
    ]);
    assert.equal(folded?.state.phase, "APPLYING_STATE");
    assert.equal(folded?.appliedSeq, 3);
  });

  it("ONE_REQUEST_SEQ_OWNER allocate at request start", () => {
    let current = 0;
    const a = allocateRequestSeq(current);
    current = a.nextCurrent;
    const b = allocateRequestSeq(current);
    current = b.nextCurrent;
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
    assert.equal(current, 2);
    // Command seq must not be appliedSeq+1 independently of request owner.
    const src = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(src, /requestSeqRef/);
    assert.match(src, /nextRequestSeq/);
    assert.match(src, /allocateRequestSeq/);
    assert.doesNotMatch(src, /appliedSeqRef\.current \+ 1/);
  });

  it("ADVANCE_KICK_IN_FLIGHT_MAX=1 and observer does not await advance", () => {
    assert.equal(
      shouldLaunchAdvanceKick({ setup: false, shouldKickAdvance: true, advanceKickInFlight: false }),
      true
    );
    assert.equal(
      shouldLaunchAdvanceKick({ setup: false, shouldKickAdvance: true, advanceKickInFlight: true }),
      false,
      "ADVANCE_KICK_IN_FLIGHT_MAX=1"
    );
    const tick = afterSnapshotObservationSettled({
      setup: false,
      shouldKickAdvance: true,
      advanceKickInFlight: false,
    });
    assert.equal(tick.scheduleNextMs, TRPG_SNAPSHOT_POLL_MS);
    assert.equal(tick.launchAdvanceKick, true);
  });

  it("RoomClient wires single serialized observer + sync comparison ref", () => {
    const src = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(src, /TRPG_SNAPSHOT_POLL_MS|snapshotObserver/);
    assert.match(src, /advanceKickInFlightRef/);
    assert.match(src, /setTimeout/);
    assert.match(src, /snapRef\.current = next/);
    assert.doesNotMatch(src, /setInterval\(\(\) => \{\s*void \(async/);
    assert.doesNotMatch(src, /snap\.workType\]/);
    assert.match(src, /observeOnce|scheduleNext/);
  });

  it("snapshotCompareState reads draft/rolls/locks", () => {
    const cmp = snapshotCompareState({
      round: { number: 4, phase: "GENERATING_NARRATION" },
      currentRolls: [{}, {}],
      gmNarrationDraft: { text: "abc" },
      log: [
        {
          roundNumber: 4,
          narration: null,
          actions: [{ locked: true }, { locked: true }, { locked: false }],
        },
      ],
    });
    assert.equal(cmp.lockedActions, 2);
    assert.equal(cmp.rolls, 2);
    assert.equal(cmp.draftLen, 3);
  });
});
