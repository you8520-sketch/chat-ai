import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  CHARGE_SNAPSHOT_SCHEMA_VERSION,
  computePublishedUserChargeFromResolvedPolicy,
  computePublishedUserChargeWithSnapshot,
  isLiveGradePublishedUserChargeSnapshot,
  isPublishedUserChargeSnapshot,
  recomputeSnapshotTotalsFromEmbeddedValues,
  validateAdjustment,
  type PublishedUserChargeSnapshot,
} from "@/lib/publishedUserCharge";
import {
  listExactPublishedCatalogEntries,
  resolvePublishedPricingExact,
  _setPublishedPricingForTest,
  type PublishedModelPricing,
} from "@/lib/publishedModelPricing";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { getModelPublishedPricingPolicy } from "@/lib/modelPublishedPricingPolicy";
import { GEMINI37_V2_PROPOSED } from "@/lib/gemini37PricingPolicy";

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

  it("snapshot JSON round-trip deep equal + live-grade valid", () => {
    const r = completeCharge("gemini-3.1-pro-preview", 40_689, 4_307);
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      const parsed = JSON.parse(JSON.stringify(r.snapshot)) as PublishedUserChargeSnapshot;
      assert.deepEqual(parsed, r.snapshot);
      assert.equal(isPublishedUserChargeSnapshot(parsed), true);
      assert.equal(isLiveGradePublishedUserChargeSnapshot(parsed), true);
      assert.equal(parsed.chargeSnapshotSchemaVersion, CHARGE_SNAPSHOT_SCHEMA_VERSION);
      assert.equal(Number.isInteger(parsed.finalPoints), true);
      assert.ok(parsed.applicability);
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

describe("publishedUserCharge — live-grade contract hardening", () => {
  it("public engine cannot bypass unknown model via resolved pricing override", () => {
    const g37 = resolvePublishedPricingExact("gemini-3.7-flash")!;
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "made-up-model-xyz",
      usage: usage("gemini-3.7-flash", 1000, 500),
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") {
      assert.equal(r.reason, "unsupported_model");
      assert.equal(r.finalPoints, null);
    }
    void g37;
  });

  it("Opus request + Gemini resolved policy → identity mismatch blocked", () => {
    const g37 = resolvePublishedPricingExact("gemini-3.7-flash")!;
    const r = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: "claude-opus-5",
      resolvedPricing: g37,
      usage: usage("claude-opus-5", 1000, 500),
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reason, "model_pricing_identity_mismatch");
  });

  it("locked=false FX → blocked for live-grade public engine", () => {
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 1000, 500),
      usageCoverage: "complete",
      fxSnapshot: { ...FX_1530, locked: false },
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reason, "invalid_fx_snapshot");
  });

  it("wrong effective rate → blocked", () => {
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 1000, 500),
      usageCoverage: "complete",
      fxSnapshot: { ...FX_1530, effectiveKrwPerUsd: 1000 },
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reason, "invalid_fx_snapshot");
  });

  it("wrong overseas fee → blocked", () => {
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 1000, 500),
      usageCoverage: "complete",
      fxSnapshot: { ...FX_1530, overseasFeeRate: 0 },
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reason, "invalid_fx_snapshot");
  });

  it("malformed KST dateKey → blocked", () => {
    for (const dateKey of ["x", "tomorrow", "2026-99-99"]) {
      const r = computePublishedUserChargeWithSnapshot({
        modelId: "gemini-3.7-flash",
        usage: usage("gemini-3.7-flash", 1000, 500),
        usageCoverage: "complete",
        fxSnapshot: { ...FX_1530, dateKey },
        adjustment: { kind: "none" },
      });
      assert.equal(r.status, "blocked", dateKey);
    }
  });

  it("reasoning included_in_output with under-reported billableOutput → blocked", () => {
    const u = usage("gemini-3.7-flash", 1000, 500);
    u.reasoningAccounting = "included_in_output";
    u.reasoningTokens = 100;
    u.billableOutputTokens = 400;
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: u,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
  });

  it("reasoningAccounting=separate → blocked for live-grade", () => {
    const u = usage("gemini-3.7-flash", 1000, 500);
    u.reasoningAccounting = "separate";
    u.reasoningTokens = 100;
    u.billableOutputTokens = 600;
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: u,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
  });

  it("reasoningAccounting=unknown → blocked", () => {
    const u = usage("gemini-3.7-flash", 1000, 500);
    u.reasoningAccounting = "unknown";
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: u,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
  });

  it("fractional token count → blocked", () => {
    const u = usage("gemini-3.7-flash", 1000, 500);
    u.promptTokens = 1000.5;
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: u,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
  });

  it("unsafe integer token count → blocked", () => {
    const u = usage("gemini-3.7-flash", 1000, 500);
    u.promptTokens = Number.MAX_SAFE_INTEGER + 1;
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: u,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "blocked");
  });

  it("targetMargin 0.99 uses exact gross margin (not silent 95% clamp)", () => {
    const pricing: PublishedModelPricing = {
      ...GEMINI37_V2_PROPOSED,
      targetMargin: 0.99,
    };
    const r = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: "gemini-3.7-flash",
      resolvedPricing: {
        requestedModelId: "gemini-3.7-flash",
        canonicalModelId: "gemini-3.7-flash",
        pricing,
      },
      usage: usage("gemini-3.7-flash", 24_952, 2_367),
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
      expectedCanonicalModelId: "gemini-3.7-flash",
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      assert.equal(r.snapshot.targetMargin, 0.99);
      assert.ok(r.snapshot.standardUserChargeKrw > r.snapshot.billingReferenceCostKrw * 50);
    }
  });

  it("cache rate NaN → invalid published pricing", () => {
    const pricing: PublishedModelPricing = {
      ...resolvePublishedPricingExact("claude-opus-5")!.pricing,
      billingReferenceCacheReadUsdPerMillion: NaN,
    };
    const r = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: "claude-opus-5",
      resolvedPricing: {
        requestedModelId: "claude-opus-5",
        canonicalModelId: "claude-opus-5",
        pricing,
      },
      usage: usage("claude-opus-5", 1000, 500, { read: 100 }),
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
      expectedCanonicalModelId: "claude-opus-5",
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reason, "invalid_published_pricing");
  });

  it("malformed adjustment → invalid_adjustment", () => {
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: usage("gemini-3.7-flash", 1000, 500),
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "waiver", reason: "" },
    });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reason, "invalid_adjustment");
    assert.equal(validateAdjustment({ kind: "waiver", reason: "" }), false);
  });

  it("snapshot validator rejects tampered finalPoints", () => {
    const r = completeCharge("gemini-3.1-pro-preview", 40_689, 4_307);
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      const tampered = { ...r.snapshot, finalPoints: r.snapshot.finalPoints + 1 };
      assert.equal(isPublishedUserChargeSnapshot(tampered), false);
    }
  });

  it("snapshot validator rejects tampered USD rate", () => {
    const r = completeCharge("gemini-3.1-pro-preview", 40_689, 4_307);
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      const tampered = {
        ...r.snapshot,
        billingReferenceInputUsdPerMillion: r.snapshot.billingReferenceInputUsdPerMillion + 0.01,
      };
      assert.equal(isPublishedUserChargeSnapshot(tampered), false);
    }
  });

  it("snapshot validator rejects missing FX fields", () => {
    const r = completeCharge("gemini-3.1-pro-preview", 40_689, 4_307);
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      const partial = { ...r.snapshot };
      delete (partial as Partial<PublishedUserChargeSnapshot>).fxDateKey;
      assert.equal(isPublishedUserChargeSnapshot(partial), false);
    }
  });

  it("alias pricing and policy canonical ids identical", () => {
    const alias = "google/gemini-3.1-pro-preview";
    const pricing = resolvePublishedPricingExact(alias);
    const policy = getModelPublishedPricingPolicy(alias);
    assert.ok(pricing);
    assert.ok(policy);
    assert.equal(pricing!.canonicalModelId, canonicalizePublishedModelId(alias));
    assert.equal(policy!.modelId, pricing!.canonicalModelId);
  });
});

