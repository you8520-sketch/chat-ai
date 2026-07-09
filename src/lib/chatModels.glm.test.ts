import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_GLM_52_MODEL,
  SELECTED_AI_OPTIONS,
  isGlmModel,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("GLM 5.2 on OpenRouter", () => {
  it("is a selectable UI option", () => {
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_GLM_52_MODEL));
    assert.ok(isValidSelectedAI(OPENROUTER_GLM_52_MODEL));
    assert.equal(selectedAILabel(OPENROUTER_GLM_52_MODEL), "GLM 5.2");
  });

  it("maps legacy glm slugs to 5.2", () => {
    assert.equal(resolveSelectedAI("glm"), OPENROUTER_GLM_52_MODEL);
    assert.equal(resolveSelectedAI("glm-5.2"), OPENROUTER_GLM_52_MODEL);
    assert.equal(resolveSelectedAI("z-ai/glm-5.1"), OPENROUTER_GLM_52_MODEL);
    assert.equal(resolveOpenRouterModelId(OPENROUTER_GLM_52_MODEL), OPENROUTER_GLM_52_MODEL);
  });

  it("uses Z.ai list pricing", () => {
    assert.ok(isGlmModel(OPENROUTER_GLM_52_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GLM_52_MODEL);
    assert.equal(rates.inputUsdPerM, 0.532);
    assert.equal(rates.outputUsdPerM, 1.672);
  });
});
