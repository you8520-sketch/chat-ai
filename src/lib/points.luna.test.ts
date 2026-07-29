import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } from "@/lib/chatModels";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_GROSS_MARGIN,
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

describe("GPT-5.6 Luna billing", () => {
  it("uses catalog input/cache/output rates at exactly 55% gross margin", () => {
    const effectiveKrwPerUsd = 1530;
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      effectiveKrwPerUsd
    );
    assert.ok(rates);
    assert.equal(rates.grossMargin, 0.55);
    assert.equal(CHEAPER_INFERENCE_GPT_56_LUNA_GROSS_MARGIN, 0.55);

    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      inputTokens: 200_000,
      outputTokens: 100_000,
      cacheReadTokens: 100_000,
      apiPromptTokens: 200_000,
      apiCompletionTokens: 100_000,
    });
    const rawUsd = (100_000 * 1 + 100_000 * 0.1 + 100_000 * 6) / 1_000_000;
    const expected = Math.ceil(
      (rawUsd * rates.effectiveKrwPerUsd) / (1 - 0.55) - 1e-9
    );
    assert.equal(billing.total, expected);
  });
});
