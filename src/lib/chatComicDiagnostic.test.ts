import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSemanticLadderSafeStructure,
  buildSemanticLadderScenePlan,
  COMIC_SEMANTIC_LADDER,
  resolveComicDiagnosticMode,
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
    textStrategy: "shared_anchor_regions",
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
      textStrategy: "shared_anchor_regions",
    }
  );
});

test("blank-balloon strategy is admin-only and explicit", () => {
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
