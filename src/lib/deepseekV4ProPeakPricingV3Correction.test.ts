import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import {
  classifyCiCurrentChange,
  classifyCiReferenceChange,
  classifySourceConflict,
} from "@/lib/modelPriceChangeClassifier";
import {
  buildCiCurrentSnapshot,
  buildCiReferenceSnapshot,
  buildPublishedBaselineSnapshot,
  type ModelPriceSnapshotRecord,
} from "@/lib/modelPriceSnapshot";
import { getModelPricingPolicy } from "@/lib/modelPricingPolicy";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import {
  computePublishedUserChargeFromResolvedPolicy,
  computePublishedUserChargeWithSnapshot,
  isLiveGradePublishedUserChargeSnapshot,
} from "@/lib/publishedUserCharge";

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

/** Official DeepSeek V4 Pro OFF-PEAK (historical v2 published baseline). */
const OFFICIAL_OFF_PEAK = {
  input: 0.66,
  output: 1.98,
  cacheRead: 0.022,
} as const;

/** Official DeepSeek V4 Pro PEAK (candidate v3 published baseline). */
const OFFICIAL_PEAK = {
  input: 1.32,
  output: 3.96,
  cacheRead: 0.044,
} as const;

/** Immutable v2 pricing embedded in historical receipt snapshots — test-local only. */
const V2_HISTORICAL_PRICING: PublishedModelPricing = {
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  billingReferenceInputUsdPerMillion: OFFICIAL_OFF_PEAK.input,
  billingReferenceOutputUsdPerMillion: OFFICIAL_OFF_PEAK.output,
  billingReferenceCacheReadUsdPerMillion: OFFICIAL_OFF_PEAK.cacheRead,
  targetMargin: 0.5,
  minimumMarginFloor: 0.4,
  pricingVersion: 2,
  publishedAt: "2026-09-02T09:00:00.000Z",
};

