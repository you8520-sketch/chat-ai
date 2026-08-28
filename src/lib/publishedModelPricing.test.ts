import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublishedPricing } from "./publishedModelPricing";
import { evaluateGemini37V2AcceptanceGates } from "./gemini37PricingPolicy";
import { requirePrimaryBenchmark } from "./marketUsageBenchmarks";

describe("publishedModelPricing", () => {
  it("billingReference is independent of provider list", () => {
    const p = getPublishedPricing("claude-opus-5");
    assert.equal(p.billingReferenceInputUsdPerMillion > 0, true);
    assert.equal(typeof p.targetMargin, "number");
    assert.equal(p.pricingVersion, 1);
  });

  it("does not duplicate market usage benchmarks on published entries", () => {
    const g = getPublishedPricing("gemini-3.1-pro-preview");
    assert.equal("marketUsageBenchmark" in g, false);
    const benchmark = requirePrimaryBenchmark("gemini-3.1-pro-preview");
    assert.equal(benchmark.inputTokens, 40_689);
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
});
