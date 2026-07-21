import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SELECTED_AI,
  OPENROUTER_QWEN_37_MAX_MODEL,
  SELECTED_AI_OPTIONS,
  isQwenModel,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Qwen 3.7 Max retired from selection", () => {
  it("is not a selectable UI option", () => {
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_QWEN_37_MAX_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_QWEN_37_MAX_MODEL), false);
  });

  it("maps legacy qwen slugs to the default selected AI", () => {
    assert.equal(resolveSelectedAI("qwen"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("qwen3.7-max"), DEFAULT_SELECTED_AI);
    assert.equal(resolveSelectedAI("qwen/qwen3.7-max"), DEFAULT_SELECTED_AI);
  });

  it("keeps Qwen pricing detection for residual receipts", () => {
    assert.ok(isQwenModel(OPENROUTER_QWEN_37_MAX_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_QWEN_37_MAX_MODEL);
    assert.equal(rates.inputUsdPerM, 1.25);
    assert.equal(rates.outputUsdPerM, 3.75);
    assert.equal(selectedAILabel(OPENROUTER_QWEN_37_MAX_MODEL), "Qwen 3.7 Max");
  });
});
