import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLocalSceneProgressDelta,
  emptyLocalSceneProgress,
  serializeLocalSceneStateForGm,
  type TrpgLocalSceneProgressV1,
} from "./localSceneProgress";

/**
 * Deterministic reproduction of the reported long-play local-scene stagnation.
 *
 * These assertions document the CURRENT owner behavior: `localSceneProgress` is a
 * pure recorder. It stores whatever the GM voluntarily emits and never advances the
 * world itself. A fix that adds a deterministic enforcer is the "separate Director /
 * event engine" FOLLOW-UP explicitly out of scope for this PR; this fixture is the
 * regression anchor and reproduction evidence.
 */

function feed(
  start: TrpgLocalSceneProgressV1,
  rounds: number,
  deltaFor: (round: number) => Parameters<typeof applyLocalSceneProgressDelta>[1]
): TrpgLocalSceneProgressV1 {
  let state = start;
  for (let round = 1; round <= rounds; round += 1) {
    state = applyLocalSceneProgressDelta(state, deltaFor(round));
  }
  return state;
}

describe("STORY-REPRO: local scene stagnation is not enforced by the recorder owner", () => {
  it("REPRO-1: repeated same objective persists across 8 rounds when the GM omits change", () => {
    const start = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      remainingBlockersAdd: ["정면 균사벽"],
    });
    const after = feed(start, 8, () => ({ remainingBlockersAdd: ["압박"] }));
    assert.equal(after.objective, "건물 탈출", "recorder never advances the objective on its own");
    assert.equal(
      after.sceneState,
      "active",
      "no deterministic owner transitions the scene outward from an unchanged objective"
    );
  });

  it("REPRO-2: transition_ready is preserved but never consumed programmatically", () => {
    const ready = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "경비 초소 돌파",
      openRoutesAdd: ["우측 환풍구"],
      sceneStateSet: "transition_ready",
    });
    const after = feed(ready, 6, () => ({ remainingBlockersAdd: ["재확인"] }));
    assert.equal(after.sceneState, "transition_ready");
    assert.equal(after.objective, "경비 초소 돌파");
    assert.deepEqual(after.openRoutes, ["우측 환풍구"], "no new scene opens without an explicit GM sceneTransitionTo");
    assert.ok(serializeLocalSceneStateForGm(after).includes("transition_ready"));
  });

  it("REPRO-3: a reworded obstacle bypasses the exact-label guard and accumulates", () => {
    let state = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      resolvedObstaclesAdd: ["정면 균사벽"],
    });
    // Exact-label resurrection is rejected...
    const exact = applyLocalSceneProgressDelta(state, { remainingBlockersAdd: ["정면 균사벽"] });
    assert.deepEqual(exact.remainingBlockers, [], "exact-label resurrection is already blocked");
    // ...but reworded near-duplicates are accepted and pile up.
    const reworded = feed(state, 6, (round) => ({ remainingBlockersAdd: [`앞쪽 균사 덩어리 ${round}`] }));
    assert.equal(reworded.remainingBlockers.length, 6, "reworded duplicates are not deduped (no fuzzy guard by design)");
  });

  it("REPRO-4: SUCCESS and FAILURE rounds produce identical persisted state (tier is not a state gate)", () => {
    const start = applyLocalSceneProgressDelta(emptyLocalSceneProgress(), {
      objectiveSet: "건물 탈출",
      remainingBlockersAdd: ["정면 균사벽"],
    });
    const successPath = applyLocalSceneProgressDelta(start, { openRoutesAdd: ["환풍구"] });
    const failurePath = applyLocalSceneProgressDelta(start, { openRoutesAdd: ["환풍구"] });
    assert.deepEqual(successPath, failurePath, "the local scene owner receives no roll tier — only the GM delta");
  });
});
