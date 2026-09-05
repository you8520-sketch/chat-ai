import assert from "node:assert/strict";
import test from "node:test";

import {
  assertComicDiagnosticAxisIsolation,
  buildSemanticLadderSafeStructure,
  buildSemanticLadderScenePlan,
  COMIC_BLANK_BALLOON_TEXT_STRATEGIES,
  COMIC_SEMANTIC_LADDER,
  resolveComicDiagnosticMode,
  resolveComicPrimaryTier2Boundary,
} from "./chatComicDiagnostic";

test("semantic ladder has nine source-free adult visual fixtures", () => {
  assert.deepEqual(
    COMIC_SEMANTIC_LADDER.map((level) => level.id),
    ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]
  );

  for (const level of COMIC_SEMANTIC_LADDER) {
    const plan = buildSemanticLadderScenePlan(level.id);
    assert.equal(plan.panels.length, 4);
    assert.equal(plan.events.length, 0);
    assert.equal(plan.panels.every((panel) => panel.dialogue.length === 0), true);
    assert.match(level.visualSemantics, /adult/i);
    assert.equal(buildSemanticLadderSafeStructure(level.id).panels.length, 4);
  }
});

test("semantic ladder mode requires one admin-selected level", () => {
  assert.deepEqual(resolveComicDiagnosticMode({ canSeeCost: false }), {
    mode: "normal",
    semanticLevel: null,
    textStrategy: "local_image_detection",
  });
  assert.throws(
    () => resolveComicDiagnosticMode({ canSeeCost: false, mode: "semantic_ladder", semanticLevel: "L0" }),
    /FORBIDDEN/
  );
  assert.throws(
    () => resolveComicDiagnosticMode({ canSeeCost: true, mode: "semantic_ladder" }),
    /SEMANTIC_LEVEL_REQUIRED/
  );
  assert.deepEqual(
    resolveComicDiagnosticMode({
      canSeeCost: true,
      mode: "semantic_ladder",
      semanticLevel: "L6",
    }),
    {
      mode: "semantic_ladder",
      semanticLevel: "L6",
      textStrategy: "local_image_detection",
    }
  );
});

test("blank-balloon strategy is admin-only and local_image_detection is canonical", () => {
  assert.equal(COMIC_BLANK_BALLOON_TEXT_STRATEGIES[0], "local_image_detection");
  assert.deepEqual(
    resolveComicDiagnosticMode({
      canSeeCost: true,
      mode: "blank_balloon_hybrid",
      textStrategy: "local_image_detection",
    }),
    {
      mode: "blank_balloon_hybrid",
      semanticLevel: null,
      textStrategy: "local_image_detection",
    }
  );
  assert.deepEqual(
    resolveComicDiagnosticMode({
      canSeeCost: true,
      mode: "blank_balloon_hybrid",
    }),
    {
      mode: "blank_balloon_hybrid",
      semanticLevel: null,
      textStrategy: "local_image_detection",
    }
  );
  assert.throws(
    () =>
      resolveComicDiagnosticMode({
        canSeeCost: false,
        mode: "blank_balloon_hybrid",
        textStrategy: "local_image_detection",
      }),
    /FORBIDDEN/
  );
});

test("AXIS-1 semantic ladder + non-normal reference isolation is rejected", () => {
  assert.throws(
    () =>
      assertComicDiagnosticAxisIsolation({
        mode: "semantic_ladder",
        referenceMode: "neutral_template",
        visualContextMode: "normal",
      }),
    /COMIC_LADDER_REQUIRES_NORMAL_REFERENCE_ISOLATION/
  );
  assert.throws(
    () =>
      assertComicDiagnosticAxisIsolation({
        mode: "semantic_ladder",
        referenceMode: "all_neutral",
        visualContextMode: "normal",
      }),
    /COMIC_LADDER_REQUIRES_NORMAL_REFERENCE_ISOLATION/
  );
});

test("AXIS-2 semantic ladder + neutral visual context is rejected", () => {
  assert.throws(
    () =>
      assertComicDiagnosticAxisIsolation({
        mode: "semantic_ladder",
        referenceMode: "normal",
        visualContextMode: "neutral_visual_context",
      }),
    /COMIC_LADDER_REQUIRES_NORMAL_VISUAL_CONTEXT/
  );
});

test("AXIS-3 blank hybrid + non-normal reference isolation is rejected", () => {
  assert.throws(
    () =>
      assertComicDiagnosticAxisIsolation({
        mode: "blank_balloon_hybrid",
        referenceMode: "neutral_identity_refs",
        visualContextMode: "normal",
      }),
    /COMIC_HYBRID_REQUIRES_NORMAL_REFERENCE_ISOLATION/
  );
});

test("AXIS-4 blank hybrid + neutral visual context is rejected", () => {
  assert.throws(
    () =>
      assertComicDiagnosticAxisIsolation({
        mode: "blank_balloon_hybrid",
        referenceMode: "normal",
        visualContextMode: "neutral_visual_context",
      }),
    /COMIC_HYBRID_REQUIRES_NORMAL_VISUAL_CONTEXT/
  );
});

test("AXIS-5 normal diagnostic mode keeps single-axis reference isolation allowed", () => {
  assert.doesNotThrow(() =>
    assertComicDiagnosticAxisIsolation({
      mode: "normal",
      referenceMode: "neutral_template",
      visualContextMode: "normal",
    })
  );
  assert.doesNotThrow(() =>
    assertComicDiagnosticAxisIsolation({
      mode: "normal",
      referenceMode: "normal",
      visualContextMode: "normal",
    })
  );
});

test("LADDER-1 primary result owns semantic boundary, tier2 is separate recovery", () => {
  const blockedThenRecovered = resolveComicPrimaryTier2Boundary({
    primaryOutcome: "safety_rejected",
    tier2Outcome: "success",
  });
  assert.equal(blockedThenRecovered.semanticBoundaryOwner, "PRIMARY_RESULT");
  assert.equal(blockedThenRecovered.primaryBoundary, "BLOCKED");
  assert.equal(blockedThenRecovered.tier2SafeRecovery, "PASS");

  const primarySuccess = resolveComicPrimaryTier2Boundary({
    primaryOutcome: "success",
    tier2Outcome: "not_run",
  });
  assert.equal(primarySuccess.primaryBoundary, "PASS");
  assert.equal(primarySuccess.tier2SafeRecovery, "NOT_RUN");

  const bothRejected = resolveComicPrimaryTier2Boundary({
    primaryOutcome: "safety_rejected",
    tier2Outcome: "safety_rejected",
  });
  assert.equal(bothRejected.primaryBoundary, "BLOCKED");
  assert.equal(bothRejected.tier2SafeRecovery, "FAIL");
});
