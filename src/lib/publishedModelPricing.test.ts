import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublishedPricing, listExactPublishedCatalogEntries } from "./publishedModelPricing";
import { evaluateGemini37V2AcceptanceGates } from "./gemini37PricingPolicy";
import { evaluatePremiumPricingGates } from "./premiumPricingCalibration";
import { requirePrimaryBenchmark } from "./marketUsageBenchmarks";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "./chatModels";
import { normalizeBillableUsage } from "./billingUsage";
import { computePublishedUserChargeWithSnapshot } from "./publishedUserCharge";
import type { BillingFxSnapshot } from "./billingFxSnapshot";

describe("publishedModelPricing", () => {
  it("billingReference is independent of provider list", () => {
    const p = getPublishedPricing("claude-opus-5");
    assert.equal(p.billingReferenceInputUsdPerMillion > 0, true);
    assert.equal(typeof p.targetMargin, "number");
    assert.equal(p.pricingVersion, 2);
    assert.equal(p.targetMargin, 0.08);
    assert.equal(p.minimumMarginFloor, 0.05);
  });

  it("google gemini 3.1 alias resolves to canonical published owner", () => {
    const canonical = getPublishedPricing("gemini-3.1-pro-preview");
    const alias = getPublishedPricing("google/gemini-3.1-pro-preview");
    assert.equal(alias.modelId, "gemini-3.1-pro-preview");
    assert.equal(alias.pricingVersion, canonical.pricingVersion);
    assert.equal(alias.targetMargin, canonical.targetMargin);
  });

  it("does not duplicate market usage benchmarks on published entries", () => {
    const g = getPublishedPricing("gemini-3.1-pro-preview");
    assert.equal("marketUsageBenchmark" in g, false);
    assert.equal("marketBenchmark" in g, false);
    const benchmark = requirePrimaryBenchmark("gemini-3.1-pro-preview");
    assert.equal(benchmark.inputTokens, 40_689);
  });

  it("premium models published v2 shadow calibration", () => {
    const gates = evaluatePremiumPricingGates();
    assert.equal(gates.allPass, true);
    const g = getPublishedPricing("gemini-3.1-pro-preview");
    assert.equal(g.pricingVersion, 2);
    assert.equal(g.billingReferenceInputUsdPerMillion, 2);
    assert.equal(g.billingReferenceOutputUsdPerMillion, 12);
    assert.equal(g.targetMargin, 0.09);
    assert.equal(g.minimumMarginFloor, 0.05);
    const o = getPublishedPricing("claude-opus-5");
    assert.equal(o.pricingVersion, 2);
    assert.equal(o.targetMargin, 0.08);
    assert.equal(o.minimumMarginFloor, 0.05);
  });

  it("gemini 3.7 flash published v2 shadow calibration", () => {
    const gates = evaluateGemini37V2AcceptanceGates();
    assert.equal(gates.allPass, true);
    const g = getPublishedPricing("gemini-3.7-flash");
    assert.equal(g.pricingVersion, 2);
    assert.equal(g.billingReferenceInputUsdPerMillion, 0.375);
    assert.equal(g.billingReferenceOutputUsdPerMillion, 1.875);
    assert.equal(g.targetMargin, 0.55);
    assert.equal(g.minimumMarginFloor, 0.5);
  });

  it("deepseek v4 pro 0813 published v2 shadow calibration", () => {
    const d = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(d.pricingVersion, 2);
    assert.equal(d.billingReferenceInputUsdPerMillion, 0.66);
    assert.equal(d.billingReferenceOutputUsdPerMillion, 1.98);
    assert.equal(d.billingReferenceCacheReadUsdPerMillion, 0.022);
    assert.equal(d.billingReferenceCacheWriteUsdPerMillion, undefined);
    assert.equal(d.targetMargin, 0.5);
    assert.equal(d.minimumMarginFloor, 0.4);
    const alias = getPublishedPricing("deepseek-v4-pro");
    assert.equal(alias.pricingVersion, d.pricingVersion);
    assert.equal(alias.modelId, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);

    const fx: BillingFxSnapshot = {
      mode: "daily_kst",
      dateKey: "2026-08-28",
      usdToKrw: 1530,
      effectiveKrwPerUsd: 1560.6,
      source: "api_daily",
      overseasFeeRate: 0.02,
      locked: true,
    };
    const charge = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      usage: normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        promptTokens: 33_247,
        outputTokens: 3_461,
      }),
      usageCoverage: "complete",
      fxSnapshot: fx,
      adjustment: { kind: "none" },
    });
    assert.equal(charge.status, "complete");
    if (charge.status === "complete") assert.equal(charge.snapshot.finalPoints, 90);
  });

  it("PUBLISHED_CATALOG_IDENTITY_INVARIANT — catalog key equals pricing.modelId", () => {
    for (const entry of listExactPublishedCatalogEntries()) {
      assert.equal(
        entry.pricing.modelId,
        entry.canonicalModelId,
        `catalog identity mismatch for ${entry.canonicalModelId}`
      );
      assert.equal(entry.canonicalModelId, entry.pricing.modelId.trim());
    }
  });
});
