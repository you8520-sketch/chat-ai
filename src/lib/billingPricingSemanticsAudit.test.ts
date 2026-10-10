import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDeepSeekMatrix,
  buildG37ThreeBasisMatrix,
  buildPromotionDoubleApplicationCases,
  ciListMatchesGoogleStandard,
  publishedG37MatchesFlexBatch,
  SEMANTICS_AUDIT_FX,
} from "@/lib/billingPricingSemanticsAudit";
import { GEMINI37_BENCHMARK_A_ID, GEMINI37_BENCHMARK_B_ID } from "@/lib/marketUsageBenchmarks";
import { computeSiteDiscountPercent } from "@/lib/sitePromotionPolicy";

describe("billing pricing semantics audit", () => {
  it("published G37 reference matches Flex/Batch intro rates not Standard", () => {
    assert.equal(publishedG37MatchesFlexBatch(), true);
    assert.equal(ciListMatchesGoogleStandard(), true);
  });

  it("G37 basis A Standard intro yields 2× reference raw KRW vs basis C Flex", () => {
    const rows = buildG37ThreeBasisMatrix();
    const a = rows.find(
      (r) => r.basisId === "A_STANDARD_INTRO" && r.benchmarkId === GEMINI37_BENCHMARK_A_ID
    )!;
    const c = rows.find(
      (r) => r.basisId === "C_FLEX_BATCH_INTRO" && r.benchmarkId === GEMINI37_BENCHMARK_A_ID
    )!;
    assert.ok(a.referenceRawKrw > c.referenceRawKrw);
    assert.equal(Math.round(a.referenceRawKrw / c.referenceRawKrw), 2);
    assert.equal(c.ourBaseP, 48);
    assert.equal(c.competitorP, 55);
    assert.ok(Math.abs(c.ciProcurementRealizedMargin - 0.692) < 0.02);
  });

  it("G37 basis B post-intro doubles basis A on benchmark B", () => {
    const rows = buildG37ThreeBasisMatrix();
    const a = rows.find(
      (r) => r.basisId === "A_STANDARD_INTRO" && r.benchmarkId === GEMINI37_BENCHMARK_B_ID
    )!;
    const b = rows.find(
      (r) => r.basisId === "B_STANDARD_POST_INTRO" && r.benchmarkId === GEMINI37_BENCHMARK_B_ID
    )!;
    assert.equal(Math.round(b.referenceRawKrw / a.referenceRawKrw), 2);
    assert.equal(b.ourBaseP, 320);
    assert.equal(a.ourBaseP, 160);
  });

  it("promotion double-application cases A/B/C are deterministic", () => {
    const cases = buildPromotionDoubleApplicationCases();
    assert.equal(cases.length, 3);
    const caseA = cases.find((c) => c.caseId === "A")!;
    const caseB = cases.find((c) => c.caseId === "B")!;
    const caseC = cases.find((c) => c.caseId === "C")!;
    assert.equal(caseA.doubleDiscountRisk, true);
    assert.equal(caseB.doubleDiscountRisk, false);
    assert.equal(caseC.doubleDiscountRisk, false);
    assert.equal(caseC.finalUserChargePoints, caseC.baseUserChargePoints);
    const sitePct = computeSiteDiscountPercent(50);
    assert.equal(caseB.finalUserChargePoints, 70);
    assert.equal(sitePct, 30);
  });

  it("DeepSeek V4 Pro published reference aligns with official off-peak not peak", () => {
    const rows = buildDeepSeekMatrix().filter(
      (r) => r.modelFamily === "V4_PRO" && r.shape === "NORMAL"
    );
    const offPeak = rows.find((r) => r.tier === "OFF_PEAK")!;
    const peak = rows.find((r) => r.tier === "PEAK")!;
    const published = rows.find((r) => r.tier === "PUBLISHED_REFERENCE")!;
    assert.equal(offPeak.referenceRawKrw, published.referenceRawKrw);
    assert.ok(peak.referenceRawKrw > offPeak.referenceRawKrw);
  });

  it("DeepSeek matrix keeps V4 Pro and V4.1 Flash separate", () => {
    const rows = buildDeepSeekMatrix();
    const pro = rows.filter((r) => r.modelFamily === "V4_PRO" && r.shape === "NORMAL");
    const flash = rows.filter((r) => r.modelFamily === "V4_1_FLASH" && r.shape === "NORMAL");
    assert.ok(pro.length >= 4);
    assert.ok(flash.length >= 2);
    const flashOffPeak = flash.find((r) => r.tier === "OFF_PEAK")!;
    const proOffPeak = pro.find((r) => r.tier === "OFF_PEAK")!;
    assert.ok(flashOffPeak.referenceRawKrw < proOffPeak.referenceRawKrw);
  });

  it("uses locked FX fixture for reproducibility", () => {
    assert.equal(SEMANTICS_AUDIT_FX.effectiveKrwPerUsd, 1560.6);
  });
});
