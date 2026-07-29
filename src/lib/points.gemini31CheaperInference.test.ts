import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "@/lib/chatModels";
import { computePreviewPointBand } from "@/lib/modelPickerPreview";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN,
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

describe("CheaperInference Gemini 3.1 Pro Preview billing", () => {
  it("uses the fallback rates at exactly 50% gross margin", () => {
    const effectiveKrwPerUsd = 1530;
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      effectiveKrwPerUsd
    );
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 1.4);
    assert.equal(rates.cacheReadUsdPerMillion, 0.4375);
    assert.equal(rates.cacheWriteUsdPerMillion, 1.4);
    assert.equal(rates.outputUsdPerMillion, 8.4);
    assert.equal(rates.grossMargin, 0.5);
    assert.equal(CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN, 0.5);
  });

  it("charges from provider-reported actual cost when available", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      inputTokens: 200_000,
      outputTokens: 100_000,
      apiPromptTokens: 200_000,
      apiCompletionTokens: 100_000,
      upstreamCostUsd: 0.123456,
    });
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    );
    assert.ok(rates);
    assert.equal(
      billing.total,
      Math.ceil(
        (0.123456 * rates.effectiveKrwPerUsd) /
          (1 - CHEAPER_INFERENCE_GEMINI_31_PRO_GROSS_MARGIN) -
          1e-9
      )
    );
  });

  it("shows a stable 30%-to-0% market-price range", () => {
    const first = computePreviewPointBand({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      inputTokens: 4000,
      outputTokens: 1400,
      targetResponseChars: 3200,
    });
    const second = computePreviewPointBand({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      inputTokens: 4000,
      outputTokens: 1400,
      targetResponseChars: 3200,
    });
    assert.deepEqual(second, first);
    assert.ok(first);
    assert.ok(first.low > 5);
    assert.ok(first.high > first.mid);
  });
});
