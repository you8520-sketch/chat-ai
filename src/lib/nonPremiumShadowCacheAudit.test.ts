import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

describe("non-premium cached published charge audit", () => {
  it("Gemini 3.7 with cache usage → blocked (unknown cache semantics)", () => {
    const usage = normalizeBillableUsage({
      modelId: "gemini-3.7-flash",
      promptTokens: 10_000,
      outputTokens: 500,
      cacheReadTokens: 5_000,
    });
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") {
      assert.equal(r.reason, "unsupported_cache_semantics");
    }
  });
});
