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
  it("DeepSeek models with cache usage → blocked (live-grade safety)", () => {
    for (const modelId of ["deepseek-v4-pro-0813", "deepseek-v4-pro"]) {
      const usage = normalizeBillableUsage({
        modelId,
        promptTokens: 10_000,
        outputTokens: 500,
        cacheReadTokens: 5_000,
      });
      const r = computePublishedUserChargeWithSnapshot({
        modelId,
        usage,
        usageCoverage: "complete",
        fxSnapshot: FX,
        adjustment: { kind: "none" },
      });
      assert.equal(r.status, "blocked", modelId);
      if (r.status === "blocked") {
        assert.equal(r.reason, "unsupported_cache_semantics", modelId);
      }
    }
  });
});
