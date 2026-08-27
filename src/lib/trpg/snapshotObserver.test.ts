import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  afterSnapshotObservationSettled,
  allocateRequestSeq,
  decideSnapshotApply,
  foldSnapshotObservations,
  isLegitNarrationRerollSignal,
  isTrpgRevealedActionSetRegression,
  isTrpgSnapshotContentRegression,
  isTrpgSnapshotPhaseRegression,
  isTrpgSnapshotRegressive,
  revealedActionIdsFromPublicActions,
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
    processStage: opts?.processStage ?? null,
    narrationRerolling: opts?.narrationRerolling ?? false,
    revealedActionIds: opts?.revealedActionIds ?? [],
    rolls: opts?.rolls ?? 0,
    draftLen: opts?.draftLen ?? 0,
    narrationLen: opts?.narrationLen ?? 0,
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

  it("LEGIT_REROLL_BACKEDGE_ACCEPTED and STALE_GENERATING_AFTER_ROUND_COMPLETE_REJECTED", () => {
    assert.equal(
      isTrpgSnapshotPhaseRegression(
        state("ROUND_COMPLETE", { narrationLen: 4200 }),
        state("GENERATING_NARRATION", { processStage: "reroll", draftLen: 10 })
      ),
      false,
      "LEGIT_REROLL_BACKEDGE_ACCEPTED=true"
    );
    assert.equal(
      isTrpgSnapshotPhaseRegression(
        state("ROUND_COMPLETE", { narrationLen: 4200 }),
        state("GENERATING_NARRATION", { processStage: "gm", draftLen: 10 })
      ),
      true,
      "STALE_GENERATING_AFTER_ROUND_COMPLETE_REJECTED=true"
    );
    assert.equal(
      isLegitNarrationRerollSignal({ processStage: "reroll", narrationRerolling: false }),
      true
    );
  });

  it("SHORTER_REROLL_CANONICAL_ACCEPTED including missed intermediate", () => {
    const withIntermediate = foldSnapshotObservations([
      { seq: 1, state: state("ROUND_COMPLETE", { narrationLen: 4200, rolls: 2, revealedActionIds: [1, 2] }) },
      {
        seq: 2,
        state: state("GENERATING_NARRATION", {
          processStage: "reroll",
          rolls: 2,
          revealedActionIds: [1, 2],
          draftLen: 20,
        }),
      },
      {
        seq: 3,
        state: state("ROUND_COMPLETE", {
          processStage: "reroll",
          narrationLen: 3500,
          rolls: 2,
          revealedActionIds: [1, 2],
        }),
      },
    ]);
    assert.equal(withIntermediate?.state.narrationLen, 3500);

    const missedGenerating = foldSnapshotObservations([
      { seq: 1, state: state("ROUND_COMPLETE", { narrationLen: 4200, rolls: 2, revealedActionIds: [1, 2] }) },
      {
        seq: 2,
        state: state("ROUND_COMPLETE", {
          processStage: "reroll",
          narrationLen: 3500,
          rolls: 2,
          revealedActionIds: [1, 2],
        }),
      },
    ]);
    assert.equal(
      missedGenerating?.state.narrationLen,
      3500,
      "MISSED_INTERMEDIATE_REROLL_ACCEPTED=true"
    );
  });

  it("REAL_PUBLIC_ACTION_SHAPE_TEST + SAME_PHASE_ACTION_SET_REGRESSION_REJECTED", () => {
    const actions = [
      {
        participantId: 1,
        name: "user",
        body: "간다",
        revealed: true,
        kind: "human",
        actionType: "free",
      },
      {
        participantId: 2,
        name: "bot1",
        body: "본다",
        revealed: true,
        kind: "ai_character",
        actionType: "free",
      },
      {
        participantId: 3,
        name: "bot2",
        body: "",
        revealed: true,
        kind: "ai_character",
        actionType: "free",
      },
    ];
    const ids = revealedActionIdsFromPublicActions(actions);
    assert.deepEqual(ids, [1, 2], "REAL_PUBLIC_ACTION_SHAPE_TEST=true");
    assert.equal(isTrpgRevealedActionSetRegression([1, 2], [1]), true);
    assert.equal(isTrpgRevealedActionSetRegression([1, 2], [1, 2, 3]), false);
    assert.equal(
      isTrpgSnapshotContentRegression(
        state("BOT_ACTION", { revealedActionIds: [1, 2] }),
        state("BOT_ACTION", { revealedActionIds: [1] })
      ),
      true,
      "SAME_PHASE_ACTION_SET_REGRESSION_REJECTED=true"
    );
    // No locked field in compare state construction from public actions.
    const cmp = snapshotCompareState({
      round: { number: 1, phase: "BOT_ACTION" },
      log: [{ roundNumber: 1, actions }],
    });
    assert.deepEqual(cmp.revealedActionIds, [1, 2]);
    assert.equal("lockedActions" in cmp, false);
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
        isTrpgSnapshotPhaseRegression(state(from, { revealedActionIds: [1] }), state(to, { revealedActionIds: [1] })),
        false,
        `${from} → ${to}`
      );
    }
  });

  it("ERROR_RECOVERY_ACCEPTED and CAMPAIGN_COMPLETE_ACCEPTED", () => {
    assert.deepEqual(
      decideSnapshotApply({
        cancelled: false,
        responseSeq: 5,
        appliedSeq: 4,
        previous: state("GENERATING_NARRATION", { draftLen: 40 }),
        next: state("ERROR_RECOVERY"),
      }),
      { apply: true }
    );
    assert.deepEqual(
      decideSnapshotApply({
        cancelled: false,
        responseSeq: 6,
        appliedSeq: 5,
        previous: state("ROUND_COMPLETE"),
        next: state("CAMPAIGN_COMPLETE"),
      }),
      { apply: true }
    );
  });

  it("phase matrix covers every TRPG_ROUND_PHASES live path value", () => {
    for (const phase of TRPG_ROUND_PHASES) {
      if (phase === "ERROR_RECOVERY") continue;
      assert.ok(TRPG_SNAPSHOT_MAIN_PHASE_PATH.includes(phase), `${phase} on main path`);
    }
  });

  it("ONE_REQUEST_SEQ_OWNER + ONE_SNAPSHOT_APPLY_OWNER + RAW_ASYNC_CAMPAIGN_APPLY_COUNT=0", () => {
    let current = 0;
    const a = allocateRequestSeq(current);
    current = a.nextCurrent;
    const b = allocateRequestSeq(current);
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);

    const src = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(src, /requestSeqRef/);
    assert.match(src, /nextRequestSeq/);
    assert.match(src, /allocateRequestSeq/);
    assert.doesNotMatch(src, /appliedSeqRef\.current \+ 1/);

    // Every campaign snapshot response must go through applyObservedSnapshot.
    // The only apply(next) call site is inside applyObservedSnapshot.
    const applyCampaignCalls = [...src.matchAll(/\bapply\(([^)]+)\)/g)].map((m) => m[1]!.trim());
    assert.deepEqual(applyCampaignCalls, ["next"], "RAW_ASYNC_CAMPAIGN_APPLY_COUNT=0");
    assert.match(src, /applyObservedSnapshot\(/);
    const observedCalls = src.match(/applyObservedSnapshot\(/g) ?? [];
    assert.ok(observedCalls.length >= 5, "commands+observer use applyObservedSnapshot");
  });

  it("ADVANCE_KICK_IN_FLIGHT_MAX=1 and observer does not await advance", () => {
    assert.equal(
      shouldLaunchAdvanceKick({ setup: false, shouldKickAdvance: true, advanceKickInFlight: true }),
      false
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
    assert.match(src, /snapRef\.current = next/);
    assert.doesNotMatch(src, /setInterval\(\(\) => \{\s*void \(async/);
    assert.doesNotMatch(src, /snap\.workType\]/);
  });

  it("reroll lifecycle: draft then shorter canonical wins; old canonical cannot overwrite", () => {
    const final = foldSnapshotObservations([
      { seq: 1, state: state("ROUND_COMPLETE", { narrationLen: 4200, rolls: 2, revealedActionIds: [1, 2] }) },
      {
        seq: 2,
        state: state("GENERATING_NARRATION", {
          processStage: "reroll",
          rolls: 2,
          revealedActionIds: [1, 2],
          draftLen: 30,
        }),
      },
      {
        seq: 3,
        state: state("GENERATING_NARRATION", {
          processStage: "reroll",
          rolls: 2,
          revealedActionIds: [1, 2],
          draftLen: 80,
        }),
      },
      {
        seq: 4,
        state: state("ROUND_COMPLETE", {
          processStage: "reroll",
          narrationLen: 3500,
          rolls: 2,
          revealedActionIds: [1, 2],
        }),
      },
      // stale old complete with higher local progress but older seq — rejected by seq
      {
        seq: 3,
        state: state("ROUND_COMPLETE", {
          narrationLen: 4200,
          rolls: 2,
          revealedActionIds: [1, 2],
        }),
      },
    ]);
    assert.equal(final?.appliedSeq, 4);
    assert.equal(final?.state.narrationLen, 3500, "SHORTER_REROLL_CANONICAL_ACCEPTED=true");
  });
});
