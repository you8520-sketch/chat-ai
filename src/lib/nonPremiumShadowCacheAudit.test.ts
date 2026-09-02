import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  computePublishedUserChargeFromResolvedPolicy,
  computePublishedUserChargeWithSnapshot,
  isLiveGradePublishedUserChargeSnapshot,
} from "@/lib/publishedUserCharge";
import {
  DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE,
  DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE,
  DEEPSEEK_V4_PRO_V1_PUBLISHED,
} from "@/lib/deepseekV4ProPricingPolicy";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";

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
  it("DeepSeek prefix cache read → complete with verified semantics", () => {
    for (const modelId of ["deepseek-v4-pro-0813", "deepseek-v4-pro"]) {
      const usage = normalizeBillableUsage({
        modelId,
        promptTokens: DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE.promptTokens,
        outputTokens: DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE.outputTokens,
        cacheReadTokens: DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE.cacheReadTokens,
      });
      const r = computePublishedUserChargeWithSnapshot({
        modelId,
        usage,
        usageCoverage: "complete",
        fxSnapshot: FX,
        adjustment: { kind: "none" },
      });
      assert.equal(r.status, "complete", modelId);
      if (r.status === "complete") {
        assert.equal(r.snapshot.finalPoints, 6, modelId);
        assert.equal(r.snapshot.canonicalModelId, "deepseek-v4-pro-0813", modelId);
        assert.equal(r.snapshot.applicability.cacheSemanticStatus, "verified", modelId);
      }
    }
  });

  it("DeepSeek cache write tokens → blocked (no published cache-write rate)", () => {
    for (const modelId of ["deepseek-v4-pro-0813", "deepseek-v4-pro"]) {
      const usage = normalizeBillableUsage({
        modelId,
        promptTokens: 10_000,
        outputTokens: 500,
        cacheWriteTokens: 2_000,
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

describe("deepseek published user charge fixtures", () => {
  it("competitor fixture cache miss → 90P", () => {
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "deepseek-v4-pro-0813",
      usage: normalizeBillableUsage({
        modelId: "deepseek-v4-pro-0813",
        promptTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.inputTokens,
        outputTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.outputTokens,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 90);
  });

  it("legacy alias matches canonical 0813 charge", () => {
    const canonical = computePublishedUserChargeWithSnapshot({
      modelId: "deepseek-v4-pro-0813",
      usage: normalizeBillableUsage({
        modelId: "deepseek-v4-pro-0813",
        promptTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.inputTokens,
        outputTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.outputTokens,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    const alias = computePublishedUserChargeWithSnapshot({
      modelId: "deepseek-v4-pro",
      usage: normalizeBillableUsage({
        modelId: "deepseek-v4-pro",
        promptTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.inputTokens,
        outputTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.outputTokens,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(canonical.status, "complete");
    assert.equal(alias.status, "complete");
    if (canonical.status === "complete" && alias.status === "complete") {
      assert.equal(alias.snapshot.canonicalModelId, "deepseek-v4-pro-0813");
      assert.equal(alias.snapshot.finalPoints, canonical.snapshot.finalPoints);
    }
  });

  it("v1 snapshot replay preserves historical pricingVersion", () => {
    const v1 = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: "deepseek-v4-pro",
      resolvedPricing: {
        requestedModelId: "deepseek-v4-pro",
        canonicalModelId: canonicalizePublishedModelId("deepseek-v4-pro"),
        pricing: DEEPSEEK_V4_PRO_V1_PUBLISHED,
      },
      usage: normalizeBillableUsage({
        modelId: "deepseek-v4-pro",
        promptTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.inputTokens,
        outputTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.outputTokens,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
      expectedCanonicalModelId: "deepseek-v4-pro-0813",
    });
    assert.equal(v1.status, "complete");
    if (v1.status === "complete") {
      assert.equal(v1.snapshot.pricingVersion, 1);
      assert.equal(v1.snapshot.finalPoints, 50);
      assert.equal(isLiveGradePublishedUserChargeSnapshot(v1.snapshot), false);
    }
  });

  it("zero reasoning with included_in_output accounting → complete", () => {
    const usage = normalizeBillableUsage({
      modelId: "deepseek-v4-pro-0813",
      promptTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.inputTokens,
      outputTokens: DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE.outputTokens,
      reasoningTokens: 0,
    });
    assert.equal(usage.reasoningAccounting, "none");
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "deepseek-v4-pro-0813",
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
  });

  it("reasoning included_in_output does not double-count billable output", () => {
    const withReasoning = normalizeBillableUsage({
      modelId: "deepseek-v4-pro-0813",
      promptTokens: 1000,
      outputTokens: 5000,
      reasoningTokens: 1500,
    });
    assert.equal(withReasoning.reasoningAccounting, "included_in_output");
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "deepseek-v4-pro-0813",
      usage: withReasoning,
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
    const baseline = computePublishedUserChargeWithSnapshot({
      modelId: "deepseek-v4-pro-0813",
      usage: normalizeBillableUsage({
        modelId: "deepseek-v4-pro-0813",
        promptTokens: 1000,
        outputTokens: 5000,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(baseline.status, "complete");
    if (r.status === "complete" && baseline.status === "complete") {
      assert.equal(r.snapshot.finalPoints, baseline.snapshot.finalPoints);
    }
  });

  it("partial and unknown usage coverage → blocked", () => {
    for (const usageCoverage of ["partial", "unknown"] as const) {
      const r = computePublishedUserChargeWithSnapshot({
        modelId: "deepseek-v4-pro-0813",
        usage: normalizeBillableUsage({
          modelId: "deepseek-v4-pro-0813",
          promptTokens: 1000,
          outputTokens: 500,
        }),
        usageCoverage,
        fxSnapshot: FX,
        adjustment: { kind: "none" },
      });
      assert.equal(r.status, "blocked", usageCoverage);
      if (r.status === "blocked") assert.equal(r.finalPoints, null, usageCoverage);
    }
  });
});
