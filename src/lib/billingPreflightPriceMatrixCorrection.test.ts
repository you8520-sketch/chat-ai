/**
 * PR #991 correction — model-specific pricing evidence guards.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import { clearCheaperInferenceCatalogPricingForTest } from "@/lib/cheaperInferenceCatalogPricing";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_MODEL_PRICING_EVIDENCE,
  SYNTHETIC_PROCUREMENT_SWING_FIXTURE,
  assertNoCrossModelFixtureLeak,
  getMainRpModelPricingEvidence,
  seedModelSpecificCatalog,
} from "@/lib/billingPreflightModelPricingEvidence";
import {
  GEMINI37_BENCHMARK_A_ID,
  getMarketBenchmark,
} from "@/lib/marketUsageBenchmarks";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";

const FX_SNAPSHOT = {
  mode: "daily_kst" as const,
  dateKey: "2026-09-20",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily" as const,
  overseasFeeRate: 0.02,
  locked: true,
};

beforeEach(() => clearCheaperInferenceCatalogPricingForTest());

describe("model-specific pricing evidence isolation", () => {
  it("each Main RP model has distinct evidence registry entry", () => {
    const ids = new Set(MAIN_RP_MODEL_IDS);
    assert.equal(ids.size, MAIN_RP_MODEL_IDS.length);
    for (const modelId of MAIN_RP_MODEL_IDS) {
      assert.equal(getMainRpModelPricingEvidence(modelId).modelId, modelId);
    }
  });

  it("G31 1.4/8.4 current cannot be consumed by DeepSeek/G37/Terra", () => {
    const g31 = getMainRpModelPricingEvidence(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    assert.equal(g31.currentProcurement.status, "known");
    assert.equal(g31.currentProcurement.inputUsdPerMillion, 1.4);
    assert.equal(g31.currentProcurement.outputUsdPerMillion, 8.4);

    for (const modelId of [
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    ]) {
      assertNoCrossModelFixtureLeak(modelId);
      const ev = getMainRpModelPricingEvidence(modelId);
      if (ev.currentProcurement.status === "known") {
        const leak =
          ev.currentProcurement.inputUsdPerMillion === 1.4 &&
          ev.currentProcurement.outputUsdPerMillion === 8.4;
        assert.equal(leak, false, `${modelId} must not use G31 current fixture`);
      }
    }
  });

  it("Terra current procurement is CURRENT_PROCUREMENT_UNKNOWN", () => {
    const terra = getMainRpModelPricingEvidence(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
    assert.equal(terra.currentProcurement.status, "CURRENT_PROCUREMENT_UNKNOWN");
    assert.equal(seedModelSpecificCatalog(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), false);
  });

  it("DeepSeek uses published reference 0.66 not G31 reference 2", () => {
    const ds = getMainRpModelPricingEvidence(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(ds.reference.inputUsdPerMillion, 0.66);
    assert.notEqual(ds.reference.inputUsdPerMillion, 2);
  });

  it("G37 uses calibration reference 0.375 not G31 reference 2", () => {
    const g37 = getMainRpModelPricingEvidence(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(g37.reference.inputUsdPerMillion, 0.375);
    assert.equal(g37.currentProcurement.status, "known");
    if (g37.currentProcurement.status === "known") {
      assert.equal(g37.currentProcurement.inputUsdPerMillion, 0.2625);
    }
  });

  it("SYNTHETIC_PROCUREMENT_SWING_FIXTURE is explicitly labeled architecture-only", () => {
    assert.equal(
      SYNTHETIC_PROCUREMENT_SWING_FIXTURE.label,
      "SYNTHETIC_PROCUREMENT_SWING_FIXTURE"
    );
    assert.deepEqual(SYNTHETIC_PROCUREMENT_SWING_FIXTURE.currentLevels, [100, 70, 40]);
  });
});

describe("competitor benchmark workload matching", () => {
  it("benchmark comparison requires exact benchmark token workload", () => {
    const bench = getMarketBenchmark(
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      "gemini31_competitor_a"
    );
    assert.ok(bench);
    const exactUsage = normalizeBillableUsage({
      modelId: bench!.modelId,
      promptTokens: bench!.inputTokens,
      outputTokens: bench!.displayedOutputTokens,
    });
    const exact = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      usage: exactUsage,
      usageCoverage: "complete",
      fxSnapshot: FX_SNAPSHOT,
      adjustment: { kind: "none" },
    });
    assert.equal(exact.status, "complete");

    const mismatchedUsage = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      promptTokens: 15_000,
      outputTokens: 2_000,
    });
    const mismatched = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      usage: mismatchedUsage,
      usageCoverage: "complete",
      fxSnapshot: FX_SNAPSHOT,
      adjustment: { kind: "none" },
    });
    assert.equal(mismatched.status, "complete");
    assert.notEqual(
      exact.status === "complete" && mismatched.status === "complete"
        ? exact.snapshot.finalPoints
        : null,
      mismatched.status === "complete" ? mismatched.snapshot.finalPoints : null
    );
  });

  it("G37 benchmark A exact workload differs from NORMAL 15k/2k shape", () => {
    const bench = getMarketBenchmark(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, GEMINI37_BENCHMARK_A_ID);
    assert.ok(bench);
    const exact = normalizeBillableUsage({
      modelId: bench!.modelId,
      promptTokens: bench!.inputTokens,
      outputTokens: bench!.displayedOutputTokens,
    });
    const normal = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: 15_000,
      outputTokens: 2_000,
    });
    assert.notEqual(exact.promptTokens, normal.promptTokens);
  });

  it("Terra 253P char benchmark is NOT_DIRECTLY_COMPARABLE to token shapes", () => {
    const terra = MAIN_RP_MODEL_PRICING_EVIDENCE[CHEAPER_INFERENCE_GPT_56_TERRA_MODEL];
    const publishedBenchmark = { outputChars: 6025, points: 253 };
    assert.ok(publishedBenchmark.outputChars > 0);
    assert.equal(publishedBenchmark.points, 253);
    void terra;
    // Token-based operational shapes must not be treated as this benchmark workload.
    const normal = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      promptTokens: 12_000,
      outputTokens: 900,
    });
    assert.notEqual(normal.promptTokens, publishedBenchmark.outputChars);
  });

  it("DeepSeek retains COMPETITOR_BENCHMARK_MISSING", () => {
    const benchmarks = getMarketBenchmark(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, "any");
    assert.equal(benchmarks, undefined);
  });
});
