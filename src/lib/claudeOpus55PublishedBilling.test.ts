import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import {
  isPhase1PublishedBillingModel,
  resolveChatBillingContract,
} from "@/lib/chatBillingContractDispatch";
import type { StageUsage } from "@/lib/ai";

function completePrimaryStage(modelId: string, input: number, output: number): StageUsage {
  return {
    stage: "primary",
    model: modelId,
    input,
    output,
    apiOutputTokens: output,
    apiReportedInputTokens: input,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimated: false,
    usageReportingEvidence: {
      cacheRead: "reported_valid",
      cacheWrite: "reported_valid",
      reasoning: "reported_valid",
    },
  };
}
import {
  deriveAnthropicListProductTargetMarginForRealizedProcurementMargin,
  OPUS55_LIVE_REALIZED_NO_CACHE_PROCUREMENT_GROSS_MARGIN,
  opus55ProcurementToListRatio,
} from "@/lib/opus55PublishedPricingDerivation";
import { resolveOpus55CiNoCacheProcurementKrw } from "@/lib/opus55RealizedProcurementMargin";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import { computePublishedUserChargeFromResolvedPolicy } from "@/lib/publishedUserCharge";
import { KOREAN_CHARS_PER_OUTPUT_TOKEN } from "@/lib/responseLengthConstants";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-22",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

function livePublishedCharge(
  promptTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
) {
  const resolved = resolvePublishedPricingExact(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
  assert.ok(resolved);
  const usage = normalizeBillableUsage({
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    promptTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });
  return computePublishedUserChargeFromResolvedPolicy({
    requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    resolvedPricing: resolved,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX,
    adjustment: { kind: "none" },
  });
}

function realizedMarginPercent(chargeKrw: number, procKrw: number): number {
  return ((chargeKrw - procKrw) / chargeKrw) * 100;
}

describe("Opus 5.5 published pricing derivation", () => {
  it("procurement/list ratio is exactly 0.70", () => {
    assert.equal(opus55ProcurementToListRatio(), 0.7);
  });

  it("Anthropic-list equivalent PRODUCT targetMargin is 1/14 (~7.14%) for 35% realized procurement", () => {
    const m = deriveAnthropicListProductTargetMarginForRealizedProcurementMargin(
      OPUS55_LIVE_REALIZED_NO_CACHE_PROCUREMENT_GROSS_MARGIN
    );
    assert.ok(m > 0);
    assert.ok(Math.abs(m - 1 / 14) < 1e-12);
  });
});

describe("Opus 5.5 live golden fixtures (canonical published path)", () => {
  it("Golden A: 73,763 / 5,334 → 676P @ ~35% realized procurement margin", () => {
    const charge = livePublishedCharge(73_763, 5_334);
    assert.equal(charge.status, "complete");
    assert.equal(charge.snapshot.finalPoints, 676);
    const proc = resolveOpus55CiNoCacheProcurementKrw({
      promptTokens: 73_763,
      outputTokens: 5_334,
      fxSnapshot: FX,
    });
    assert.ok(proc != null);
    const margin = realizedMarginPercent(charge.snapshot.finalUserChargeKrw, proc);
    assert.ok(Math.abs(margin - 35) < 0.5);
  });

  it("Golden B: 58,654 / 4,644 → 551P @ ~35% realized procurement margin", () => {
    const charge = livePublishedCharge(58_654, 4_644);
    assert.equal(charge.status, "complete");
    assert.equal(charge.snapshot.finalPoints, 551);
    const proc = resolveOpus55CiNoCacheProcurementKrw({
      promptTokens: 58_654,
      outputTokens: 4_644,
      fxSnapshot: FX,
    });
    assert.ok(proc != null);
    const margin = realizedMarginPercent(charge.snapshot.finalUserChargeKrw, proc);
    assert.ok(Math.abs(margin - 35) < 0.5);
  });
});

describe("Opus 5.5 USER P cache determinism (live published path)", () => {
  it("same total prompt/output with cache read split → identical P", () => {
    const a = livePublishedCharge(73_763, 5_334, 0, 0);
    const b = livePublishedCharge(73_763, 5_334, 50_000, 0);
    assert.equal(a.status, "complete");
    assert.equal(b.status, "complete");
    assert.equal(b.snapshot.finalPoints, a.snapshot.finalPoints);
  });
});

describe("Opus 5.5 billing dispatch + picker", () => {
  it("is Phase 1 published billing model", () => {
    assert.equal(isPhase1PublishedBillingModel(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL), true);
  });

  it("resolves published_phase1 when phase1 gate ON (676P, not legacy)", () => {
    const stages = [completePrimaryStage(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, 73_763, 5_334)];
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      stages,
      legacyFinalPoints: 9999,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase1PublishedBillingEnabled: true,
      phase2DeepSeekPublishedBillingEnabled: false,
    });
    assert.equal(decision.contract, "published_phase1");
    assert.equal(decision.points, 676);
    assert.notEqual(decision.points, 9999);
  });

  it("phase1 gate OFF still uses published_phase1 (legacy impossible)", () => {
    const stages = [completePrimaryStage(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, 73_763, 5_334)];
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      stages,
      legacyFinalPoints: 9999,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase1PublishedBillingEnabled: false,
      phase2DeepSeekPublishedBillingEnabled: false,
    });
    assert.notEqual(decision.contract, "legacy");
    assert.equal(decision.contract, "published_phase1");
    assert.equal(decision.points, 676);
  });

  it("is on Main RP picker after rollout wiring", () => {
    assert.ok(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL)
    );
  });
});

describe("Opus 5.5 representative char presets", () => {
  const workloads = [
    { prompt: 15_000, chars: 1500 },
    { prompt: 25_000, chars: 2500 },
    { prompt: 35_000, chars: 3500 },
    { prompt: 45_000, chars: 4360 },
    { prompt: 75_000, chars: 5000 },
  ] as const;

  for (const row of workloads) {
    it(`${row.prompt} prompt / ${row.chars} chars — live charge + realized margin`, () => {
      const outputTokens = Math.round(row.chars / KOREAN_CHARS_PER_OUTPUT_TOKEN);
      const charge = livePublishedCharge(row.prompt, outputTokens);
      assert.equal(charge.status, "complete");
      const proc = resolveOpus55CiNoCacheProcurementKrw({
        promptTokens: row.prompt,
        outputTokens,
        fxSnapshot: FX,
      });
      assert.ok(proc != null);
      const margin = realizedMarginPercent(charge.snapshot.finalUserChargeKrw, proc);
      assert.ok(margin >= 34);
    });
  }
});
