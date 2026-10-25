/**
 * BUGFIX PRE-FLIGHT AUDIT — deterministic reproduction + candidate invariant proof.
 * READ-ONLY: does NOT change live billing. Documents expected cutover behavior.
 *
 * Product policy (SOURCE OF TRUTH):
 * - BASE_USER_CHARGE uses stable reference/list + published target margin
 * - CI current procurement affects PROCUREMENT_COST and ACTUAL_REALIZED_MARGIN only
 */

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { normalizeBillableUsage, type NormalizedBillableUsage } from "@/lib/billingUsage";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import {
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import {
  createOfficialProviderPromotion,
  updateOfficialProviderPromotionDiscount,
} from "@/lib/officialProviderPromotion";
import { resolveActiveSitePromotion } from "@/lib/sitePromotion";
import {
  SYNTHETIC_PROCUREMENT_SWING_FIXTURE,
} from "@/lib/billingPreflightModelPricingEvidence";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getDb } from "@/lib/db";

const FX = 1530;
const EFFECTIVE_FX = Math.round(FX * 1.02 * 1000) / 1000;

const FX_SNAPSHOT = {
  mode: "daily_kst" as const,
  dateKey: "2026-09-20",
  usdToKrw: FX,
  effectiveKrwPerUsd: EFFECTIVE_FX,
  source: "api_daily" as const,
  overseasFeeRate: 0.02,
  locked: true,
};

const REPRO_MODEL = SYNTHETIC_PROCUREMENT_SWING_FIXTURE.modelId;
const INPUT_TOKENS = SYNTHETIC_PROCUREMENT_SWING_FIXTURE.usage.promptTokens;
const OUTPUT_TOKENS = SYNTHETIC_PROCUREMENT_SWING_FIXTURE.usage.outputTokens;

function seedProcurementCatalog(
  modelId: string,
  currentIn: number,
  currentOut: number,
  referenceIn: number,
  referenceOut: number
): CheaperInferenceCatalogPricing {
  const discountPercent = Math.round((1 - currentIn / referenceIn) * 100);
  const catalog: CheaperInferenceCatalogPricing = {
    modelId,
    inputUsdPerMillion: currentIn,
    cacheReadUsdPerMillion: currentIn * 0.25,
    cacheWriteUsdPerMillion: currentIn,
    outputUsdPerMillion: currentOut,
    referenceInputUsdPerMillion: referenceIn,
    referenceOutputUsdPerMillion: referenceOut,
    discountPercent,
    fetchedAt: Date.now(),
  };
  updateCheaperInferenceCatalogPricing(catalog);
  return catalog;
}

function liveBaseCharge(modelId: string, upstreamCostUsd?: number): number {
  return computeOpenRouterTurnBilling({
    modelId,
    inputTokens: INPUT_TOKENS,
    outputTokens: OUTPUT_TOKENS,
    apiPromptTokens: INPUT_TOKENS,
    apiCompletionTokens: OUTPUT_TOKENS,
    upstreamCostUsd,
  }).baseCost;
}

function candidateBaseCharge(modelId: string, usage: NormalizedBillableUsage): number | null {
  const result = computePublishedUserChargeWithSnapshot({
    modelId,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX_SNAPSHOT,
    adjustment: { kind: "none" },
  });
  if (result.status !== "complete") return null;
  return result.snapshot.finalPoints;
}

function procurementCostUsd(
  modelId: string,
  catalog: CheaperInferenceCatalogPricing,
  promptTokens: number,
  outputTokens: number
): number {
  const snap = resolveProcurementCostFromCatalog({
    modelId,
    promptTokens,
    outputTokens,
    effectiveKrwPerUsd: FX,
    catalog,
  });
  assert.ok(snap);
  return snap.procurementCostUsd;
}

function realizedMargin(baseCharge: number, procurementUsd: number): number {
  const procurementKrw = procurementUsd * EFFECTIVE_FX;
  return 1 - procurementKrw / baseCharge;
}

function usageFromTokens(prompt: number, output: number): NormalizedBillableUsage {
  return normalizeBillableUsage({
    modelId: REPRO_MODEL,
    promptTokens: prompt,
    outputTokens: output,
    reasoningTokens: 0,
  });
}

before(() => {
  installIsolatedTestDatabase();
  getDb();
});

