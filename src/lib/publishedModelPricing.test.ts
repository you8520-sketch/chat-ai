import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublishedPricing } from "./publishedModelPricing";

describe("publishedModelPricing", () => {
  it("billingReference is independent of provider list", () => {
    const p = getPublishedPricing("claude-opus-5");
    assert.equal(p.billingReferenceInputUsdPerMillion > 0, true);
    assert.equal(typeof p.targetMargin, "number");
    assert.equal(p.pricingVersion, 1);
  });
  it("has benchmark for premium", () => {
    const g = getPublishedPricing("gemini-3.1-pro-preview");
    assert.ok(g.marketUsageBenchmark);
    assert.equal(g.marketUsageBenchmark!.inputTokens, 40689);
  });
});
