import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveGenerationPreparationUi,
  GENERATION_SCENE_BADGE_LABELS,
  sanitizeGenerationPreparationUi,
} from "./generationPreparationUi";

describe("generationPreparationUi", () => {
  it("generic fallback — empty badges when no metadata", () => {
    const ui = deriveGenerationPreparationUi({});
    assert.deepEqual(ui.badges, []);
    assert.equal(ui.phase, "preparing");
  });

  it("maps safe progression types and interactive reaction", () => {
    const ui = deriveGenerationPreparationUi({
      runtimeMode: "interactive",
      progressionTypes: ["relationship", "lore_clue", "environment"],
      recommendedIntensity: 3,
    });
    assert.ok(ui.badges.includes("reaction"));
    assert.ok(ui.badges.includes("relationship"));
    assert.ok(ui.badges.includes("investigation") || ui.badges.includes("world"));
    assert.ok(ui.badges.length <= 3);
    for (const b of ui.badges) {
      assert.ok(GENERATION_SCENE_BADGE_LABELS[b]);
    }
  });

  it("omits unknown raw values and never invents badges from junk", () => {
    const ui = sanitizeGenerationPreparationUi({
      phase: "preparing",
      badges: ["relationship", "REACT_DEEPEN", "lore_clue", "nextBeatHint", "urgent", 12],
    });
    assert.ok(ui);
    assert.deepEqual(ui.badges, ["relationship", "urgent"]);
  });

  it("spoiler / directive prose never becomes a badge", () => {
    const ui = sanitizeGenerationPreparationUi({
      phase: "preparing",
      badges: ["조용한 순간, 이전 대화와 연결된 작은 단서 하나가 다시 눈에 띈다."],
      nextBeatHint: "NPC가 배신한다",
      directive: "[PRIVATE SCENE ENGINE RULE]\n...",
    });
    assert.ok(ui);
    assert.deepEqual(ui.badges, []);
    assert.equal("nextBeatHint" in (ui as object), false);
  });

  it("auto_progression does not force reaction badge", () => {
    const ui = deriveGenerationPreparationUi({
      runtimeMode: "auto_progression",
      progressionTypes: ["npc_action"],
      recommendedIntensity: 4,
    });
    assert.ok(!ui.badges.includes("reaction"));
    assert.ok(ui.badges.includes("action"));
    assert.ok(ui.badges.includes("urgent"));
  });

  it("serialize shape for SSE is allowlist-only", () => {
    const ui = deriveGenerationPreparationUi({
      runtimeMode: "interactive",
      progressionTypes: ["relationship", "consequence", "comedy"],
      recommendedIntensity: 0,
    });
    const wire = JSON.parse(JSON.stringify(ui)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(wire).sort(), ["badges", "phase"]);
    assert.ok(Array.isArray(wire.badges));
    assert.doesNotMatch(JSON.stringify(wire), /PRIVATE SCENE|nextBeat|배신|단서 하나/);
  });
});
