import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  buildMainRpPricingObservabilityProjection,
  listMainRpObservabilityModelIds,
} from "@/lib/mainRpPricingObservability";
import { REPRESENTATIVE_TRACKER_WORKLOAD } from "@/lib/modelPricingTracker";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { computeOpenRouterTurnBilling } from "@/lib/pointsReasoningMargins";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";

const FX_FIXTURE: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-22",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const MAIN_RP_SET = new Set<string>(MAIN_RP_MODEL_IDS);

function seedCatalog(
  modelId: string,
  input: Partial<CheaperInferenceCatalogPricing> & {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
  }
): void {
  updateCheaperInferenceCatalogPricing({
    modelId,
    inputUsdPerMillion: input.inputUsdPerMillion,
    outputUsdPerMillion: input.outputUsdPerMillion,
    cacheReadUsdPerMillion: input.cacheReadUsdPerMillion ?? input.inputUsdPerMillion * 0.1,
    cacheWriteUsdPerMillion: input.cacheWriteUsdPerMillion ?? input.inputUsdPerMillion,
    referenceInputUsdPerMillion: input.referenceInputUsdPerMillion,
    referenceOutputUsdPerMillion: input.referenceOutputUsdPerMillion,
    discountPercent: input.discountPercent,
    fetchedAt: input.fetchedAt ?? Date.now(),
  });
}

function seedMainRpCatalogs(): void {
  clearCheaperInferenceCatalogPricingForTest();
  const fetchedAt = Date.parse("2026-09-22T03:00:00.000Z");
  seedCatalog(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, {
    inputUsdPerMillion: 0.66,
    outputUsdPerMillion: 1.98,
    referenceInputUsdPerMillion: 1.32,
    referenceOutputUsdPerMillion: 3.96,
    discountPercent: 50,
    fetchedAt,
  });
  seedCatalog(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, {
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    referenceInputUsdPerMillion: 0.3,
    referenceOutputUsdPerMillion: 1.2,
    discountPercent: 50,
    fetchedAt,
  });
  seedCatalog(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, {
    inputUsdPerMillion: 1.4,
    outputUsdPerMillion: 8.4,
    referenceInputUsdPerMillion: 2,
    referenceOutputUsdPerMillion: 12,
    discountPercent: 30,
    fetchedAt,
  });
  seedCatalog(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, {
    inputUsdPerMillion: 0.2625,
    outputUsdPerMillion: 1.3125,
    referenceInputUsdPerMillion: 0.375,
    referenceOutputUsdPerMillion: 1.875,
    discountPercent: 30,
    fetchedAt,
  });
  seedCatalog(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, {
    inputUsdPerMillion: 1.4,
    outputUsdPerMillion: 8.4,
    referenceInputUsdPerMillion: 2,
    referenceOutputUsdPerMillion: 12,
    discountPercent: 30,
    fetchedAt,
  });
}

describe("mainRpPricingObservability", () => {
  it("covers all five Main RP models with separated semantic domains", () => {
    seedMainRpCatalogs();
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: new Date("2026-09-22T12:00:00.000Z"),
    });
    assert.equal(listMainRpObservabilityModelIds().length, 5);
    assert.equal(projection.models.length, 5);
    for (const row of projection.models) {
      assert.ok(MAIN_RP_SET.has(row.modelId));
      assert.equal(row.market.domain, "MARKET");
      assert.equal(row.provider.domain, "PROVIDER");
      assert.equal(row.procurement.domain, "PROCUREMENT");
      assert.equal(row.product.domain, "PRODUCT");
      assert.equal(row.promotion.domain, "PROMOTION");
      assert.equal(row.margin.domain, "MARGIN");
      assert.ok(row.product.publishedInputUsdPerMillion > 0);
      assert.ok(row.product.publishedOutputUsdPerMillion > 0);
    }
  });

  it("user charge parity — projection reads do not alter billing owners", () => {
    seedMainRpCatalogs();
    const usage = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
      outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    });
    const publishedBefore = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_FIXTURE,
      adjustment: { kind: "none" },
    });
    const legacyBefore = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
      outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
      apiPromptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
      apiCompletionTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    }).total;

    buildMainRpPricingObservabilityProjection({ fxSnapshot: FX_FIXTURE });

    const publishedAfter = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_FIXTURE,
      adjustment: { kind: "none" },
    });
    const legacyAfter = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
      outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
      apiPromptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
      apiCompletionTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    }).total;

    assert.deepEqual(publishedAfter, publishedBefore);
    assert.equal(legacyAfter, legacyBefore);
    assert.deepEqual(getPublishedPricing(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL), getPublishedPricing(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL));
  });

  it("Gemini 3.7 includes margin-floor root-cause investigation report", () => {
    seedMainRpCatalogs();
    const projection = buildMainRpPricingObservabilityProjection({ fxSnapshot: FX_FIXTURE });
    const g37 = projection.models.find((row) => row.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.ok(g37?.gemini37RootCause);
    assert.equal(typeof g37.gemini37RootCause.observedMarginFloorBreach, "boolean");
    assert.ok(Array.isArray(g37.gemini37RootCause.plausibleHypotheses));
  });

  it("procurement provenance is labeled separately from product BASE rates", () => {
    seedMainRpCatalogs();
    const projection = buildMainRpPricingObservabilityProjection({ fxSnapshot: FX_FIXTURE });
    for (const row of projection.models) {
      assert.equal(row.procurement.provenance, "CI_CURRENT_ESTIMATE");
      assert.ok(row.product.publishedInputUsdPerMillion > 0);
      assert.notEqual(row.margin.realizedMarginProvenance, "UNKNOWN");
    }
  });
});
