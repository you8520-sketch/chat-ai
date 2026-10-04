import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublishedPricing, listExactPublishedCatalogEntries } from "./publishedModelPricing";
import { evaluateGemini37V2AcceptanceGates } from "./gemini37PricingPolicy";
import { evaluatePremiumPricingGates } from "./premiumPricingCalibration";
import { requirePrimaryBenchmark } from "./marketUsageBenchmarks";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "./chatModels";
import { normalizeBillableUsage } from "./billingUsage";
import {
  computePublishedStandardPreviewDisplayPoints,
  computePublishedStandardPreviewPoints,
  computePublishedUserChargeWithSnapshot,
} from "./publishedUserCharge";
import { isPublishedCacheBreakdownPriceNeutral } from "./modelPublishedPricingPolicy";
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

  it("deepseek v4 pro 0813 published v4 official PEAK competitive calibration", () => {
    const d = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(d.pricingVersion, 4);
    assert.equal(d.billingReferenceInputUsdPerMillion, 1.32);
    assert.equal(d.billingReferenceOutputUsdPerMillion, 3.96);
    assert.equal(d.billingReferenceCacheReadUsdPerMillion, 0.044);
    assert.equal(d.billingReferenceCacheWriteUsdPerMillion, undefined);
    assert.equal(d.targetMargin, 0.1);
    assert.equal(d.minimumMarginFloor, 0);
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
    if (charge.status === "complete") assert.equal(charge.snapshot.finalPoints, 100);
  });

  it("V4.1 standard preview and live published charge share one arithmetic owner", () => {
    const fx: BillingFxSnapshot = {
      mode: "daily_kst",
      dateKey: "2026-08-28",
      usdToKrw: 1530,
      effectiveKrwPerUsd: 1560.6,
      source: "api_daily",
      overseasFeeRate: 0.02,
      locked: true,
    };
    const inputTokens = 22_000;
    const outputTokens = 1_500;
    const preview = computePublishedStandardPreviewPoints({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      promptTokens: inputTokens,
      outputTokens,
      effectiveKrwPerUsd: fx.effectiveKrwPerUsd,
    });
    const live = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      usage: normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        promptTokens: inputTokens,
        outputTokens,
      }),
      usageCoverage: "complete",
      fxSnapshot: fx,
      adjustment: { kind: "none" },
    });
    assert.equal(live.status, "complete");
    if (live.status === "complete") {
      assert.equal(preview, live.snapshot.finalPoints);
      assert.equal(live.snapshot.pricingVersion, 1);
      assert.equal(live.snapshot.targetMargin, 0.6);
    }
  });

  it("Opus 5.5 uses the shared 45% target-margin owner and stays cache-partition price-neutral", () => {
    const p = getPublishedPricing("claude-opus-5.5");
    assert.equal(p.commercialPricingOwner, "target_margin");
    assert.equal(p.billingReferenceInputUsdPerMillion, 2.8);
    assert.equal(p.billingReferenceOutputUsdPerMillion, 14);
    assert.equal(p.targetMargin, 0.45);
    assert.equal(p.minimumMarginFloor, 0.3);
    assert.equal(p.pricingVersion, 2);
    assert.equal(isPublishedCacheBreakdownPriceNeutral("claude-opus-5.5"), true);
    assert.equal(
      p.billingReferenceCacheReadUsdPerMillion,
      p.billingReferenceInputUsdPerMillion
    );
    assert.equal(
      p.billingReferenceCacheWriteUsdPerMillion,
      p.billingReferenceInputUsdPerMillion
    );
  });

  it("Opus 5.5 competitor receipt workload prices to 1,262P at 45% margin", () => {
    const fx: BillingFxSnapshot = {
      mode: "daily_kst",
      dateKey: "2026-10-04",
      usdToKrw: 1530,
      effectiveKrwPerUsd: 1560.6,
      source: "api_daily",
      overseasFeeRate: 0.02,
      locked: true,
    };
    const result = computePublishedUserChargeWithSnapshot({
      modelId: "claude-opus-5.5",
      usage: normalizeBillableUsage({
        modelId: "claude-opus-5.5",
        promptTokens: 71_257,
        outputTokens: 17_508,
        reasoningTokens: 0,
      }),
      usageCoverage: "complete",
      fxSnapshot: fx,
      adjustment: { kind: "none" },
    });
    assert.equal(result.status, "complete");
    if (result.status === "complete") {
      assert.equal(result.snapshot.billingReferenceCostUsd, 0.4446316);
      assert.equal(result.snapshot.billingReferenceCostKrw, 693.9);
      assert.equal(result.snapshot.standardUserChargeKrw, 1261.6);
      assert.equal(result.snapshot.finalPoints, 1262);
    }

    assert.equal(
      computePublishedStandardPreviewDisplayPoints({
        modelId: "claude-opus-5.5",
        promptTokens: 20_000,
        outputTokens: 1_500,
        effectiveKrwPerUsd: 1560.6,
      }),
      219
    );
    assert.equal(
      computePublishedStandardPreviewPoints({
        modelId: "claude-opus-5.5",
        promptTokens: 20_000,
        outputTokens: 1_500,
        effectiveKrwPerUsd: 1560.6,
      }),
      219
    );
  });

  it("GPT-6.1 Sol published official Standard at 45% target margin", () => {
    const p = getPublishedPricing("gpt-6.1-sol");
    assert.equal(p.modelId, "gpt-6.1-sol");
    assert.equal(p.billingReferenceInputUsdPerMillion, 2);
    assert.equal(p.billingReferenceCacheReadUsdPerMillion, 0.1);
    assert.equal(p.billingReferenceCacheWriteUsdPerMillion, 2.5);
    assert.equal(p.billingReferenceOutputUsdPerMillion, 10);
    assert.equal(p.billingReferenceLongContextInputUsdPerMillion, 4);
    assert.equal(p.billingReferenceLongContextOutputUsdPerMillion, 15);
    assert.equal(p.targetMargin, 0.45);
    assert.equal(p.publishedLongContextMinPromptTokens, 272_000);
    const alias = getPublishedPricing("openai/gpt-6.1-sol");
    assert.equal(alias.modelId, "gpt-6.1-sol");
    assert.equal(alias.targetMargin, 0.45);
  });

  it("non-Opus published catalog snapshots stay unchanged by the Opus 45% cleanup", () => {
    const others = listExactPublishedCatalogEntries()
      .filter((entry) => entry.canonicalModelId !== "claude-opus-5.5")
      .map((entry) => ({
        id: entry.canonicalModelId,
        target: entry.pricing.targetMargin,
        floor: entry.pricing.minimumMarginFloor,
        in: entry.pricing.billingReferenceInputUsdPerMillion,
        out: entry.pricing.billingReferenceOutputUsdPerMillion,
        ver: entry.pricing.pricingVersion,
      }));
    assert.deepEqual(others, [
      { id: "claude-opus-5", target: 0.08, floor: 0.05, in: 5, out: 25, ver: 2 },
      { id: "anthropic/claude-opus-4.5", target: 0.25, floor: 0.15, in: 5, out: 25, ver: 1 },
      { id: "deepseek-v4-pro-0813", target: 0.1, floor: 0, in: 1.32, out: 3.96, ver: 4 },
      { id: "deepseek-v4.1-flash", target: 0.6, floor: 0.5, in: 0.3, out: 1.2, ver: 1 },
      { id: "meta/muse-spark-1.1", target: 0.55, floor: 0.4, in: 0.435, out: 0.87, ver: 1 },
      { id: "google/gemini-3.6-flash", target: 0.45, floor: 0.3, in: 0.5, out: 2.5, ver: 1 },
      { id: "gemini-3.1-pro-preview", target: 0.09, floor: 0.05, in: 2, out: 12, ver: 2 },
      { id: "gemini-3.7-flash", target: 0.55, floor: 0.5, in: 0.375, out: 1.875, ver: 2 },
      { id: "gemini-3.8-flash", target: 0.55, floor: 0.5, in: 0.375, out: 1.875, ver: 1 },
      { id: "qwen-3-8-max", target: 0.5, floor: 0.35, in: 1.4, out: 4.2, ver: 1 },
      { id: "z-ai/glm-5.2", target: 0.5, floor: 0.35, in: 0.532, out: 1.672, ver: 1 },
      { id: "glm-5.2", target: 0.5, floor: 0.35, in: 0.532, out: 1.672, ver: 1 },
      { id: "moonshotai/kimi-k3", target: 0.4, floor: 0.25, in: 3, out: 15, ver: 1 },
      { id: "deepseek-v4-flash-0731", target: 0.55, floor: 0.4, in: 0.098, out: 0.196, ver: 1 },
      { id: "gpt-5.6-luna", target: 0.5, floor: 0.35, in: 0.08, out: 0.48, ver: 1 },
      { id: "gpt-6.1-sol", target: 0.45, floor: 0.3, in: 2, out: 10, ver: 1 },
    ]);
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
