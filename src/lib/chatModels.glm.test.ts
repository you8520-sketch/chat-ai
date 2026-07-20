import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SELECTED_AI,
  OPENROUTER_GLM_52_MODEL,
  SELECTED_AI_OPTIONS,
  isGlmModel,
  isValidSelectedAI,
  resolveSelectedAI,
} from "@/lib/chatModels";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("GLM 5.2 retired from selection", () => {
  it("is not a selectable UI option", () => {
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_GLM_52_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_GLM_52_MODEL), false);
  });

  it("maps legacy glm slugs to the default selected AI", () => {
    assert.equal(resolveSelectedAI("glm"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("glm-5.2"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("z-ai/glm-5.1"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("z-ai/glm-5.2"), DEFAULT_SELECTED_AI);
  });

  it("keeps GLM pricing detection for any residual slug", () => {
    assert.ok(isGlmModel(OPENROUTER_GLM_52_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GLM_52_MODEL);
    assert.equal(rates.inputUsdPerM, 0.532);
    assert.equal(rates.outputUsdPerM, 1.672);
  });
});
