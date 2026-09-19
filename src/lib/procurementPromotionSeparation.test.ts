import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import {
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "@/lib/chatModels";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getDb } from "@/lib/db";
import {
  createOfficialProviderPromotion,
  updateOfficialProviderPromotionDiscount,
} from "@/lib/officialProviderPromotion";
import { resolveActiveSitePromotion } from "@/lib/sitePromotion";
import {
  computeSiteDiscountPercent,
  SITE_PROMOTION_MAX_CAMPAIGN_DAYS,
} from "@/lib/sitePromotionPolicy";
import { buildPublicBillingReceipt } from "@/lib/publicBillingReceipt";
import type { Usage } from "@/lib/chatUsage";

const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const FX = 1530;

function seedCatalog(input: {
  currentIn: number;
  currentOut: number;
  referenceIn: number;
  referenceOut: number;
  discountPercent: number;
}): CheaperInferenceCatalogPricing {
  const catalog: CheaperInferenceCatalogPricing = {
    modelId: MODEL,
    inputUsdPerMillion: input.currentIn,
    cacheReadUsdPerMillion: input.currentIn * 0.25,
    cacheWriteUsdPerMillion: input.currentIn,
    outputUsdPerMillion: input.currentOut,
    referenceInputUsdPerMillion: input.referenceIn,
    referenceOutputUsdPerMillion: input.referenceOut,
    discountPercent: input.discountPercent,
    fetchedAt: Date.now(),
  };
  updateCheaperInferenceCatalogPricing(catalog);
  return catalog;
}

before(() => {
  installIsolatedTestDatabase();
  getDb();
});

