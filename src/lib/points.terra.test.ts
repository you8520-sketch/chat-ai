import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENAI_GPT_56_TERRA_MODEL } from "@/lib/chatModels";
import {
  computeOpenRouterTurnBilling,
  OPENAI_GPT_56_TERRA_GROSS_MARGIN,
  OPENAI_GPT_56_TERRA_LONG_CONTEXT_THRESHOLD_TOKENS,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

function expectedPoints(rawUsd: number, exchangeRate: number): number {
  return Math.ceil((rawUsd * exchangeRate) / (1 - OPENAI_GPT_56_TERRA_GROSS_MARGIN) - 1e-9);
}

describe("GPT-5.6 Terra billing", () => {
  it("uses official short-context input, cached-input, and output rates at 55% margin", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId: OPENAI_GPT_56_TERRA_MODEL,
      inputTokens: 200_000,
      outputTokens: 100_000,
      cacheReadTokens: 100_000,
      apiPromptTokens: 200_000,
      apiCompletionTokens: 100_000,
    });
    const rates = resolveOpenRouterReasoningPointRates(OPENAI_GPT_56_TERRA_MODEL, 1530);

    assert.ok(rates);
    assert.equal(rates.grossMargin, 0.55);
    assert.equal(
      billing.total,
      expectedPoints(
        (100_000 * 2.5 + 100_000 * 0.25 + 100_000 * 15) / 1_000_000,
        rates.effectiveKrwPerUsd
      )
    );
  });

  it("applies long-context rates to the entire request above 272K input tokens", () => {
    const input = OPENAI_GPT_56_TERRA_LONG_CONTEXT_THRESHOLD_TOKENS + 1;
    const billing = computeOpenRouterTurnBilling({
      modelId: OPENAI_GPT_56_TERRA_MODEL,
      inputTokens: input,
      outputTokens: 10_000,
      apiPromptTokens: input,
      apiCompletionTokens: 10_000,
    });

    const rates = resolveOpenRouterReasoningPointRates(OPENAI_GPT_56_TERRA_MODEL);
    assert.ok(rates);
    assert.equal(
      billing.total,
      expectedPoints((input * 5 + 10_000 * 22.5) / 1_000_000, rates.effectiveKrwPerUsd)
    );
  });
});
