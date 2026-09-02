import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE,
  DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE,
  DEEPSEEK_V4_PRO_V1_PUBLISHED,
  DEEPSEEK_V4_PRO_V2_PROPOSED,
  buildDeepSeekV4ProFxSnapshot,
  evaluateDeepSeekV4ProV2AcceptanceGates,
  simulateDeepSeekV4ProPublishedCharge,
} from "./deepseekV4ProPricingPolicy";
import { getPublishedPricing } from "./publishedModelPricing";
import { canonicalizePublishedModelId } from "./publishedModelAliases";
import { getModelPublishedPricingPolicy } from "./modelPublishedPricingPolicy";

describe("deepseekV4ProPricingPolicy", () => {
  it("v2 published catalog matches Phase 2 policy constants", () => {
    const catalog = getPublishedPricing("deepseek-v4-pro-0813");
    assert.equal(catalog.pricingVersion, DEEPSEEK_V4_PRO_V2_PROPOSED.pricingVersion);
    assert.equal(catalog.billingReferenceInputUsdPerMillion, 0.66);
    assert.equal(catalog.billingReferenceOutputUsdPerMillion, 1.98);
    assert.equal(catalog.billingReferenceCacheReadUsdPerMillion, 0.022);
    assert.equal(catalog.billingReferenceCacheWriteUsdPerMillion, undefined);
    assert.equal(catalog.targetMargin, 0.5);
    assert.equal(catalog.minimumMarginFloor, 0.4);
  });

  it("acceptance gates pass at canonical competitor fixture points", () => {
    const gates = evaluateDeepSeekV4ProV2AcceptanceGates(90);
    assert.equal(gates.allPass, true);
  });

  it("legacy alias resolves to canonical published owner", () => {
    assert.equal(canonicalizePublishedModelId("deepseek-v4-pro"), "deepseek-v4-pro-0813");
    assert.equal(canonicalizePublishedModelId("deepseek/deepseek-v4-pro"), "deepseek-v4-pro-0813");
    const legacy = getPublishedPricing("deepseek-v4-pro");
    const canonical = getPublishedPricing("deepseek-v4-pro-0813");
    assert.equal(legacy.pricingVersion, canonical.pricingVersion);
    assert.equal(legacy.targetMargin, canonical.targetMargin);
  });

  it("prefix cache read policy is verified without cache-write reference rate", () => {
    const policy = getModelPublishedPricingPolicy("deepseek-v4-pro-0813");
    assert.ok(policy);
    assert.equal(policy!.cacheSemanticStatus, "verified");
    assert.equal(getPublishedPricing("deepseek-v4-pro-0813").billingReferenceCacheWriteUsdPerMillion, undefined);
  });

  it("competitor fixture simulates to 90P @1530/2%", () => {
    const row = simulateDeepSeekV4ProPublishedCharge({
      promptTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.inputTokens,
      outputTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.outputTokens,
    });
    assert.ok(row);
    assert.equal(row!.finalPoints, 90);
  });

  it("prefix cache-read fixture simulates to 6P @1530/2%", () => {
    const row = simulateDeepSeekV4ProPublishedCharge({
      promptTokens: DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE.promptTokens,
      outputTokens: DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE.outputTokens,
      cacheReadTokens: DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE.cacheReadTokens,
    });
    assert.ok(row);
    assert.equal(row!.finalPoints, 6);
  });

  it("v1 historical pricing remains distinct for snapshot replay", () => {
    assert.equal(DEEPSEEK_V4_PRO_V1_PUBLISHED.pricingVersion, 1);
    assert.equal(DEEPSEEK_V4_PRO_V2_PROPOSED.pricingVersion, 2);
    assert.notEqual(
      DEEPSEEK_V4_PRO_V1_PUBLISHED.billingReferenceInputUsdPerMillion,
      DEEPSEEK_V4_PRO_V2_PROPOSED.billingReferenceInputUsdPerMillion
    );
  });

  it("fx snapshot builder uses canonical 2% overseas fee", () => {
    const fx = buildDeepSeekV4ProFxSnapshot();
    assert.equal(fx.usdToKrw, 1530);
    assert.equal(fx.overseasFeeRate, 0.02);
    assert.ok(Math.abs(fx.effectiveKrwPerUsd - 1560.6) < 1e-9);
  });
});
