import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { getModelPublishedPricingPolicy } from "@/lib/modelPublishedPricingPolicy";
import {
  computePublishedUserChargeFromResolvedPolicy,
  computePublishedUserChargeWithSnapshot,
  isLiveGradePublishedUserChargeSnapshot,
} from "@/lib/publishedUserCharge";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";

/** Deterministic regression FX only — not runtime FX owner. */
const FX_DETERMINISTIC: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const COMPETITOR_FIXTURE = {
  promptTokens: 33_247,
  outputTokens: 3_461,
  expectedPoints: 90,
} as const;

/**
 * Class A sanitized production usage — CheaperInference DeepSeek V4 Pro.
 * Source: data/shared-novel-prose-v2-luna-gemini-deepseek-metadata.json (DeepSeek-A)
 * requestModelId/responseModelId deepseek-v4-pro → canonicalizes to deepseek-v4-pro-0813.
 */
const PRODUCTION_CACHE_READ_FIXTURE = {
  promptTokens: 12_871,
  cacheReadTokens: 12_800,
  outputTokens: 1_273,
  expectedPoints: 9,
} as const;

/** Immutable v1 pricing embedded in historical receipt snapshots — test-local only. */
const V1_HISTORICAL_PRICING: PublishedModelPricing = {
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  billingReferenceInputUsdPerMillion: 0.435,
  billingReferenceOutputUsdPerMillion: 0.87,
  billingReferenceCacheReadUsdPerMillion: 0.0435,
  billingReferenceCacheWriteUsdPerMillion: 0.435,
  targetMargin: 0.45,
  minimumMarginFloor: 0.3,
  pricingVersion: 1,
  publishedAt: "2026-08-28T00:00:00.000Z",
};

function charge(modelId: string, usage: ReturnType<typeof normalizeBillableUsage>) {
  return computePublishedUserChargeWithSnapshot({
    modelId,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX_DETERMINISTIC,
    adjustment: { kind: "none" },
  });
}

describe("deepseekV4ProPublishedBilling", () => {
  it("v2 catalog is the sole published pricing owner", () => {
    const pricing = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(pricing.modelId, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(pricing.pricingVersion, 2);
    assert.equal(pricing.billingReferenceInputUsdPerMillion, 0.66);
    assert.equal(pricing.billingReferenceOutputUsdPerMillion, 1.98);
    assert.equal(pricing.billingReferenceCacheReadUsdPerMillion, 0.022);
    assert.equal(pricing.billingReferenceCacheWriteUsdPerMillion, undefined);
    assert.equal(pricing.targetMargin, 0.5);
    assert.equal(pricing.minimumMarginFloor, 0.4);
  });

  it("competitor fixture + deterministic FX → exactly 90P", () => {
    const r = charge(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: COMPETITOR_FIXTURE.promptTokens,
        outputTokens: COMPETITOR_FIXTURE.outputTokens,
      })
    );
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      assert.equal(r.snapshot.finalPoints, COMPETITOR_FIXTURE.expectedPoints);
    }
  });

  it("legacy alias resolves to canonical published owner", () => {
    assert.equal(
      canonicalizePublishedModelId("deepseek-v4-pro"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(
      canonicalizePublishedModelId("deepseek/deepseek-v4-pro"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    const legacy = getPublishedPricing("deepseek-v4-pro");
    const canonical = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(legacy.pricingVersion, canonical.pricingVersion);
    assert.equal(legacy.modelId, canonical.modelId);
  });

  it("production cache-read fixture → complete with verified semantics", () => {
    for (const modelId of [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, "deepseek-v4-pro"]) {
      const usage = normalizeBillableUsage({
        modelId,
        promptTokens: PRODUCTION_CACHE_READ_FIXTURE.promptTokens,
        outputTokens: PRODUCTION_CACHE_READ_FIXTURE.outputTokens,
        cacheReadTokens: PRODUCTION_CACHE_READ_FIXTURE.cacheReadTokens,
      });
      const r = charge(modelId, usage);
      assert.equal(r.status, "complete", modelId);
      if (r.status === "complete") {
        assert.equal(r.snapshot.finalPoints, PRODUCTION_CACHE_READ_FIXTURE.expectedPoints, modelId);
        assert.equal(r.snapshot.canonicalModelId, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, modelId);
        assert.equal(r.snapshot.applicability.cacheSemanticStatus, "verified", modelId);
      }
    }
  });

  it("cache-write tokens → blocked (no published cache-write rate)", () => {
    for (const modelId of [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, "deepseek-v4-pro"]) {
      const r = charge(
        modelId,
        normalizeBillableUsage({
          modelId,
          promptTokens: 10_000,
          outputTokens: 500,
          cacheWriteTokens: 2_000,
        })
      );
      assert.equal(r.status, "blocked", modelId);
      if (r.status === "blocked") {
        assert.equal(r.reason, "unsupported_cache_semantics", modelId);
      }
    }
  });

  it("v1 historical snapshot replay uses embedded pricingVersion, not live catalog", () => {
    const v1 = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: "deepseek-v4-pro",
      resolvedPricing: {
        requestedModelId: "deepseek-v4-pro",
        canonicalModelId: canonicalizePublishedModelId("deepseek-v4-pro"),
        pricing: V1_HISTORICAL_PRICING,
      },
      usage: normalizeBillableUsage({
        modelId: "deepseek-v4-pro",
        promptTokens: COMPETITOR_FIXTURE.promptTokens,
        outputTokens: COMPETITOR_FIXTURE.outputTokens,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX_DETERMINISTIC,
      adjustment: { kind: "none" },
      expectedCanonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    });
    assert.equal(v1.status, "complete");
    if (v1.status === "complete") {
      assert.equal(v1.snapshot.pricingVersion, 1);
      assert.equal(v1.snapshot.finalPoints, 50);
      assert.equal(isLiveGradePublishedUserChargeSnapshot(v1.snapshot), false);
      assert.notEqual(v1.snapshot.finalPoints, COMPETITOR_FIXTURE.expectedPoints);
    }
  });

  it("zero reasoning and included-in-output do not double-count output", () => {
    const baseline = charge(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: 1000,
        outputTokens: 5000,
      })
    );
    const withReasoning = charge(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: 1000,
        outputTokens: 5000,
        reasoningTokens: 1500,
      })
    );
    assert.equal(baseline.status, "complete");
    assert.equal(withReasoning.status, "complete");
    if (baseline.status === "complete" && withReasoning.status === "complete") {
      assert.equal(withReasoning.snapshot.finalPoints, baseline.snapshot.finalPoints);
    }
  });

  it("partial and unknown usage coverage → blocked", () => {
    for (const usageCoverage of ["partial", "unknown"] as const) {
      const r = computePublishedUserChargeWithSnapshot({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        usage: normalizeBillableUsage({
          modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
          promptTokens: 1000,
          outputTokens: 500,
        }),
        usageCoverage,
        fxSnapshot: FX_DETERMINISTIC,
        adjustment: { kind: "none" },
      });
      assert.equal(r.status, "blocked", usageCoverage);
      if (r.status === "blocked") assert.equal(r.finalPoints, null, usageCoverage);
    }
  });

  it("cache read policy references sanitized production evidence", () => {
    const policy = getModelPublishedPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.ok(policy);
    assert.equal(policy!.cacheSemanticStatus, "verified");
    assert.equal(getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL).billingReferenceCacheWriteUsdPerMillion, undefined);
  });
});