describe("procurement vs site promotion separation", () => {
  it("A: CI reference=100 current=60 discountPercent=40 → procurement=60, no site promo, no user discount", () => {
    const catalog = seedCatalog({
      currentIn: 60,
      currentOut: 60,
      referenceIn: 100,
      referenceOut: 100,
      discountPercent: 40,
    });
    const procurement = resolveProcurementCostFromCatalog({
      modelId: MODEL,
      promptTokens: 1_000_000,
      outputTokens: 0,
      effectiveKrwPerUsd: FX,
      catalog,
    });
    assert.ok(procurement);
    assert.equal(procurement.inputUsdPerMillion, 60);
    assert.equal(procurement.referenceInputUsdPerMillion, 100);
    assert.equal(procurement.discountPercent, 40);
    assert.equal(procurement.procurementCostUsd, 60);

    const rates = resolveOpenRouterReasoningPointRates(MODEL, FX);
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 1.4);
    assert.notEqual(rates.inputUsdPerMillion, 60);

    const billing = computeOpenRouterTurnBilling({
      modelId: MODEL,
      inputTokens: 10_000,
      outputTokens: 2_000,
      apiPromptTokens: 10_000,
      apiCompletionTokens: 2_000,
      upstreamCostUsd: 0.05,
    });
    assert.equal(billing.sitePromotion, undefined);
    const withoutUpstream = computeOpenRouterTurnBilling({
      modelId: MODEL,
      inputTokens: 10_000,
      outputTokens: 2_000,
      apiPromptTokens: 10_000,
      apiCompletionTokens: 2_000,
    });
    assert.equal(billing.total, withoutUpstream.total);
  });

  it("B: CI current 60→55→63 changes procurement only, site promo inactive", () => {
    const baseBilling = computeOpenRouterTurnBilling({
      modelId: MODEL,
      inputTokens: 5_000,
      outputTokens: 1_000,
      apiPromptTokens: 5_000,
      apiCompletionTokens: 1_000,
    });
    for (const current of [60, 55, 63]) {
      seedCatalog({
        currentIn: current,
        currentOut: current,
        referenceIn: 100,
        referenceOut: 100,
        discountPercent: Math.round((1 - current / 100) * 100),
      });
      const procurement = resolveProcurementCostFromCatalog({
        modelId: MODEL,
        promptTokens: 1_000_000,
        outputTokens: 0,
        effectiveKrwPerUsd: FX,
      });
      assert.ok(procurement);
      assert.equal(procurement.procurementCostUsd, current);
      const billing = computeOpenRouterTurnBilling({
        modelId: MODEL,
        inputTokens: 5_000,
        outputTokens: 1_000,
        apiPromptTokens: 5_000,
        apiCompletionTokens: 1_000,
      });
      assert.equal(billing.total, baseBilling.total);
      assert.equal(billing.sitePromotion, undefined);
    }
  });

  it("C: official 50% → site policy 30%", () => {
    assert.equal(computeSiteDiscountPercent(50), 30);
  });

  it("D/E/F: site campaign max 7 days and survives redeploy", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const officialEnd = new Date("2026-10-01T00:00:00.000Z").toISOString();
    const promo = createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: new Date("2026-08-25T00:00:00.000Z").toISOString(),
      officialEnd,
      source: "admin",
      provenance: "manual verification",
      verifiedAt: now.toISOString(),
      episodeKey: "google:gemini-episode-1",
    });

    const day0 = resolveActiveSitePromotion(MODEL, now.toISOString());
    assert.ok(day0);
    assert.equal(day0.siteDiscountPercent, 30);
    const activatedAt = day0.activatedAt;

    const day4 = resolveActiveSitePromotion(
      MODEL,
      new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString()
    );
    assert.ok(day4);
    assert.equal(day4.activatedAt, activatedAt);
    assert.equal(day4.campaignId, day0.campaignId);

    const day8 = resolveActiveSitePromotion(
      MODEL,
      new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString()
    );
    assert.equal(day8, null);

    void promo;
    void SITE_PROMOTION_MAX_CAMPAIGN_DAYS;
  });

  it("F: official discount changes within same episode do not reset campaign timer", () => {
    const start = "2026-09-01T00:00:00.000Z";
    const promo = createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: start,
      officialEnd: "2026-10-01T00:00:00.000Z",
      episodeKey: "google:episode-stable",
      verifiedAt: start,
    });
    const first = resolveActiveSitePromotion(MODEL, "2026-09-02T00:00:00.000Z");
    assert.ok(first);

    updateOfficialProviderPromotionDiscount(promo.id, 40);
    const second = resolveActiveSitePromotion(MODEL, "2026-09-03T00:00:00.000Z");
    assert.ok(second);
    assert.equal(second.activatedAt, first!.activatedAt);
    assert.equal(second.siteDiscountPercent, 24);
  });

  it("G: billing snapshot preserves historical discount after promo ends", () => {
    const snapshot = {
      baseUserChargePoints: 100,
      siteDiscountPercent: 30,
      siteDiscountPoints: 30,
      finalChargePoints: 70,
      campaignId: 1,
      officialPromotionId: 1,
      episodeKey: "ep",
      provider: "google",
      source: "admin",
      provenance: "test",
      appliedAt: "2026-09-01T00:00:00.000Z",
    };
    const usage: Usage = {
      input: 100,
      output: 200,
      model: MODEL,
      route: "safe",
      cost: 70,
      savedOutputChars: 1200,
      apiInputTokens: 100,
      apiOutputTokens: 200,
      sitePromotion: snapshot,
      breakdown: [],
    };
    const receipt = buildPublicBillingReceipt(usage);
    assert.ok(receipt);
    assert.equal(receipt.siteDiscountPercent, 30);
    assert.equal(receipt.finalChargePoints, 70);
  });

  it("active official promo applies site discount once on base user charge", () => {
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: "2026-09-01T00:00:00.000Z",
      officialEnd: "2026-10-01T00:00:00.000Z",
      verifiedAt: "2026-09-01T00:00:00.000Z",
      episodeKey: "google:active-billing",
    });
    const billing = computeOpenRouterTurnBilling({
      modelId: MODEL,
      inputTokens: 10_000,
      outputTokens: 2_000,
      apiPromptTokens: 10_000,
      apiCompletionTokens: 2_000,
    });
    assert.ok(billing.sitePromotion);
    assert.equal(billing.sitePromotion!.siteDiscountPercent, 30);
    assert.ok(billing.total < billing.baseCost);
    assert.equal(billing.sitePromotion!.finalChargePoints, billing.total);
  });

  it("H: without site promotion user charge unchanged from base", () => {
    seedCatalog({
      currentIn: 0.5,
      currentOut: 2,
      referenceIn: 2,
      referenceOut: 12,
      discountPercent: 75,
    });
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 8_000,
      outputTokens: 1_500,
      apiPromptTokens: 8_000,
      apiCompletionTokens: 1_500,
    });
    assert.equal(billing.baseCost, billing.total);
    assert.equal(billing.sitePromotion, undefined);
  });
});
