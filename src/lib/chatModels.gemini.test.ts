import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  SELECTED_AI_OPTIONS,
  isGemini25ProModel,
  isGemini31ProModel,
  isValidSelectedAI,
  resolveSelectedAI,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Gemini 2.5 Pro on OpenRouter", () => {
  it("is a selectable UI option", () => {
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_GEMINI_25_PRO_MODEL));
    assert.ok(isValidSelectedAI(OPENROUTER_GEMINI_25_PRO_MODEL));
  });

  it("maps legacy gemini-2.5-pro slugs", () => {
    assert.equal(resolveSelectedAI("gemini-2.5-pro"), OPENROUTER_GEMINI_25_PRO_MODEL);
    assert.equal(resolveSelectedAI("google/gemini-2.5-pro"), OPENROUTER_GEMINI_25_PRO_MODEL);
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_GEMINI_25_PRO_MODEL),
      OPENROUTER_GEMINI_25_PRO_MODEL
    );
  });

  it("uses Google pricing tier", () => {
    assert.ok(isGemini25ProModel(OPENROUTER_GEMINI_25_PRO_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_25_PRO_MODEL);
    assert.equal(rates.family, "google");
    assert.equal(rates.inputUsdPerM, 1.25);
    assert.equal(rates.outputUsdPerM, 10);
  });
});

describe("Gemini 3.1 Pro on OpenRouter", () => {
  it("is a selectable UI option", () => {
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_GEMINI_31_PRO_MODEL));
    assert.ok(isValidSelectedAI(OPENROUTER_GEMINI_31_PRO_MODEL));
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id.includes("claude-sonnet")));
  });

  it("maps legacy gemini-3.1 and retired sonnet slugs", () => {
    assert.equal(resolveSelectedAI("gemini-3.1-pro-preview"), OPENROUTER_GEMINI_31_PRO_MODEL);
    assert.equal(resolveSelectedAI("google/gemini-3.1-pro-preview"), OPENROUTER_GEMINI_31_PRO_MODEL);
    assert.equal(resolveSelectedAI("anthropic/claude-sonnet-4"), OPENROUTER_GEMINI_31_PRO_MODEL);
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_GEMINI_31_PRO_MODEL),
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
  });

  it("uses Google pricing tier", () => {
    assert.ok(isGemini31ProModel(OPENROUTER_GEMINI_31_PRO_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_31_PRO_MODEL);
    assert.equal(rates.family, "google");
    assert.equal(rates.inputUsdPerM, 2);
    assert.equal(rates.outputUsdPerM, 12);
  });
});
