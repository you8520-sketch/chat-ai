import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  CHARGE_SNAPSHOT_SCHEMA_VERSION,
  computePublishedUserChargeWithSnapshot,
  isPublishedUserChargeSnapshot,
  type PublishedUserChargeSnapshot,
} from "@/lib/publishedUserCharge";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";

const FX_1530: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

function usage(modelId: string, prompt: number, output: number, cache?: { read?: number; write?: number }) {
  return normalizeBillableUsage({
    modelId,
    promptTokens: prompt,
    outputTokens: output,
    cacheReadTokens: cache?.read,
    cacheWriteTokens: cache?.write,
  });
}

function completeCharge(modelId: string, prompt: number, output: number, cache?: { read?: number; write?: number }) {
  return computePublishedUserChargeWithSnapshot({
    modelId,
    usage: usage(modelId, prompt, output, cache),
    usageCoverage: "complete",
    fxSnapshot: FX_1530,
    adjustment: { kind: "none" },
  });
}

describe("publishedUserCharge — golden fixtures @1530/2%", () => {
  it("G37 A → 48P", () => {
    const r = completeCharge("gemini-3.7-flash", 24_952, 2_367);
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 48);
  });

  it("G37 B → 80P", () => {
    const r = completeCharge("gemini-3.7-flash", 42_195, 3_862);
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 80);
  });

  it("G31 → 229P", () => {
    const r = completeCharge("gemini-3.1-pro-preview", 40_689, 4_307);
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 229);
  });

  it("Opus5 → 695P", () => {
    const r = completeCharge("claude-opus-5", 63_749, 3_629);
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 695);
  });
});

describe("publishedUserCharge — fail-closed gates", () => {
  it("unknown model → blocked unsupported_model, finalPoints null", () => {
    const r = completeCharge("made-up-model-xyz", 1000, 500);
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") {
      assert.equal(r.reason, "unsupported_model");
      assert.equal(r.finalPoints, null);
    }
  });

  it("G31 alias resolves identically", () => {
    const a = completeCharge("gemini-3.1-pro-preview", 40_689, 4_307);
    const b = completeCharge("google/gemini-3.1-pro-preview", 40_689, 4_307);
    assert.equal(a.status, "complete");
    assert.equal(b.status, "complete");
    if (a.status === "complete" && b.status === "complete") {
      assert.equal(a.snapshot.canonicalModelId, "gemini-3.1-pro-preview");
      assert.equal(b.snapshot.canonicalModelId, "gemini-3.1-pro-preview");
      assert.equal(a.snapshot.finalPoints, b.snapshot.finalPoints);
    }
  });

  it("G31 tier boundary 199999/200000 supported, 200001 blocked", () => {
    const ok199999 = completeCharge("gemini-3.1-pro-preview", 199_999, 100);
    const ok200000 = completeCharge("gemini-3.1-pro-preview", 200_000, 100);
    const blocked200001 = completeCharge("gemini-3.1-pro-preview", 200_001, 100);
    assert.equal(ok199999.status, "complete");
    assert.equal(ok200000.status, "complete");
    assert.equal(blocked200001.status, "blocked");
    if (blocked200001.status === "blocked") {
      assert.equal(blocked200001.reason, "unsupported_pricing_tier");
      assert.equal(blocked200001.finalPoints, null);
    }
  });

  it("G37 cache read/write → blocked", () => {
    const read = completeCharge("gemini-3.7-flash", 10_000, 500, { read: 5_000 });
    const write = completeCharge("gemini-3.7-flash", 10_000, 500, { write: 2_000 });
    assert.equal(read.status, "blocked");
    assert.equal(write.status, "blocked");
    if (read.status === "blocked") assert.equal(read.reason, "unsupported_cache_semantics");
    if (write.status === "blocked") assert.equal(write.reason, "unsupported_cache_semantics");
  });

  it("G31 cache read/write → blocked", () => {
    const read = completeCharge("gemini-3.1-pro-preview", 10_000, 500, { read: 5_000 });
    const write = completeCharge("gemini-3.1-pro-preview", 10_000, 500, { write: 2_000 });
    assert.equal(read.status, "blocked");
    assert.equal(write.status, "blocked");
  });

  it("Opus5 verified cache → complete with exact cache USD math", () => {
    const r = completeCharge("claude-opus-5", 10_000, 500, { read: 5_000, write: 1_000 });
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      const expectedUsd =
        (4_000 / 1_000_000) * 5 +
        (5_000 / 1_000_000) * 0.5 +
        (1_000 / 1_000_000) * 6.25 +
        (500 / 1_000_000) * 25;
      assert.ok(Math.abs(r.snapshot.billingReferenceCostUsd - expectedUsd) < 1e-9);
      assert.equal(r.snapshot.billingReferenceCacheReadUsdPerMillion, 0.5);
      assert.equal(r.snapshot.billingReferenceCacheWriteUsdPerMillion, 6.25);
    }
  });

  it("partial/unknown usage coverage → blocked", () => {
    const partial = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 1000, 500),
      usageCoverage: "partial",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    const unknown = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 1000, 500),
      usageCoverage: "unknown",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(partial.status, "blocked");
    assert.equal(unknown.status, "blocked");
    if (partial.status === "blocked") assert.equal(partial.finalPoints, null);
    if (unknown.status === "blocked") assert.equal(unknown.finalPoints, null);
  });

  it("invalid FX snapshot → blocked", () => {
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 1000, 500),
      usageCoverage: "complete",
      fxSnapshot: { ...FX_1530, effectiveKrwPerUsd: 0 },
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reason, "invalid_fx_snapshot");
  });

  it("reasoning included_in_output — no double count", () => {
    const withReasoning = normalizeBillableUsage({
      modelId: "claude-opus-5",
      promptTokens: 1000,
      outputTokens: 5000,
      reasoningTokens: 1500,
    });
    assert.equal(withReasoning.reasoningAccounting, "included_in_output");
    assert.equal(withReasoning.billableOutputTokens, 5000);
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "claude-opus-5",
      usage: withReasoning,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      const noReasoning = completeCharge("claude-opus-5", 1000, 5000);
      assert.equal(noReasoning.status, "complete");
      if (noReasoning.status === "complete") {
        assert.equal(r.snapshot.finalPoints, noReasoning.snapshot.finalPoints);
      }
    }
  });

  it("waiver → finalPoints 0 on valid complete charge", () => {
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 24_952, 2_367),
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "waiver", reason: "test_waiver" },
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      assert.equal(r.snapshot.finalPoints, 0);
      assert.equal(r.snapshot.adjustment.kind, "waiver");
    }
  });

  it("self_funded_promo 10% foundation", () => {
    const base = completeCharge("gemini-3.7-flash", 24_952, 2_367);
    assert.equal(base.status, "complete");
    const promo = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 24_952, 2_367),
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "self_funded_promo", promoId: "test", percent: 0.1 },
    });
    assert.equal(promo.status, "complete");
    if (base.status === "complete" && promo.status === "complete") {
      assert.ok(promo.snapshot.finalPoints <= base.snapshot.finalPoints);
    }
  });
});

