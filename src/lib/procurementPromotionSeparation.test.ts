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
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const FX = 1530;
const MARGIN = 0.5;

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

function expectedBaseChargeFromCurrentRates(
  inputTokens: number,
  outputTokens: number,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number
): number {
  const rawUsd =
    (inputTokens * inputUsdPerMillion + outputTokens * outputUsdPerMillion) / 1_000_000;
  const rawKrw = rawUsd * FX;
  return Math.ceil(rawKrw / (1 - MARGIN) - 1e-9);
}

before(() => {
  installIsolatedTestDatabase();
  getDb();
});

describe("procurement vs site promotion separation", () => {
  it("A: CI reference=100 current=60 discountPercent=40 → procurement=60, user base follows margin, no site promo", () => {
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
    assert.equal(rates.inputUsdPerMillion, 60);
    assert.equal(rates.outputUsdPerMillion, 60);

    const billing = computeOpenRouterTurnBilling({
      modelId: MODEL,
      inputTokens: 10_000,
      outputTokens: 2_000,
      apiPromptTokens: 10_000,
      apiCompletionTokens: 2_000,
    });
    assert.equal(billing.sitePromotion, undefined);
    const expected = expectedBaseChargeFromCurrentRates(10_000, 2_000, 60, 60);
    assert.equal(billing.baseCost, expected);
    assert.equal(billing.total, expected);

    const receipt = buildPublicBillingReceipt({
      input: 10_000,
      output: 2_000,
      model: MODEL,
      route: "safe",
      cost: billing.total,
      savedOutputChars: 1000,
      breakdown: [],
    });
    assert.ok(receipt);
    assert.equal(receipt.siteDiscountPercent, null);
  });

  it("B: CI current 60→55→63 changes normal user base charge; site promo stays inactive", () => {
    const totals: number[] = [];
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
      totals.push(billing.total);
      assert.equal(billing.sitePromotion, undefined);
      assert.equal(
        billing.baseCost,
        expectedBaseChargeFromCurrentRates(5_000, 1_000, current, current)
      );
    }
    assert.notEqual(totals[0], totals[1]);
    assert.notEqual(totals[1], totals[2]);
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
    assert.equal(second.siteDiscountPercent, 20);
  });

  it("future officialStart delays campaign activation until promo window opens", () => {
    getDb().exec("DELETE FROM site_promotion_campaigns");
    getDb().exec("DELETE FROM official_provider_promotions");
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: "2026-10-01T00:00:00.000Z",
      officialEnd: "2026-11-01T00:00:00.000Z",
      verifiedAt: "2026-09-20T00:00:00.000Z",
      episodeKey: "google:future-start",
    });
    const beforeStart = resolveActiveSitePromotion(MODEL, "2026-09-25T00:00:00.000Z");
    assert.equal(beforeStart, null);
    const atStart = resolveActiveSitePromotion(MODEL, "2026-10-02T00:00:00.000Z");
    assert.ok(atStart);
    assert.equal(atStart!.activatedAt, "2026-10-01T00:00:00.000Z");
    assert.equal(atStart!.endsAt, "2026-10-08T00:00:00.000Z");
  });

  it("late verification uses verifiedAt when after officialStart", () => {
    getDb().exec("DELETE FROM site_promotion_campaigns");
    getDb().exec("DELETE FROM official_provider_promotions");
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: "2026-09-01T00:00:00.000Z",
      officialEnd: "2026-10-01T00:00:00.000Z",
      verifiedAt: "2026-09-20T00:00:00.000Z",
      episodeKey: "google:late-verify",
    });
    const promo = resolveActiveSitePromotion(MODEL, "2026-09-21T00:00:00.000Z");
    assert.ok(promo);
    assert.equal(promo!.activatedAt, "2026-09-20T00:00:00.000Z");
  });

  it("campaign activation T0 / first billing T+2 keeps timer based on T0", () => {
    const t0 = "2026-09-01T00:00:00.000Z";
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: t0,
      officialEnd: "2026-10-01T00:00:00.000Z",
      verifiedAt: t0,
      episodeKey: "google:timer-t0",
    });
    const t2 = "2026-09-03T00:00:00.000Z";
    const promoAtBilling = resolveActiveSitePromotion(MODEL, t2);
    assert.ok(promoAtBilling);
    assert.equal(promoAtBilling.activatedAt, t0);
    const ageMs = Date.parse(t2) - Date.parse(promoAtBilling.activatedAt);
    assert.equal(Math.round(ageMs / (24 * 60 * 60 * 1000)), 2);
  });

  it("explicit verified official promo 50% → normal base then site 30%", () => {
    seedCatalog({
      currentIn: 1.4,
      currentOut: 8.4,
      referenceIn: 2,
      referenceOut: 12,
      discountPercent: 30,
    });
    const promoStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const promoEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: promoStart,
      officialEnd: promoEnd,
      verifiedAt: promoStart,
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

  it("model-specific promo: Gemini eligible, DeepSeek/Claude not", () => {
    const promoStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const promoEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: promoStart,
      officialEnd: promoEnd,
      verifiedAt: promoStart,
      episodeKey: "google:scope-gemini",
    });
    assert.ok(resolveActiveSitePromotion(MODEL));
    assert.equal(resolveActiveSitePromotion(DEEPSEEK), null);
    assert.equal(resolveActiveSitePromotion("anthropic/claude-opus-4"), null);
  });

  it("unverified promo does not change charge", () => {
    const db = getDb();
    db.exec("DELETE FROM site_promotion_campaigns");
    db.exec("DELETE FROM official_provider_promotions");
    db.prepare(
      `INSERT INTO official_provider_promotions
         (provider, model_id, official_discount_pct, official_start, official_end, status, episode_key)
       VALUES ('google', ?, 50, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'active', 'unverified-only')`
    ).run(MODEL);
    assert.equal(resolveActiveSitePromotion(MODEL), null);
    const billing = computeOpenRouterTurnBilling({
      modelId: MODEL,
      inputTokens: 5_000,
      outputTokens: 1_000,
      apiPromptTokens: 5_000,
      apiCompletionTokens: 1_000,
    });
    assert.equal(billing.sitePromotion, undefined);
    assert.equal(billing.baseCost, billing.total);
  });

  it("H: CI discountPercent 70% does not create user site promo row", () => {
    seedCatalog({
      currentIn: 0.5,
      currentOut: 2,
      referenceIn: 2,
      referenceOut: 12,
      discountPercent: 75,
    });
    const billing = computeOpenRouterTurnBilling({
      modelId: DEEPSEEK,
      inputTokens: 8_000,
      outputTokens: 1_500,
      apiPromptTokens: 8_000,
      apiCompletionTokens: 1_500,
    });
    assert.equal(billing.sitePromotion, undefined);
    assert.equal(billing.baseCost, billing.total);
  });
});
