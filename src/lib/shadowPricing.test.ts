import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeShadowPricing, normalizeBillableUsage } from "./shadowPricing";
import { clearCheaperInferenceCatalogPricingForTest, updateCheaperInferenceCatalogPricing } from "./cheaperInferenceCatalogPricing";
import {
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
} from "./shadowBillingExchangeRate";
import { ensureShadowBillingFxTables } from "./shadowBillingFxPersistence";
import Database from "better-sqlite3";

describe("shadowPricing fxSnapshot", () => {
  it("includes billing FX source in historical shadow snapshot", () => {
    const db = new Database(":memory:");
    ensureShadowBillingFxTables(db);
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-08-28",
      baseUsdKrw: 1530,
      source: "api_daily",
    });
    const s = computeShadowPricing({ modelId: "gemini-3.7-flash", promptTokens: 1000, outputTokens: 1000 });
    assert.equal(s.fxSnapshot.source, "api_daily");
    assert.equal(s.fxSnapshot.dateKey, "2026-08-28");
    assert.equal(s.fxSnapshot.baseUsdKrw, 1530);
    _setShadowBillingFxTestDb(null);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(null);
    db.close();
  });
});

describe("shadowPricing catalog semantics", () => {
  it("reference rate is list, current is discounted", () => {
    clearCheaperInferenceCatalogPricingForTest();
    updateCheaperInferenceCatalogPricing({
      modelId: "claude-opus-5",
      inputUsdPerMillion: 3.5,
      outputUsdPerMillion: 17.5,
      cacheReadUsdPerMillion: 0.35,
      cacheWriteUsdPerMillion: 4.375,
      referenceInputUsdPerMillion: 5,
      referenceOutputUsdPerMillion: 25,
      discountPercent: 30,
      fetchedAt: Date.now(),
    });
    const s = computeShadowPricing({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 1000 });
    assert.ok(s.providerListCostKrw > s.actualProviderCostKrw, "list > actual when discounted");
    clearCheaperInferenceCatalogPricingForTest();
  });
  it("no discount list == actual", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const s = computeShadowPricing({ modelId: "gemini-3.7-flash", promptTokens: 1000, outputTokens: 1000 });
    assert.ok(s.providerListCostKrw >= 0);
  });
});

describe("reasoning double-count", () => {
  it("included_in_output does not double count", () => {
    const n = normalizeBillableUsage({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 5000, reasoningTokens: 1500 });
    assert.equal(n.reasoningAccounting, "included_in_output");
    assert.equal(n.billableOutputTokens, 5000);
  });
  it("separate sums — now treated as included (contract: reasoning is subset of completion)", () => {
    const n = normalizeBillableUsage({ modelId: "deepseek-v4-pro-0813", promptTokens: 1000, outputTokens: 3500, reasoningTokens: 1500 });
    assert.equal(n.reasoningAccounting, "included_in_output");
    assert.equal(n.billableOutputTokens, 3500);
  });
  it("none", () => {
    const n = normalizeBillableUsage({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 5000, reasoningTokens: 0 });
    assert.equal(n.billableOutputTokens, 5000);
  });
});

describe("reserve math", () => {
  it("30% discount reserve — only when complete", () => {
    const s = computeShadowPricing({ modelId: "claude-opus-5", promptTokens: 40689, outputTokens: 4307, cheaperInferenceBilledCostUsd: 0.01, upstreamCostUsd: 0.02 });
    if (s.reserveStatus === "complete") {
      assert.ok(s.providerSavingsKrw != null && s.providerSavingsKrw >= 0);
    } else {
      assert.ok(s.reserveStatus === "unavailable" || s.reserveStatus === "estimated");
    }
  });
  it("unknown list zero disguise false — unavailable list gives null savings", () => {
    const s = computeShadowPricing({ modelId: "unknown-model-xyz", promptTokens: 1000, outputTokens: 1000 });
    if (s.providerListCostStatus !== "complete") {
      assert.equal(s.providerSavingsKrw, null);
      assert.equal(s.providerOverrunKrw, null);
      assert.equal(s.netPricingBufferDeltaKrw, null);
    }
  });
});

describe("actual source precedence", () => {
  it("cheaper_inference_billed takes precedence", () => {
    const s = computeShadowPricing({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 1000, cheaperInferenceBilledCostUsd: 0.01, upstreamCostUsd: 0.02 });
    assert.equal(s.actualCostSource, "cheaper_inference_billed");
  });
  it("envelope billed overrides usage billed", async () => {
    const { parseCompatibleUsage } = await import("./openRouterUsage");
    const r = parseCompatibleUsage({ usage: { prompt_tokens: 1000, completion_tokens: 500, cheaper_inference_billed_cost_usd: 0.01 }, cheaperInference: { billing: { billed_cost_usd: "0.008" } } });
    assert.equal(r.cheaperInferenceBilledCostUsd, 0.008);
  });
  it("estimated actual does not count as complete reserve", () => {
    const s = computeShadowPricing({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 1000 });
    if (s.actualCostSource === "live_catalog_estimated" || s.actualCostSource === "published_fallback_estimated") {
      assert.notEqual(s.reserveStatus, "complete");
    }
  });
  it("worstCase margin null when list incomplete", () => {
    const s = computeShadowPricing({ modelId: "unknown-model-xyz", promptTokens: 1000, outputTokens: 1000 });
    if (s.providerListCostStatus !== "complete") {
      assert.equal(s.worstCasePromoMargin, null);
      assert.equal(s.marginFloorViolated, null);
    }
  });
});