function chargeFromPricing(pricing: PublishedModelPricing, usage: ReturnType<typeof normalizeBillableUsage>) {
  return computePublishedUserChargeFromResolvedPolicy({
    requestedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    resolvedPricing: {
      requestedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      canonicalModelId: canonicalizePublishedModelId(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      pricing,
    },
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX_DETERMINISTIC,
    adjustment: { kind: "none" },
    expectedCanonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  });
}

function chargeLive(usage: ReturnType<typeof normalizeBillableUsage>) {
  return computePublishedUserChargeWithSnapshot({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX_DETERMINISTIC,
    adjustment: { kind: "none" },
  });
}

describe("deepseekV4ProPeakPricingV3Correction — RED off-peak baseline proof", () => {
  it("v2 historical row matched official OFF-PEAK exactly (V4_PRO_STABLE_BASELINE_USES_OFF_PEAK)", () => {
    assert.equal(V2_HISTORICAL_PRICING.billingReferenceInputUsdPerMillion, OFFICIAL_OFF_PEAK.input);
    assert.equal(V2_HISTORICAL_PRICING.billingReferenceOutputUsdPerMillion, OFFICIAL_OFF_PEAK.output);
    assert.equal(V2_HISTORICAL_PRICING.billingReferenceCacheReadUsdPerMillion, OFFICIAL_OFF_PEAK.cacheRead);
    assert.equal(OFFICIAL_OFF_PEAK.input * 2, OFFICIAL_PEAK.input);
    assert.equal(OFFICIAL_OFF_PEAK.output * 2, OFFICIAL_PEAK.output);
    assert.equal(OFFICIAL_OFF_PEAK.cacheRead * 2, OFFICIAL_PEAK.cacheRead);
  });
});

describe("deepseekV4ProPeakPricingV3Correction — candidate v3 PEAK row", () => {
  it("live catalog is v3 official PEAK baseline", () => {
    const pricing = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(pricing.pricingVersion, 3);
    assert.equal(pricing.billingReferenceInputUsdPerMillion, OFFICIAL_PEAK.input);
    assert.equal(pricing.billingReferenceOutputUsdPerMillion, OFFICIAL_PEAK.output);
    assert.equal(pricing.billingReferenceCacheReadUsdPerMillion, OFFICIAL_PEAK.cacheRead);
    assert.equal(pricing.targetMargin, 0.5);
    assert.equal(pricing.minimumMarginFloor, 0.4);
    assert.equal(pricing.publishedAt, "2026-09-21T09:00:00.000Z");
  });
});

describe("deepseekV4ProPeakPricingV3Correction — OLD v2 vs NEW v3 P impact matrix", () => {
  const fixtures = [
    { id: "A", promptTokens: 10_000, outputTokens: 500, cacheReadTokens: 0 },
    { id: "B", promptTokens: 30_000, outputTokens: 3_000, cacheReadTokens: 0 },
    { id: "C", promptTokens: 35_000, outputTokens: 4_000, cacheReadTokens: 0 },
    { id: "D", promptTokens: 12_871, outputTokens: 1_273, cacheReadTokens: 12_800 },
    { id: "E", promptTokens: 33_247, outputTokens: 3_461, cacheReadTokens: 0 },
    { id: "F", promptTokens: 8_000, outputTokens: 1_500, cacheReadTokens: 0 },
  ] as const;

  for (const fixture of fixtures) {
    it(`${fixture.id}: reference cost and final P double within rounding (±1P)`, () => {
      const usage = normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: fixture.promptTokens,
        outputTokens: fixture.outputTokens,
        cacheReadTokens: fixture.cacheReadTokens,
      });
      const v2 = chargeFromPricing(V2_HISTORICAL_PRICING, usage);
      const v3 = chargeLive(usage);
      assert.equal(v2.status, "complete");
      assert.equal(v3.status, "complete");
      if (v2.status !== "complete" || v3.status !== "complete") return;

      const v2Usd = v2.snapshot.billingReferenceCostUsd;
      const v3Usd = v3.snapshot.billingReferenceCostUsd;
      assert.ok(Math.abs(v3Usd - v2Usd * 2) < 1e-9, `${fixture.id} reference USD not 2x`);

      const v2Points = v2.snapshot.finalPoints;
      const v3Points = v3.snapshot.finalPoints;
      assert.ok(Math.abs(v3Points - v2Points * 2) <= 1, `${fixture.id} final P not ~2x`);
    });
  }

  it("E golden fixture: v2=90P v3=180P", () => {
    const usage = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 33_247,
      outputTokens: 3_461,
    });
    const v2 = chargeFromPricing(V2_HISTORICAL_PRICING, usage);
    const v3 = chargeLive(usage);
    assert.equal(v2.status, "complete");
    assert.equal(v3.status, "complete");
    if (v2.status === "complete") assert.equal(v2.snapshot.finalPoints, 90);
    if (v3.status === "complete") assert.equal(v3.snapshot.finalPoints, 180);
  });

  it("D cache-heavy fixture: v2=9P v3=18P", () => {
    const usage = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 12_871,
      outputTokens: 1_273,
      cacheReadTokens: 12_800,
    });
    const v2 = chargeFromPricing(V2_HISTORICAL_PRICING, usage);
    const v3 = chargeLive(usage);
    assert.equal(v2.status, "complete");
    assert.equal(v3.status, "complete");
    if (v2.status === "complete") assert.equal(v2.snapshot.finalPoints, 9);
    if (v3.status === "complete") assert.equal(v3.snapshot.finalPoints, 18);
  });
});

describe("deepseekV4ProPeakPricingV3Correction — historical v2 snapshot immutability", () => {
  it("v2 embedded snapshot replay keeps pricingVersion=2 and original charged P", () => {
    const usage = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      promptTokens: 33_247,
      outputTokens: 3_461,
    });
    const historical = chargeFromPricing(V2_HISTORICAL_PRICING, usage);
    const live = chargeLive(usage);
    assert.equal(historical.status, "complete");
    assert.equal(live.status, "complete");
    if (historical.status === "complete") {
      assert.equal(historical.snapshot.pricingVersion, 2);
      assert.equal(historical.snapshot.finalPoints, 90);
      assert.equal(isLiveGradePublishedUserChargeSnapshot(historical.snapshot), false);
      assert.notEqual(historical.snapshot.finalPoints, live.status === "complete" ? live.snapshot.finalPoints : null);
    }
  });
});

