import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  USER_SELECTABLE_AI_OPTIONS,
} from "@/lib/chatModels";
import { MODEL_PICKER_ACTIVE_MODEL_IDS } from "@/lib/modelPickerPreview";
import {
  CHEAPER_INFERENCE_QWEN_38_MAX_GROSS_MARGIN,
  OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN,
  computeOpenRouterTurnBilling,
  computeTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

describe("Cheaper Inference Qwen 3.8 Max billing", () => {
  it("uses usage.cost / upstreamCostUsd at 55% gross margin and full completion_tokens", () => {
    assert.equal(CHEAPER_INFERENCE_QWEN_38_MAX_GROSS_MARGIN, 0.55);
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
    assert.ok(rates);
    assert.equal(rates.grossMargin, 0.55);
    assert.notEqual(rates.outputUsdPerMillion, 3.75);

    const upstreamCostUsd = 0.012;
    const apiPromptTokens = 4_200;
    const apiCompletionTokens = 3_100;
    const billing = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      inputTokens: apiPromptTokens,
      outputTokens: 1_800,
      reasoningTokens: 0,
      apiPromptTokens,
      apiCompletionTokens,
      upstreamCostUsd,
    });
    const expected = Math.ceil(
      (upstreamCostUsd * rates.effectiveKrwPerUsd) / (1 - 0.55) - 1e-9
    );
    assert.equal(billing.total, expected);
    assert.notEqual(
      billing.total,
      Math.ceil(apiCompletionTokens * OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN - 1e-9)
    );

    const noUpstreamLow = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      inputTokens: apiPromptTokens,
      outputTokens: 1_000,
      apiPromptTokens,
      apiCompletionTokens: 1_000,
    });
    const noUpstreamHigh = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      inputTokens: apiPromptTokens,
      outputTokens: 1_000,
      apiPromptTokens,
      apiCompletionTokens: 2_500,
    });
    assert.ok(noUpstreamHigh.total > noUpstreamLow.total);
  });

  it("keeps DeepSeek fallback billing and hides Qwen 3.8 from the picker", () => {
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      1530
    );
    assert.ok(rates);
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 20_000,
      outputTokens: 2_000,
      cacheReadTokens: 10_000,
      apiPromptTokens: 20_000,
      apiCompletionTokens: 2_000,
    });
    const rawUsd =
      (10_000 * 0.3045 + 10_000 * 0.231 + 2_000 * 0.609) / 1_000_000;
    assert.equal(
      billing.total,
      Math.ceil((rawUsd * rates.effectiveKrwPerUsd) / (1 - 0.65) - 1e-9)
    );
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_QWEN_38_MAX_MODEL),
      false
    );
    assert.equal(
      (MODEL_PICKER_ACTIVE_MODEL_IDS as readonly string[]).includes(
        CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
      ),
      false
    );
  });
});
