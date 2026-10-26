import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI_38_FLASH_MODEL,
  GEMINI_4_ARGON_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
} from "@/lib/chatModels";
import { computeOpenRouterTurnBilling } from "@/lib/points";

/** Deterministic Main RP fixture — provider USD below token-estimate path for both models. */
const MAIN_RP_GEMINI_FIXTURE = {
  inputTokens: 12_000,
  outputTokens: 1_800,
  apiPromptTokens: 12_000,
  apiCompletionTokens: 1_800,
  upstreamCostUsd: 0.0095,
} as const;

describe("Main RP Gemini generic fallback — upstream must not alter user charge", () => {
  for (const modelId of [GEMINI_38_FLASH_MODEL, GEMINI_4_ARGON_MODEL] as const) {
    it(`ignores usage.cost on ${modelId} generic openRouterUsdCostDetailed path`, () => {
      const tokenEstimate = computeOpenRouterTurnBilling({
        modelId,
        inputTokens: MAIN_RP_GEMINI_FIXTURE.inputTokens,
        outputTokens: MAIN_RP_GEMINI_FIXTURE.outputTokens,
        apiPromptTokens: MAIN_RP_GEMINI_FIXTURE.apiPromptTokens,
        apiCompletionTokens: MAIN_RP_GEMINI_FIXTURE.apiCompletionTokens,
      });
      const withProviderUsd = computeOpenRouterTurnBilling({
        modelId,
        ...MAIN_RP_GEMINI_FIXTURE,
      });
      assert.equal(
        withProviderUsd.total,
        tokenEstimate.total,
        "Main RP must keep token-rate fallback; provider USD belongs on TRPG published-margin path"
      );
      assert.ok(tokenEstimate.total > 0);
    });
  }

  it("does not regress Gemini 3.6 dedicated branch when billingBasis carries upstream", () => {
    const tokenEstimate = computeOpenRouterTurnBilling({
      modelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
      inputTokens: 8_000,
      outputTokens: 900,
      apiPromptTokens: 8_000,
      apiCompletionTokens: 900,
    });
    const withProviderUsd = computeOpenRouterTurnBilling({
      modelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
      inputTokens: 8_000,
      outputTokens: 900,
      apiPromptTokens: 8_000,
      apiCompletionTokens: 900,
      upstreamCostUsd: 0.004,
    });
    assert.equal(withProviderUsd.total, tokenEstimate.total);
  });
});
