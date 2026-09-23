import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import { computeTurnBilling } from "@/lib/pointsReasoningMargins";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import { computePublishedUserChargeFromResolvedPolicy } from "@/lib/publishedUserCharge";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-22",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const MAIN_RP_PREP_MODELS = [
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
] as const;

function publishedProductCharge(
  modelId: string,
  promptTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number | null {
  const resolved = resolvePublishedPricingExact(modelId);
  if (!resolved) return null;
  const usage = normalizeBillableUsage({
    modelId,
    promptTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });
  const result = computePublishedUserChargeFromResolvedPolicy({
    requestedModelId: modelId,
    resolvedPricing: resolved,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX,
    adjustment: { kind: "none" },
  });
  return result.status === "complete" ? result.snapshot.finalPoints : null;
}

describe("Main RP user price determinism — published PRODUCT engine", () => {
  for (const modelId of MAIN_RP_PREP_MODELS) {
    it(`${modelId} — identical billable totals with zero cache are stable`, () => {
      const a = publishedProductCharge(modelId, 25_000, 2_000, 0, 0);
      const b = publishedProductCharge(modelId, 25_000, 2_000, 0, 0);
      assert.equal(a, b);
      assert.ok(a != null && a > 0);
    });
  }

  it("Gemini 3.7 — published charge blocks non-zero cache (unknown semantics)", () => {
    const baseline = publishedProductCharge(
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      25_000,
      2_000,
      0,
      0
    );
    const splitCache = publishedProductCharge(
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      25_000,
      2_000,
      12_000,
      0
    );
    assert.ok(baseline != null);
    assert.equal(splitCache, null);
  });
});

describe("Main RP user price determinism — legacy live path (documented boundaries)", () => {
  it("Gemini 3.7 legacy charge still couples to upstreamCostUsd (legacy boundary — not PRODUCT)", () => {
    const base = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: 25_000,
      outputTokens: 2_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiPromptTokens: 25_000,
      apiCompletionTokens: 2_000,
    }).total;
    const withUpstream = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: 25_000,
      outputTokens: 2_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiPromptTokens: 25_000,
      apiCompletionTokens: 2_000,
      upstreamCostUsd: 0.05,
    }).total;
    assert.notEqual(withUpstream, base);
    const published = publishedProductCharge(
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      25_000,
      2_000
    );
    assert.ok(published != null);
    assert.notEqual(withUpstream, published);
  });

  it("Gemini 3.7 legacy charge can differ when cache buckets split (procurement path — not PRODUCT)", () => {
    const noCache = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: 25_000,
      outputTokens: 2_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiPromptTokens: 25_000,
      apiCompletionTokens: 2_000,
    }).total;
    const cacheHit = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: 25_000,
      outputTokens: 2_000,
      cacheReadTokens: 10_000,
      cacheWriteTokens: 0,
      apiPromptTokens: 25_000,
      apiCompletionTokens: 2_000,
    }).total;
    assert.notEqual(cacheHit, noCache);
  });

  it("provider_attempt_count is not a billing input — repeated identical legacy calls match", () => {
    const opts = {
      provider: "cheaperinference" as const,
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      inputTokens: 15_000,
      outputTokens: 1_500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiPromptTokens: 15_000,
      apiCompletionTokens: 1_500,
    };
    assert.equal(computeTurnBilling(opts).total, computeTurnBilling(opts).total);
  });
});
