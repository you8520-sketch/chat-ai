import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCompetitiveFxCeiling,
  evaluatePremiumPricingGates,
  GEMINI31_V1_PUBLISHED,
  GEMINI31_V2_PROPOSED,
  OPUS5_V1_PUBLISHED,
  OPUS5_V2_PROPOSED,
  PREMIUM_MARGIN_CANDIDATES,
  selectPremiumTargetMargin,
  simulatePremiumPricingPolicy,
} from "./premiumPricingCalibration";
import {
  _setOpaqueMarketReferencesForTest,
  getOpaqueMarketReferences,
  OPAQUE_MARKET_REFERENCES,
} from "./opaqueMarketReferences";
import { requirePrimaryBenchmark } from "./marketUsageBenchmarks";

describe("premiumPricingCalibration", () => {
  it("v1 diagnostics fail hard comparable @1530", () => {
    const g31 = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V1_PUBLISHED,
      targetMargin: GEMINI31_V1_PUBLISHED.targetMargin,
      baseFx: 1530,
    });
    const o5 = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V1_PUBLISHED,
      targetMargin: OPUS5_V1_PUBLISHED.targetMargin,
      baseFx: 1530,
    });
    assert.equal(g31.finalPoints, 260);
    assert.equal(g31.strictMarketPass, false);
    assert.equal(o5.finalPoints, 852);
    assert.equal(o5.strictMarketPass, false);
  });

  it("v2 deterministic fixtures @1530/1600/1625", () => {
    const g1530 = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.09,
      baseFx: 1530,
    });
    const g1600 = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.09,
      baseFx: 1600,
    });
    const g1625 = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.09,
      baseFx: 1625,
    });
    assert.equal(g1530.finalPoints, 229);
    assert.equal(g1600.finalPoints, 239);
    assert.equal(g1625.finalPoints, 243);
    assert.equal(g1625.strictMarketPass, true);

    const g10 = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.1,
      baseFx: 1625,
    });
    assert.ok(g10.finalPoints > 244.2);
    assert.equal(g10.strictMarketPass, false);

    const o1530 = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.08,
      baseFx: 1530,
    });
    const o1600 = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.08,
      baseFx: 1600,
    });
    const o1625 = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.08,
      baseFx: 1625,
    });
    assert.equal(o1530.finalPoints, 695);
    assert.equal(o1600.finalPoints, 727);
    assert.equal(o1625.finalPoints, 738);
    assert.equal(o1625.strictMarketPass, true);

    const o9 = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.09,
      baseFx: 1625,
    });
    assert.ok(o9.finalPoints > 741.5);
    assert.equal(o9.strictMarketPass, false);
  });

  it("selectPremiumTargetMargin picks 9% Gemini31 and 8% Opus5", () => {
    const g = selectPremiumTargetMargin({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.gemini31,
      minimumMarginFloor: GEMINI31_V2_PROPOSED.minimumMarginFloor,
    });
    const o = selectPremiumTargetMargin({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.opus5,
      minimumMarginFloor: OPUS5_V2_PROPOSED.minimumMarginFloor,
    });
    assert.equal(g, 0.09);
    assert.equal(o, 0.08);
  });

  it("opaque references cannot change recommended target margin", () => {
    const baselineG = selectPremiumTargetMargin({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.gemini31,
      minimumMarginFloor: GEMINI31_V2_PROPOSED.minimumMarginFloor,
    });
    const baselineO = selectPremiumTargetMargin({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.opus5,
      minimumMarginFloor: OPUS5_V2_PROPOSED.minimumMarginFloor,
    });

    const mutated = OPAQUE_MARKET_REFERENCES.map((ref) =>
      ref.id === "opus5_crack_wrtn_a" ? { ...ref, userChargePoints: 100 } : ref
    );
    _setOpaqueMarketReferencesForTest(mutated);
    assert.equal(getOpaqueMarketReferences()[0]?.userChargePoints, 100);

    const afterMutG = selectPremiumTargetMargin({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.gemini31,
      minimumMarginFloor: GEMINI31_V2_PROPOSED.minimumMarginFloor,
    });
    const afterMutO = selectPremiumTargetMargin({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.opus5,
      minimumMarginFloor: OPUS5_V2_PROPOSED.minimumMarginFloor,
    });
    assert.equal(afterMutG, baselineG);
    assert.equal(afterMutO, baselineO);

    _setOpaqueMarketReferencesForTest([]);
    const afterEmptyG = selectPremiumTargetMargin({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.gemini31,
      minimumMarginFloor: GEMINI31_V2_PROPOSED.minimumMarginFloor,
    });
    const afterEmptyO = selectPremiumTargetMargin({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.opus5,
      minimumMarginFloor: OPUS5_V2_PROPOSED.minimumMarginFloor,
    });
    assert.equal(afterEmptyG, baselineG);
    assert.equal(afterEmptyO, baselineO);
    _setOpaqueMarketReferencesForTest(null);
  });

  it("competitive FX ceiling boundary tests", () => {
    const gCeiling = computeCompetitiveFxCeiling({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.09,
    });
    const oCeiling = computeCompetitiveFxCeiling({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.08,
    });
    assert.equal(gCeiling, 1636);
    assert.equal(oCeiling, 1632);

    const gBelow = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.09,
      baseFx: gCeiling,
    });
    const gAbove = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.09,
      baseFx: gCeiling + 1,
    });
    assert.equal(gBelow.strictMarketPass, true);
    assert.equal(gAbove.strictMarketPass, false);

    const oBelow = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.08,
      baseFx: oCeiling,
    });
    const oAbove = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.08,
      baseFx: oCeiling + 1,
    });
    assert.equal(oBelow.strictMarketPass, true);
    assert.equal(oAbove.strictMarketPass, false);
  });

  it("uncached target semantics match within tolerance", () => {
    const g = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.09,
      baseFx: 1530,
    });
    const o = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.08,
      baseFx: 1530,
    });
    assert.ok(g.noDiscountRealizedMargin != null);
    assert.ok(o.noDiscountRealizedMargin != null);
    assert.ok(Math.abs(g.noDiscountRealizedMargin! - 0.09) < 0.02);
    assert.ok(Math.abs(o.noDiscountRealizedMargin! - 0.08) < 0.02);
  });

  it("acceptance gates all pass for v2 proposed", () => {
    const gates = evaluatePremiumPricingGates();
    assert.equal(gates.allPass, true);
    assert.equal(gates.GEMINI31_REFERENCE_EVIDENCE_VERIFIED, true);
    assert.equal(gates.OPUS5_REFERENCE_EVIDENCE_VERIFIED, true);
  });

  it("hard benchmark implied max margin @1530", () => {
    const gBench = requirePrimaryBenchmark("gemini-3.1-pro-preview");
    const gRow = simulatePremiumPricingPolicy({
      modelId: "gemini-3.1-pro-preview",
      published: GEMINI31_V2_PROPOSED,
      targetMargin: 0.09,
      baseFx: 1530,
    });
    const implied = 1 - gRow.providerListCostKrw / gBench.competitorChargePoints;
    assert.ok(Math.abs(implied - 0.1496) < 0.01);

    const oBench = requirePrimaryBenchmark("claude-opus-5");
    const oRow = simulatePremiumPricingPolicy({
      modelId: "claude-opus-5",
      published: OPUS5_V2_PROPOSED,
      targetMargin: 0.08,
      baseFx: 1530,
    });
    const oImplied = 1 - oRow.providerListCostKrw / oBench.competitorChargePoints;
    assert.ok(Math.abs(oImplied - 0.1382) < 0.01);
  });
});
