import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  buildOpus55CrackPerceivedReference,
  buildOpus55RealizedProcurementMarginCandidateMatrix,
  buildOpus55ReferenceProductMarginMatrix,
  computeOpus55PrepProductCharge,
} from "@/lib/claudeOpus55PricingPrep";
import {
  OPUS55_PRODUCT_TARGET_MARGIN_SEMANTICS,
  OPUS55_REALIZED_PROCUREMENT_MARGIN_SEMANTICS,
} from "@/lib/opus55PricingEvidence";
import { computeOpus55RealizedProcurementMarginCandidate } from "@/lib/opus55RealizedProcurementMargin";
import { ceilPublishedChargePoints, roundKrwTenths } from "@/lib/publishedChargeRounding";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-22",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

describe("Opus 5.5 margin semantics separation", () => {
  it("documents PRODUCT targetMargin vs realized procurement margin meanings", () => {
    assert.match(OPUS55_PRODUCT_TARGET_MARGIN_SEMANTICS.formula, /billingReferenceCostUsd/);
    assert.match(OPUS55_REALIZED_PROCUREMENT_MARGIN_SEMANTICS.formula, /ciNoCacheProcurementKrw/);
  });

  it("35% PRODUCT targetMargin ≠ 35% CI procurement gross margin on ELIN workload", () => {
    const product = computeOpus55PrepProductCharge({
      promptTokens: 73_763,
      outputTokens: 5_334,
      targetMargin: 0.35,
      fxSnapshot: FX,
    });
    assert.equal(product.status, "complete");
    const realized = computeOpus55RealizedProcurementMarginCandidate({
      promptTokens: 73_763,
      outputTokens: 5_334,
      targetRealizedGrossMargin: 0.35,
      fxSnapshot: FX,
    });
    assert.ok(realized);
    assert.notEqual(product.snapshot.finalPoints, realized.finalPoints);
    const impliedProcMargin =
      (product.snapshot.finalUserChargeKrw - realized.ciNoCacheProcurementKrw) /
      product.snapshot.finalUserChargeKrw;
    assert.ok(Math.abs(impliedProcMargin - 0.35) > 0.05);
  });

  it("uses canonical published rounding for realized procurement inverse", () => {
    const row = computeOpus55RealizedProcurementMarginCandidate({
      promptTokens: 73_763,
      outputTokens: 5_334,
      targetRealizedGrossMargin: 0.35,
      fxSnapshot: FX,
    });
    assert.ok(row);
    const expectedKrw = roundKrwTenths(row.ciNoCacheProcurementKrw / (1 - 0.35));
    assert.equal(row.finalUserChargeKrw, expectedKrw);
    assert.equal(row.finalPoints, ceilPublishedChargePoints(expectedKrw));
    assert.ok(row.actualRealizedGrossMargin >= 0.35 - 0.02);
  });
});

describe("REALIZED_PROCUREMENT_MARGIN_CANDIDATES matrix", () => {
  it("covers ELIN and T-POT at 30/35/40%", () => {
    const matrix = buildOpus55RealizedProcurementMarginCandidateMatrix({ fxSnapshot: FX });
    assert.equal(matrix.length, 6);
    for (const margin of [0.3, 0.35, 0.4]) {
      assert.ok(matrix.some((r) => r.promptTokens === 73_763 && r.targetRealizedGrossMargin === margin));
      assert.ok(matrix.some((r) => r.promptTokens === 58_654 && r.targetRealizedGrossMargin === margin));
    }
  });

  it("REFERENCE_PRODUCT_MARGIN_MATRIX is explicitly labeled", () => {
    const ref = buildOpus55ReferenceProductMarginMatrix({ fxSnapshot: FX, targetMargins: [0.35] });
    assert.equal(ref[0]?.matrixKind, "REFERENCE_PRODUCT_MARGIN_MATRIX");
  });

  it("CRACK perceived reference is separate from exact token workloads", () => {
    const crack = buildOpus55CrackPerceivedReference({ fxSnapshot: FX });
    assert.equal(crack.matrixKind, "MARKET_PERCEIVED_REFERENCE");
    assert.equal(crack.crackObservedPoints, 523);
    assert.equal(crack.realizedProcurementCandidates.length, 3);
  });
});
