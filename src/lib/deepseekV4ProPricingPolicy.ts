/**
 * DeepSeek V4 Pro 0813 Published billing Phase 2 — price policy calibration.
 * Readiness / shadow only until explicit Phase 2 cutover dispatch.
 */

import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import {
  computePublishedUserChargeWithSnapshot,
  type PublishedUserChargeSnapshot,
} from "@/lib/publishedUserCharge";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE,
  DEEPSEEK_V4_PRO_MODEL_ID,
  FX_FIXTURE_BASE_1530,
  FX_FIXTURE_CARD_FEE,
} from "@/lib/deepseekV4ProPricingPolicy.constants";

export {
  DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE,
  DEEPSEEK_V4_PRO_MODEL_ID,
  DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE,
  FX_FIXTURE_BASE_1530,
  FX_FIXTURE_CARD_FEE,
} from "@/lib/deepseekV4ProPricingPolicy.constants";

export const DEEPSEEK_V4_PRO_V1_PUBLISHED: PublishedModelPricing = {
  modelId: DEEPSEEK_V4_PRO_MODEL_ID,
  billingReferenceInputUsdPerMillion: 0.435,
  billingReferenceOutputUsdPerMillion: 0.87,
  billingReferenceCacheReadUsdPerMillion: 0.0435,
  billingReferenceCacheWriteUsdPerMillion: 0.435,
  targetMargin: 0.45,
  minimumMarginFloor: 0.3,
  pricingVersion: 1,
  publishedAt: "2026-08-28T00:00:00.000Z",
};

export const DEEPSEEK_V4_PRO_V2_PROPOSED: PublishedModelPricing = {
  modelId: DEEPSEEK_V4_PRO_MODEL_ID,
  billingReferenceInputUsdPerMillion: 0.66,
  billingReferenceOutputUsdPerMillion: 1.98,
  billingReferenceCacheReadUsdPerMillion: 0.022,
  targetMargin: 0.5,
  minimumMarginFloor: 0.4,
  pricingVersion: 2,
  publishedAt: "2026-09-02T09:00:00.000Z",
};

export function buildDeepSeekV4ProFxSnapshot(baseUsdToKrw: number = FX_FIXTURE_BASE_1530): BillingFxSnapshot {
  const effectiveKrwPerUsd = applyOverseasCardFee(baseUsdToKrw);
  return {
    mode: "daily_kst",
    dateKey: "2026-08-28",
    usdToKrw: baseUsdToKrw,
    effectiveKrwPerUsd,
    source: "api_daily",
    overseasFeeRate: FX_FIXTURE_CARD_FEE,
    locked: true,
  };
}

export type DeepSeekV4ProPolicyRow = {
  finalPoints: number;
  snapshot: PublishedUserChargeSnapshot;
};

export function simulateDeepSeekV4ProPublishedCharge(opts: {
  promptTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  fxSnapshot?: BillingFxSnapshot;
}): DeepSeekV4ProPolicyRow | null {
  const fxSnapshot = opts.fxSnapshot ?? buildDeepSeekV4ProFxSnapshot();
  const usage = normalizeBillableUsage({
    modelId: DEEPSEEK_V4_PRO_MODEL_ID,
    promptTokens: opts.promptTokens,
    outputTokens: opts.outputTokens,
    reasoningTokens: opts.reasoningTokens,
    cacheReadTokens: opts.cacheReadTokens,
    cacheWriteTokens: opts.cacheWriteTokens,
  });
  const result = computePublishedUserChargeWithSnapshot({
    modelId: DEEPSEEK_V4_PRO_MODEL_ID,
    usage,
    usageCoverage: "complete",
    fxSnapshot,
    adjustment: { kind: "none" },
  });
  if (result.status !== "complete") return null;
  return {
    finalPoints: result.snapshot.finalPoints,
    snapshot: result.snapshot,
  };
}

export type DeepSeekV4ProAcceptanceGates = {
  COMPETITOR_FIXTURE_V2_POINTS: boolean;
  V2_RATES_MATCH_POLICY: boolean;
  V2_MARGIN_MATCH_POLICY: boolean;
  CACHE_READ_REFERENCE_RATE_PRESENT: boolean;
  CACHE_WRITE_REFERENCE_RATE_ABSENT: boolean;
  allPass: boolean;
};

export function evaluateDeepSeekV4ProV2AcceptanceGates(
  expectedCompetitorFixturePoints: number
): DeepSeekV4ProAcceptanceGates {
  const row = simulateDeepSeekV4ProPublishedCharge({
    promptTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.inputTokens,
    outputTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.outputTokens,
    reasoningTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.reasoningTokens,
  });
  const gates: DeepSeekV4ProAcceptanceGates = {
    COMPETITOR_FIXTURE_V2_POINTS: row?.finalPoints === expectedCompetitorFixturePoints,
    V2_RATES_MATCH_POLICY:
      DEEPSEEK_V4_PRO_V2_PROPOSED.billingReferenceInputUsdPerMillion === 0.66 &&
      DEEPSEEK_V4_PRO_V2_PROPOSED.billingReferenceOutputUsdPerMillion === 1.98 &&
      DEEPSEEK_V4_PRO_V2_PROPOSED.billingReferenceCacheReadUsdPerMillion === 0.022,
    V2_MARGIN_MATCH_POLICY:
      DEEPSEEK_V4_PRO_V2_PROPOSED.targetMargin === 0.5 &&
      DEEPSEEK_V4_PRO_V2_PROPOSED.minimumMarginFloor === 0.4,
    CACHE_READ_REFERENCE_RATE_PRESENT:
      DEEPSEEK_V4_PRO_V2_PROPOSED.billingReferenceCacheReadUsdPerMillion != null,
    CACHE_WRITE_REFERENCE_RATE_ABSENT:
      DEEPSEEK_V4_PRO_V2_PROPOSED.billingReferenceCacheWriteUsdPerMillion == null,
    allPass: false,
  };
  gates.allPass =
    gates.COMPETITOR_FIXTURE_V2_POINTS &&
    gates.V2_RATES_MATCH_POLICY &&
    gates.V2_MARGIN_MATCH_POLICY &&
    gates.CACHE_READ_REFERENCE_RATE_PRESENT &&
    gates.CACHE_WRITE_REFERENCE_RATE_ABSENT;
  return gates;
}
