import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_56_TERRA_MODEL } from "@/lib/chatModels";
import {
  CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN,
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

function expectedPoints(rawUsd: number, exchangeRate: number): number {
  return Math.ceil(
    (rawUsd * exchangeRate) /
      (1 - CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN) -
      1e-9
  );
}

describe("GPT-5.6 Terra billing", () => {
  it("uses CheaperInference input/cache/output rates at 50% margin", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      inputTokens: 200_000,
      outputTokens: 100_000,
      cacheReadTokens: 100_000,
      apiPromptTokens: 200_000,
      apiCompletionTokens: 100_000,
    });
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      1530
    );

    assert.ok(rates);
    assert.equal(rates.grossMargin, 0.5);
    assert.equal(
      billing.total,
      expectedPoints(
        (100_000 * 2.5 + 100_000 * 0.25 + 100_000 * 15) / 1_000_000,
        rates.effectiveKrwPerUsd
      )
    );
  });

  it("uses the same catalog rates for large requests without the old surcharge", () => {
    const input = 300_000;
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      inputTokens: input,
      outputTokens: 10_000,
      cacheWriteTokens: 100_000,
      apiPromptTokens: input,
      apiCompletionTokens: 10_000,
    });

    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
    );
    assert.ok(rates);
    assert.equal(
      billing.total,
      expectedPoints(
        (input * 2.5 + 10_000 * 15) / 1_000_000,
        rates.effectiveKrwPerUsd
      )
    );
  });
});
