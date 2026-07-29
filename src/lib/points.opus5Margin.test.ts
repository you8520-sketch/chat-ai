import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL } from "@/lib/chatModels";
import { computePreviewPointBand } from "@/lib/modelPickerPreview";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_GROSS_MARGIN,
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

describe("CheaperInference Claude Opus 5 billing", () => {
  it("uses actual token/cache rates at 45% gross margin", () => {
    const effectiveKrwPerUsd = 1530;
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      effectiveKrwPerUsd
    );
    assert.ok(rates);
    assert.equal(rates.grossMargin, 0.45);
    assert.equal(CHEAPER_INFERENCE_CLAUDE_OPUS_5_GROSS_MARGIN, 0.45);

    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      inputTokens: 200_000,
      outputTokens: 100_000,
      cacheReadTokens: 100_000,
      apiPromptTokens: 200_000,
      apiCompletionTokens: 100_000,
    });
    const rawUsd =
      (100_000 * 3.5 + 100_000 * 0.35 + 100_000 * 17.5) / 1_000_000;
    assert.equal(
      billing.total,
      Math.ceil((rawUsd * rates.effectiveKrwPerUsd) / (1 - 0.45) - 1e-9)
    );
  });

  it("preview no longer collapses to the 5P minimum", () => {
    const band = computePreviewPointBand({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      inputTokens: 4000,
      outputTokens: 1400,
      targetResponseChars: 3200,
    });
    assert.ok(band);
    assert.ok(band.mid > 100);
    assert.ok(band.low > 5);
  });
});
