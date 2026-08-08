import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyGeminiSceneContinuityArmToSystem,
  GEMINI_SCENE_CONTINUITY_BLOCK,
  parseGeminiSceneContinuityArm,
  resolveGeminiSceneContinuityAdapterSection,
} from "./geminiSceneContinuityAdapter";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "./chatModels";

describe("Gemini Scene Continuity adapter (experiment)", () => {
  it("arm A never injects", () => {
    assert.equal(parseGeminiSceneContinuityArm(undefined), "A");
    assert.equal(
      resolveGeminiSceneContinuityAdapterSection({
        modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
        arm: "A",
      }),
      null
    );
  });

  it("arm B injects only for Gemini 3.1 Pro", () => {
    const block = resolveGeminiSceneContinuityAdapterSection({
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      arm: "B",
    });
    assert.ok(block?.includes("[GEMINI SCENE CONTINUITY]"));
    assert.ok(block?.includes("설정 활용 자체를 줄이지 않는다"));
    assert.equal(
      resolveGeminiSceneContinuityAdapterSection({
        modelId: "deepseek/deepseek-v4-pro",
        arm: "B",
      }),
      null
    );
    assert.equal(
      resolveGeminiSceneContinuityAdapterSection({
        modelId: "google/gemini-3.1-flash-lite",
        arm: "B",
      }),
      null
    );
  });

  it("apply appends block without mutating arm A system", () => {
    const base = "SYSTEM ROOT";
    const a = applyGeminiSceneContinuityArmToSystem({
      systemPrompt: base,
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      arm: "A",
    });
    assert.equal(a.injected, false);
    assert.equal(a.systemPrompt, base);
    const b = applyGeminiSceneContinuityArmToSystem({
      systemPrompt: base,
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      arm: "B",
    });
    assert.equal(b.injected, true);
    assert.ok(b.systemPrompt.includes(GEMINI_SCENE_CONTINUITY_BLOCK));
    assert.ok(b.estimatedTokens > 20);
  });

  it("does not forbid recall / past mention wording", () => {
    assert.equal(/회상\s*금지/.test(GEMINI_SCENE_CONTINUITY_BLOCK), false);
    assert.equal(/과거\s*언급\s*금지/.test(GEMINI_SCENE_CONTINUITY_BLOCK), false);
    assert.ok(GEMINI_SCENE_CONTINUITY_BLOCK.includes("자연스럽게 사용할 수 있다"));
  });
});