beforeEach(() => {
  clearCheaperInferenceCatalogPricingForTest();
});

describe("BUG REPRO: live owner couples procurement swing to BASE_USER_CHARGE", () => {
  it("SYNTHETIC_PROCUREMENT_SWING_FIXTURE: current 100→70→40 changes live BASE (bug symptom)", () => {
    const bases: number[] = [];
    for (const current of SYNTHETIC_PROCUREMENT_SWING_FIXTURE.currentLevels) {
      seedProcurementCatalog(
        REPRO_MODEL,
        current,
        current,
        SYNTHETIC_PROCUREMENT_SWING_FIXTURE.referenceIn,
        SYNTHETIC_PROCUREMENT_SWING_FIXTURE.referenceOut
      );
      bases.push(liveBaseCharge(REPRO_MODEL));
    }
    assert.notEqual(bases[0], bases[1]);
    assert.notEqual(bases[1], bases[2]);
    assert.ok(bases[0] > bases[1]);
    assert.ok(bases[1] > bases[2]);
  });
});

describe("CANDIDATE INVARIANT: stable reference BASE + procurement margin swing", () => {
  it("BASE_USER_CHARGE stable; PROCUREMENT_COST and ACTUAL_REALIZED_MARGIN vary", () => {
    const usage = usageFromTokens(INPUT_TOKENS, OUTPUT_TOKENS);
    const published = getPublishedPricing(REPRO_MODEL);
    const referenceBase = candidateBaseCharge(REPRO_MODEL, usage);
    assert.ok(referenceBase != null && referenceBase > 0);

    const procurementCosts: number[] = [];
    const margins: number[] = [];

    for (const current of SYNTHETIC_PROCUREMENT_SWING_FIXTURE.currentLevels) {
      const catalog = seedProcurementCatalog(
        REPRO_MODEL,
        current,
        current,
        SYNTHETIC_PROCUREMENT_SWING_FIXTURE.referenceIn,
        SYNTHETIC_PROCUREMENT_SWING_FIXTURE.referenceOut
      );
      const candidateBase = candidateBaseCharge(REPRO_MODEL, usage);
      assert.equal(candidateBase, referenceBase, `BASE must not move at current=${current}`);

      const procUsd = procurementCostUsd(REPRO_MODEL, catalog, INPUT_TOKENS, OUTPUT_TOKENS);
      procurementCosts.push(procUsd);
      margins.push(realizedMargin(referenceBase, procUsd));
    }

    assert.ok(procurementCosts[0] > procurementCosts[1]);
    assert.ok(procurementCosts[1] > procurementCosts[2]);
    assert.ok(margins[0] < margins[1]);
    assert.ok(margins[1] < margins[2]);

    void published;
  });
});

describe("UPSTREAM COST INVARIANT: upstreamCostUsd must not move BASE (candidate)", () => {
  it("live owner couples upstreamCostUsd to BASE (bug)", () => {
    seedProcurementCatalog(REPRO_MODEL, 1.4, 8.4, 2, 12);
    const withoutUpstream = liveBaseCharge(REPRO_MODEL);
    const withUpstream = liveBaseCharge(REPRO_MODEL, 0.05);
    assert.notEqual(withoutUpstream, withUpstream);
  });

  it("candidate stable-reference BASE ignores upstreamCostUsd", () => {
    seedProcurementCatalog(REPRO_MODEL, 1.4, 8.4, 2, 12);
    const usage = usageFromTokens(INPUT_TOKENS, OUTPUT_TOKENS);
    const base = candidateBaseCharge(REPRO_MODEL, usage);
    assert.ok(base != null);
    assert.equal(base, candidateBaseCharge(REPRO_MODEL, usage));
  });
});

