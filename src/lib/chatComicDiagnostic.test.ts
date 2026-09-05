import assert from "node:assert/strict";
import test from "node:test";

import {
  assertComicDiagnosticAxisIsolation,
  buildSemanticLadderSafeStructure,
  buildSemanticLadderScenePlan,
  COMIC_BLANK_BALLOON_TEXT_STRATEGIES,
  COMIC_SEMANTIC_LADDER,
  COMIC_TEXT_BOUNDARY_LADDER,
  getComicTextBoundaryLevel,
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
    textBoundaryLevel: null,
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
      textBoundaryLevel: null,
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
      textBoundaryLevel: null,
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
      textBoundaryLevel: null,
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

test("TEXT-VISUAL matrix has five fixed source-free text fixtures", () => {
  assert.deepEqual(
    COMIC_TEXT_BOUNDARY_LADDER.map((level) => level.id),
    ["T0", "T1", "T2", "T3", "T4"]
  );
  for (const level of COMIC_TEXT_BOUNDARY_LADDER) {
    assert.ok(getComicTextBoundaryLevel(level.id).text.trim().length >= 2);
  }
});

test("MATRIX-1 text boundary level is admin-only and ladder-only", () => {
  assert.deepEqual(
    resolveComicDiagnosticMode({
      canSeeCost: true,
      mode: "semantic_ladder",
      semanticLevel: "L3",
      textBoundaryLevel: "T2",
    }),
    {
      mode: "semantic_ladder",
      semanticLevel: "L3",
      textStrategy: "local_image_detection",
      textBoundaryLevel: "T2",
    }
  );
  assert.throws(
    () =>
      resolveComicDiagnosticMode({
        canSeeCost: false,
        mode: "semantic_ladder",
        semanticLevel: "L3",
        textBoundaryLevel: "T2",
      }),
    /FORBIDDEN/
  );
  assert.throws(
    () =>
      resolveComicDiagnosticMode({
        canSeeCost: true,
        mode: "normal",
        textBoundaryLevel: "T2",
      }),
    /COMIC_TEXT_BOUNDARY_ONLY_FOR_LADDER/
  );
  assert.throws(
    () =>
      resolveComicDiagnosticMode({
        canSeeCost: true,
        mode: "semantic_ladder",
        semanticLevel: "L3",
        textBoundaryLevel: "TX",
      }),
    /INVALID_COMIC_TEXT_BOUNDARY_LEVEL/
  );
});

test("MATRIX-2 text fixture injects one fixed dialogue line into panel 1 only", () => {
  const plan = buildSemanticLadderScenePlan("L3", 4, "T2");
  assert.equal(plan.panels[0]?.dialogue.length, 1);
  assert.equal(plan.panels[0]?.dialogue[0]?.text, getComicTextBoundaryLevel("T2").text);
  assert.equal(plan.panels[0]?.dialogue[0]?.provenance, "user_edit");
  for (const panel of plan.panels.slice(1)) {
    assert.equal(panel.dialogue.length, 0);
  }
});

test("MATRIX-1-MONO T0..T4 strength is strictly monotonic by intended text strength", () => {
  const strengths = COMIC_TEXT_BOUNDARY_LADDER.map((level) => level.strength);
  assert.deepEqual(strengths, [0, 1, 2, 3, 4]);
  for (let i = 1; i < strengths.length; i += 1) {
    assert.ok(strengths[i]! > strengths[i - 1]!, "strictly increasing");
  }
});

test("MATRIX-2-MONO T fixtures contain no V-axis visual/location mutation", () => {
  const vAxisCues = /(?:침대|이불|누(?:워|운|어)|눕|bed|lying|벗|나체|shirtless)/iu;
  for (const level of COMIC_TEXT_BOUNDARY_LADDER) {
    assert.doesNotMatch(level.text, vAxisCues, `T fixture ${level.id} must not mutate the visual axis`);
    assert.doesNotMatch(level.name, vAxisCues);
  }
});
