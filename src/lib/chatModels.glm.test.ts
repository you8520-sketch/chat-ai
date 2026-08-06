import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SELECTED_AI,
  OPENROUTER_GLM_52_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isGlmModel,
  isValidSelectedAI,
  resolveSelectedAI,
} from "@/lib/chatModels";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("GLM 5.2 diagnostic registry (not public picker)", () => {
  it("is registered for receipts/diagnostics but hidden from the public picker", () => {
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_GLM_52_MODEL));
    assert.ok(!USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === OPENROUTER_GLM_52_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_GLM_52_MODEL), true);
  });

  it("normalizes glm slugs to the default selected AI without diagnostic env", () => {
    const prev = process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE;
    try {
      delete process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE;
      assert.equal(resolveSelectedAI("glm"), DEFAULT_SELECTED_AI);
      assert.equal(resolveSelectedAI("glm-5.2"), DEFAULT_SELECTED_AI);
      assert.equal(resolveSelectedAI("z-ai/glm-5.1"), DEFAULT_SELECTED_AI);
      assert.equal(resolveSelectedAI("z-ai/glm-5.2"), DEFAULT_SELECTED_AI);
    } finally {
      if (prev === undefined) delete process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE;
      else process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE = prev;
    }
  });

  it("keeps GLM pricing detection for residual/receipt slugs", () => {
    assert.ok(isGlmModel(OPENROUTER_GLM_52_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GLM_52_MODEL);
    assert.equal(rates.inputUsdPerM, 0.532);
    assert.equal(rates.outputUsdPerM, 1.672);
  });
});