describe("publishedUserCharge — determinism and serialization", () => {
  it("same input → same snapshot (deep equality)", () => {
    const input = {
      modelId: "gemini-3.1-pro-preview",
      usage: usage("gemini-3.1-pro-preview", 40_689, 4_307),
      usageCoverage: "complete" as const,
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" as const },
    };
    const a = computePublishedUserChargeWithSnapshot(structuredClone(input));
    const b = computePublishedUserChargeWithSnapshot(structuredClone(input));
    assert.deepEqual(a, b);
  });

  it("snapshot JSON round-trip lossless", () => {
    const r = completeCharge("gemini-3.1-pro-preview", 40_689, 4_307);
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      const parsed = JSON.parse(JSON.stringify(r.snapshot)) as PublishedUserChargeSnapshot;
      assert.equal(isPublishedUserChargeSnapshot(parsed), true);
      assert.equal(parsed.chargeSnapshotSchemaVersion, CHARGE_SNAPSHOT_SCHEMA_VERSION);
      assert.equal(parsed.finalPoints, r.snapshot.finalPoints);
      assert.equal(Number.isInteger(parsed.finalPoints), true);
    }
  });

  it("resolvePublishedPricingExact — no generic fallback", () => {
    assert.equal(resolvePublishedPricingExact("made-up-model-xyz"), null);
    const exact = resolvePublishedPricingExact("google/gemini-3.1-pro-preview");
    assert.ok(exact);
    assert.equal(exact!.canonicalModelId, "gemini-3.1-pro-preview");
  });
});

describe("publishedUserCharge — adversarial inputs", () => {
  it("rejects inconsistent usage buckets", () => {
    const bad = normalizeBillableUsage({
      modelId: "gemini-3.7-flash",
      promptTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 800,
      cacheWriteTokens: 300,
    });
    bad.standardInputTokens = 999;
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: bad,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reason, "invalid_usage");
  });

  it("NaN tokens → blocked", () => {
    const u = usage("gemini-3.7-flash", 1000, 500);
    u.promptTokens = NaN;
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: u,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
  });
});
