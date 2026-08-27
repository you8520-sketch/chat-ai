import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  afterSnapshotObservationSettled,
  decideSnapshotApply,
  foldSnapshotObservations,
  shouldLaunchAdvanceKick,
  TRPG_SNAPSHOT_POLL_MS,
  trpgSnapshotProgressScore,
} from "./snapshotObserver";

describe("trpg snapshotObserver", () => {
  it("rejects stale seq and cancelled observations", () => {
    assert.deepEqual(
      decideSnapshotApply({
        cancelled: true,
        responseSeq: 2,
        appliedSeq: 1,
        previous: { roundNumber: 1, progress: 10 },
        next: { roundNumber: 1, progress: 20 },
      }),
      { apply: false, reason: "cancelled" }
    );
    assert.deepEqual(
      decideSnapshotApply({
        cancelled: false,
        responseSeq: 1,
        appliedSeq: 2,
        previous: { roundNumber: 1, progress: 20 },
        next: { roundNumber: 1, progress: 10 },
      }),
      { apply: false, reason: "stale_seq" }
    );
  });

  it("OUT-OF-ORDER SNAPSHOT: older BOT_ACTION cannot regress GENERATING_NARRATION", () => {
    const final = foldSnapshotObservations([
      { seq: 1, roundNumber: 1, progress: 100 },
      { seq: 3, roundNumber: 1, progress: 4_000_000 }, // GENERATING + draft
      { seq: 2, roundNumber: 1, progress: 2_000_000 }, // stale BOT_ACTION
    ]);
    assert.equal(final?.appliedSeq, 3);
    assert.equal(final?.progress, 4_000_000, "STALE_SNAPSHOT_APPLY prevented");
  });

  it("progress score rises from BOT_ACTION rolls to GENERATING draft", () => {
    const bot = trpgSnapshotProgressScore({
      round: { number: 1, phase: "BOT_ACTION" },
      workType: "generate_bots",
      currentRolls: [],
      log: [{ roundNumber: 1, actions: [{ locked: true }, { locked: false }] }],
    });
    const rolling = trpgSnapshotProgressScore({
      round: { number: 1, phase: "ROLLING" },
      workType: "acquire_gm_lock",
      currentRolls: [{}, {}],
      log: [{ roundNumber: 1, actions: [{ locked: true }, { locked: true }] }],
    });
    const generating = trpgSnapshotProgressScore({
      round: { number: 1, phase: "GENERATING_NARRATION" },
      workType: "generate_gm",
      currentRolls: [{}, {}],
      gmNarrationDraft: { text: "x".repeat(20) },
      log: [{ roundNumber: 1, actions: [{ locked: true }, { locked: true }] }],
    });
    assert.ok(rolling > bot);
    assert.ok(generating > rolling);
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
    assert.equal(tick.scheduleNextMs > 0, true, "SNAPSHOT_OBSERVER_WAITS_FOR_ADVANCE=false");
  });

  it("RoomClient wires single serialized observer without workType restart", () => {
    const src = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(src, /TRPG_SNAPSHOT_POLL_MS|snapshotObserver/);
    assert.match(src, /advanceKickInFlightRef/);
    assert.match(src, /setTimeout/);
    assert.doesNotMatch(src, /setInterval\(\(\) => \{\s*void \(async/);
    assert.doesNotMatch(src, /snap\.workType\]/);
    assert.match(src, /SNAPSHOT_OBSERVER|serialized|observeOnce|scheduleNext/);
  });
});