describe("deepseekV4ProPeakPricingV3Correction — tracker semantic-domain matrix T1-T4", () => {
  const observedAt = "2026-09-21T09:00:00.000Z";
  const runDateKey = "2026-09-21";
  const policy = getModelPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
  const published = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);

  function deepSeekReferenceSnapshot(
    reference: Partial<{
      input: number;
      output: number;
      cacheRead: number;
    }>
  ): ModelPriceSnapshotRecord {
    return buildCiReferenceSnapshot({
      policy,
      catalog: {
        modelId: policy.expectedProviderModelId,
        inputUsdPerMillion: 0.33,
        outputUsdPerMillion: 0.99,
        cacheReadUsdPerMillion: 0.033,
        cacheWriteUsdPerMillion: 0.33,
        referenceInputUsdPerMillion: reference.input ?? OFFICIAL_OFF_PEAK.input,
        referenceOutputUsdPerMillion: reference.output ?? OFFICIAL_OFF_PEAK.output,
        referenceCacheReadUsdPerMillion: reference.cacheRead ?? OFFICIAL_OFF_PEAK.cacheRead,
      },
      observedAt,
    })!;
  }

  it("T1: published PEAK vs CI procurement_reference OFF-PEAK → no SOURCE_CONFLICT", () => {
    const publishedBaseline = buildPublishedBaselineSnapshot({ policy, published, observedAt });
    const ciReference = deepSeekReferenceSnapshot({});
    assert.equal(publishedBaseline.rates.inputUsdPerMillion, OFFICIAL_PEAK.input);
    assert.equal(ciReference.rates.inputUsdPerMillion, OFFICIAL_OFF_PEAK.input);
    const conflict = classifySourceConflict({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      ciReference,
      publishedBaseline,
      runDateKey,
    });
    assert.equal(conflict, null);
  });

  it("T2: CI reference 0.66/1.98 → 0.70/2.10 → CI_REFERENCE_CHANGED_UNVERIFIED/HOLD", () => {
    const prev = deepSeekReferenceSnapshot({});
    const next = deepSeekReferenceSnapshot({ input: 0.7, output: 2.1, cacheRead: 0.023 });
    const events = classifyCiReferenceChange({
      policy,
      published,
      previous: prev,
      current: next,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "CI_REFERENCE_CHANGED_UNVERIFIED");
    assert.equal(events[0]?.action, "HOLD");
  });

  it("T3: CI current procurement changes → PROCUREMENT_ONLY event", () => {
    const prev = buildCiCurrentSnapshot({
      policy,
      catalog: {
        modelId: policy.expectedProviderModelId,
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.5,
        cacheReadUsdPerMillion: 0.05,
        cacheWriteUsdPerMillion: 0.5,
        referenceInputUsdPerMillion: OFFICIAL_OFF_PEAK.input,
        referenceOutputUsdPerMillion: OFFICIAL_OFF_PEAK.output,
        discountPercent: 25,
      },
      observedAt,
    });
    const next = buildCiCurrentSnapshot({
      policy,
      catalog: {
        modelId: policy.expectedProviderModelId,
        inputUsdPerMillion: 0.3,
        outputUsdPerMillion: 0.9,
        cacheReadUsdPerMillion: 0.03,
        cacheWriteUsdPerMillion: 0.3,
        referenceInputUsdPerMillion: OFFICIAL_OFF_PEAK.input,
        referenceOutputUsdPerMillion: OFFICIAL_OFF_PEAK.output,
        discountPercent: 55,
      },
      observedAt,
    });
    const events = classifyCiCurrentChange({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      previous: prev,
      current: next,
    });
    assert.ok(events.some((e) => e.action === "PROCUREMENT_ONLY"));
  });

  it("T4: mocked official PEAK vs published PEAK stays dormant until Phase B adapter wires comparable domains", () => {
    const publishedBaseline = buildPublishedBaselineSnapshot({ policy, published, observedAt });
    const mockOfficialPeak: ModelPriceSnapshotRecord = {
      ...publishedBaseline,
      pricingMode: "provider_peak",
      sourceKind: "cheaper_inference_models_reference",
      rates: {
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 4.2,
        cacheReadUsdPerMillion: 0.04,
        cacheWriteUsdPerMillion: null,
        tierThreshold: null,
        discountPercent: null,
      },
      rawFingerprint: "mock-official-peak-mismatch",
    };
    const conflict = classifySourceConflict({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      ciReference: mockOfficialPeak,
      publishedBaseline,
      runDateKey,
    });
    assert.equal(conflict, null);
  });
});
