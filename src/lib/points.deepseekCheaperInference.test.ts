import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_GROSS_MARGIN,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN,
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

describe("CheaperInference DeepSeek V4 Pro billing", () => {
  it("uses account catalog rates while preserving the 65% margin", () => {
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      1530
    );
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 0.3045);
    assert.equal(rates.cacheReadUsdPerMillion, 0.231);
    assert.equal(rates.cacheWriteUsdPerMillion, 0.3045);
    assert.equal(rates.outputUsdPerMillion, 0.609);
    assert.equal(rates.grossMargin, 0.65);
    assert.equal(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN, 0.65);

    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 20_000,
      outputTokens: 2_000,
      cacheReadTokens: 10_000,
      apiPromptTokens: 20_000,
      apiCompletionTokens: 2_000,
    });
    const rawUsd =
      (10_000 * 0.3045 + 10_000 * 0.231 + 2_000 * 0.609) /
      1_000_000;
    assert.equal(
      billing.total,
      Math.ceil((rawUsd * rates.effectiveKrwPerUsd) / (1 - 0.65) - 1e-9)
    );
  });
});

describe("CheaperInference DeepSeek V4 Flash billing", () => {
  it("uses account catalog rates while preserving the 68% margin", () => {
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      1530
    );
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 0.098);
    assert.equal(rates.cacheReadUsdPerMillion, 0.0196);
    assert.equal(rates.cacheWriteUsdPerMillion, 0.098);
    assert.equal(rates.outputUsdPerMillion, 0.196);
    assert.equal(rates.grossMargin, 0.68);
    assert.equal(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_GROSS_MARGIN, 0.68);

    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      inputTokens: 20_000,
      outputTokens: 2_000,
      cacheReadTokens: 10_000,
      apiPromptTokens: 20_000,
      apiCompletionTokens: 2_000,
    });
    const rawUsd =
      (10_000 * 0.098 + 10_000 * 0.0196 + 2_000 * 0.196) / 1_000_000;
    assert.equal(
      billing.total,
      Math.ceil((rawUsd * rates.effectiveKrwPerUsd) / (1 - 0.68) - 1e-9)
    );
  });
});