describe("publishedUserCharge — snapshot v1 live-grade semantics", () => {
  function requireCompleteSnapshot(modelId: string, prompt: number, output: number, cache?: { read?: number; write?: number }) {
    const r = completeCharge(modelId, prompt, output, cache);
    assert.equal(r.status, "complete");
    if (r.status !== "complete") throw new Error("expected complete charge");
    return r.snapshot;
  }

  it("public catalog pricing.modelId mismatch → blocked (fail closed)", () => {
    const canonical = resolvePublishedPricingExact("gemini-3.7-flash")!;
    _setPublishedPricingForTest(
      {
        ...canonical.pricing,
        modelId: "wrong-model-id",
      },
      "gemini-3.7-flash"
    );
    try {
      const resolved = resolvePublishedPricingExact("gemini-3.7-flash");
      assert.equal(resolved, null);
      const r = computePublishedUserChargeWithSnapshot({
        modelId: "gemini-3.7-flash",
        usage: usage("gemini-3.7-flash", 1000, 500),
        usageCoverage: "complete",
        fxSnapshot: FX_1530,
        adjustment: { kind: "none" },
      });
      assert.equal(r.status, "blocked");
      if (r.status === "blocked") {
        assert.equal(r.reason, "unsupported_model");
        assert.equal(r.finalPoints, null);
      }
    } finally {
      _setPublishedPricingForTest(canonical.pricing, "gemini-3.7-flash");
    }
  });

  it("valid snapshot with usageCoverage partial → live-grade false", () => {
    const snap = requireCompleteSnapshot("gemini-3.1-pro-preview", 40_689, 4_307);
    const partial = { ...snap, usageCoverage: "partial" as const };
    assert.equal(isPublishedUserChargeSnapshot(partial), true);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(partial), false);
  });

  it("valid snapshot with usageCoverage unknown → live-grade false", () => {
    const snap = requireCompleteSnapshot("gemini-3.1-pro-preview", 40_689, 4_307);
    const unknown = { ...snap, usageCoverage: "unknown" as const };
    assert.equal(isPublishedUserChargeSnapshot(unknown), true);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(unknown), false);
  });

  it("valid snapshot with fxLocked false → live-grade false", () => {
    const snap = requireCompleteSnapshot("gemini-3.1-pro-preview", 40_689, 4_307);
    const unlocked = { ...snap, fxLocked: false };
    assert.equal(isPublishedUserChargeSnapshot(unlocked), true);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(unlocked), false);
  });

  it("valid snapshot with requested/canonical mismatch → live-grade false", () => {
    const snap = requireCompleteSnapshot("google/gemini-3.1-pro-preview", 40_689, 4_307);
    const mismatched = { ...snap, requestedModelId: "claude-opus-5" };
    assert.equal(isPublishedUserChargeSnapshot(mismatched), true);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(mismatched), false);
  });

  it("G31 self-consistent 200001 tokens → live-grade false", () => {
    const snap = requireCompleteSnapshot("gemini-3.1-pro-preview", 200_000, 100);
    const tampered = recomputeSnapshotTotalsFromEmbeddedValues({
      ...snap,
      promptTokens: 200_001,
      standardInputTokens: 200_001,
    });
    assert.equal(isPublishedUserChargeSnapshot(tampered), true);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(tampered), false);
  });

  it("G31 self-consistent cache snapshot → live-grade false (unverified policy)", () => {
    const snap = requireCompleteSnapshot("gemini-3.1-pro-preview", 10_000, 500);
    const tampered = recomputeSnapshotTotalsFromEmbeddedValues({
      ...snap,
      promptTokens: 15_000,
      standardInputTokens: 10_000,
      cacheReadTokens: 5_000,
      billingReferenceCacheReadUsdPerMillion: 0.5,
    });
    assert.equal(snap.applicability.cacheSemanticStatus, "unverified");
    assert.equal(isPublishedUserChargeSnapshot(tampered), true);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(tampered), false);
  });

  it("G37 self-consistent cache snapshot → live-grade false (unknown policy)", () => {
    const snap = requireCompleteSnapshot("gemini-3.7-flash", 10_000, 500);
    const tampered = recomputeSnapshotTotalsFromEmbeddedValues({
      ...snap,
      promptTokens: 15_000,
      standardInputTokens: 10_000,
      cacheReadTokens: 5_000,
      billingReferenceCacheReadUsdPerMillion: 0.1,
    });
    assert.equal(snap.applicability.cacheSemanticStatus, "unknown");
    assert.equal(isPublishedUserChargeSnapshot(tampered), true);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(tampered), false);
  });

  it("valid Opus5 cache snapshot → live-grade true", () => {
    const snap = requireCompleteSnapshot("claude-opus-5", 10_000, 500, { read: 5_000, write: 1_000 });
    assert.equal(snap.applicability.cacheSemanticStatus, "verified_5m");
    assert.equal(isLiveGradePublishedUserChargeSnapshot(snap), true);
  });

  it("policy tampering without internal coherence → live-grade false", () => {
    const snap = requireCompleteSnapshot("gemini-3.1-pro-preview", 10_000, 500);
    const withCache = recomputeSnapshotTotalsFromEmbeddedValues({
      ...snap,
      promptTokens: 15_000,
      standardInputTokens: 10_000,
      cacheReadTokens: 5_000,
      billingReferenceCacheReadUsdPerMillion: 0.5,
    });
    assert.equal(isLiveGradePublishedUserChargeSnapshot(withCache), false);
    const policyTampered = {
      ...withCache,
      applicability: {
        ...withCache.applicability,
        cacheSemanticStatus: "verified" as const,
      },
      billingReferenceCacheReadUsdPerMillion: null,
    };
    assert.equal(isLiveGradePublishedUserChargeSnapshot(policyTampered), false);
  });

  it("historical snapshot validation uses embedded policy not current map", () => {
    const snap = requireCompleteSnapshot("gemini-3.1-pro-preview", 40_689, 4_307);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(snap), true);
    const stricterEmbedded = {
      ...snap,
      applicability: {
        ...snap.applicability,
        pricingApplicability: "base_tier_only" as const,
        publishedBaseTierMaxPromptTokens: 1000,
      },
    };
    assert.equal(isLiveGradePublishedUserChargeSnapshot(stricterEmbedded), false);
  });

  it("non-ISO publishedAt → structure validation false", () => {
    const snap = requireCompleteSnapshot("gemini-3.1-pro-preview", 40_689, 4_307);
    const looseDate = { ...snap, publishedAt: "2026-08-28" };
    assert.equal(isPublishedUserChargeSnapshot(looseDate), false);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(looseDate), false);
  });

  it("diagnostic snapshot can differ from live-grade (partial coverage tolerated structurally)", () => {
    const snap = requireCompleteSnapshot("gemini-3.7-flash", 24_952, 2_367);
    const diagnostic = { ...snap, usageCoverage: "partial" as const };
    assert.equal(isPublishedUserChargeSnapshot(diagnostic), true);
    assert.equal(isLiveGradePublishedUserChargeSnapshot(diagnostic), false);
  });
});

describe("publishedUserCharge — raw usage normalization policy audit", () => {
  it("fractional raw tokens are silently floored at normalize time", () => {
    const u = normalizeBillableUsage({
      modelId: "gemini-3.7-flash",
      promptTokens: 1000.9,
      outputTokens: 500,
    });
    assert.equal(u.promptTokens, 1000);
  });

  it("negative raw tokens are silently clamped to zero at normalize time", () => {
    const u = normalizeBillableUsage({
      modelId: "gemini-3.7-flash",
      promptTokens: -5,
      outputTokens: 500,
    });
    assert.equal(u.promptTokens, 0);
  });

  it("engine rejects fractional tokens after normalization tamper", () => {
    const u = usage("gemini-3.7-flash", 1000, 500);
    u.promptTokens = 1000.5;
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