describe("OFFICIAL PROMOTION PRESERVATION (owners untouched)", () => {
  it("CI current/discountPercent change does not alter site promotion state", () => {
    getDb().exec("DELETE FROM site_promotion_campaigns");
    getDb().exec("DELETE FROM official_provider_promotions");

    const promoStart = "2026-09-01T00:00:00.000Z";
    const promoEnd = "2026-10-01T00:00:00.000Z";
    createOfficialProviderPromotion({
      provider: "google",
      modelId: REPRO_MODEL,
      officialDiscountPct: 50,
      officialStart: promoStart,
      officialEnd: promoEnd,
      verifiedAt: promoStart,
      episodeKey: "preflight:promo-stable",
    });

    seedProcurementCatalog(REPRO_MODEL, 100, 100, 100, 100);
    const first = resolveActiveSitePromotion(REPRO_MODEL, "2026-09-02T00:00:00.000Z");
    assert.ok(first);

    seedProcurementCatalog(REPRO_MODEL, 40, 40, 100, 100);
    const second = resolveActiveSitePromotion(REPRO_MODEL, "2026-09-03T00:00:00.000Z");
    assert.ok(second);
    assert.equal(second!.activatedAt, first!.activatedAt);
    assert.equal(second!.siteDiscountPercent, first!.siteDiscountPercent);

    updateOfficialProviderPromotionDiscount(first!.officialPromotionId, 40);
    const third = resolveActiveSitePromotion(REPRO_MODEL, "2026-09-04T00:00:00.000Z");
    assert.ok(third);
    assert.equal(third!.activatedAt, first!.activatedAt);
    assert.equal(third!.siteDiscountPercent, 20);
  });

  it("site promotion applies once: FINAL = BASE or FINAL < BASE", () => {
    seedProcurementCatalog(REPRO_MODEL, 1.4, 8.4, 2, 12);
    const off = computeOpenRouterTurnBilling({
      modelId: REPRO_MODEL,
      inputTokens: 5_000,
      outputTokens: 1_000,
      apiPromptTokens: 5_000,
      apiCompletionTokens: 1_000,
    });
    assert.equal(off.sitePromotion, undefined);
    assert.equal(off.total, off.baseCost);

    getDb().exec("DELETE FROM site_promotion_campaigns");
    getDb().exec("DELETE FROM official_provider_promotions");
    const start = new Date(Date.now() - 86_400_000).toISOString();
    const end = new Date(Date.now() + 30 * 86_400_000).toISOString();
    createOfficialProviderPromotion({
      provider: "google",
      modelId: REPRO_MODEL,
      officialDiscountPct: 50,
      officialStart: start,
      officialEnd: end,
      verifiedAt: start,
      episodeKey: "preflight:billing-layer",
    });

    const on = computeOpenRouterTurnBilling({
      modelId: REPRO_MODEL,
      inputTokens: 5_000,
      outputTokens: 1_000,
      apiPromptTokens: 5_000,
      apiCompletionTokens: 1_000,
    });
    assert.ok(on.sitePromotion);
    assert.ok(on.total < on.baseCost);
    assert.equal(on.sitePromotion!.finalChargePoints, on.total);
  });
});

describe("MAIN RP MODELS: candidate eligibility smoke (no silent fallback)", () => {
  const normalUsage = (modelId: string): NormalizedBillableUsage =>
    normalizeBillableUsage({
      modelId,
      promptTokens: 15_000,
      outputTokens: 2_000,
      reasoningTokens: 0,
    });

  it("gemini-3.1-pro-preview: complete without cache", () => {
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      usage: normalUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      usageCoverage: "complete",
      fxSnapshot: FX_SNAPSHOT,
      adjustment: { kind: "none" },
    });
    assert.equal(result.status, "complete");
  });

  it("gemini-3.7-flash: complete without cache", () => {
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage: normalUsage(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      usageCoverage: "complete",
      fxSnapshot: FX_SNAPSHOT,
      adjustment: { kind: "none" },
    });
    assert.equal(result.status, "complete");
  });

  it("gpt-5.6-terra: complete without cache", () => {
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      usage: normalUsage(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      usageCoverage: "complete",
      fxSnapshot: FX_SNAPSHOT,
      adjustment: { kind: "none" },
    });
    assert.equal(result.status, "complete");
  });

  it("deepseek-v4-pro-0813: complete without cache", () => {
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      usage: normalUsage(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      usageCoverage: "complete",
      fxSnapshot: FX_SNAPSHOT,
      adjustment: { kind: "none" },
    });
    assert.equal(result.status, "complete");
  });

  it("gemini-3.7 with cache: blocked (cache semantics unknown — no silent fallback)", () => {
    const usage = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: 26_038,
      outputTokens: 2_662,
      cacheReadTokens: 20_426,
      reasoningTokens: 0,
    });
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_SNAPSHOT,
      adjustment: { kind: "none" },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unsupported_cache_semantics");
  });
});
