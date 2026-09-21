/**
 * Launch-gate audit — stable Phase2 direct-selected published billing failure policy.
 * PROVIDER_CALLS=0. Documents RED policy violation; desired invariant tests skipped pending product decision.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
  computeLiveChargeFromFixture,
  buildBillingLiveOwnerReadinessFixtures,
} from "@/lib/billingLiveOwnerReadinessAudit";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  resolveChatBillingContract,
  type ResolveChatBillingContractInput,
} from "@/lib/chatBillingContractDispatch";
import { computeOpenRouterTurnBilling } from "@/lib/points";
import { settleChatTurnBillingExactlyOnce } from "@/lib/chatBillingSettlement";
import Database from "better-sqlite3";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

function v41BlockedCacheWriteStage(upstreamUsd?: number): StageUsage {
  return {
    stage: "primary",
    model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    input: 10_000,
    output: 500,
    apiOutputTokens: 500,
    apiReportedInputTokens: 10_000,
    cacheWriteTokens: 128,
    cacheReadTokens: 0,
    estimated: false,
    ...(upstreamUsd != null ? { upstreamCostUsd: upstreamUsd } : {}),
    usageReportingEvidence: {
      cacheRead: "reported_valid",
      cacheWrite: "reported_valid",
      reasoning: "unreported",
    },
  };
}

function dispatchV41(
  stages: StageUsage[],
  opts?: Partial<ResolveChatBillingContractInput>
) {
  return resolveChatBillingContract({
    deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    stages,
    legacyFinalPoints: opts?.legacyFinalPoints ?? 999,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: FX,
    phase2DeepSeekPublishedBillingEnabled: true,
    ...opts,
  });
}

describe("stable published billing fail-closed — RED policy violation (current main / #994)", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("D — positive cacheWrite 128 → published blocked → legacy contract charges legacyFinalPoints", () => {
    const base = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-deepseek-normal")!;
    const stage = v41BlockedCacheWriteStage(0.012);
    const legacyPoints = computeLiveChargeFromFixture({
      ...base,
      stages: [stage],
      upstreamCostUsd: 0.012,
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      requestedSelectedAI: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    }).totalPoints;

    const decision = dispatchV41([stage], { legacyFinalPoints: legacyPoints });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "unsupported_cache_semantics");
    assert.equal(decision.telemetry.publishedCandidateStatus, "blocked");
    assert.equal(decision.telemetry.publishedBlockReason, "unsupported_cache_semantics");
    assert.equal(decision.points, legacyPoints);
    assert.ok(legacyPoints > 0, "procurement-coupled legacy BASE is non-zero");
  });

  it("V4 Pro — upstreamCostUsd swings legacy BASE when published blocked (procurement coupling)", () => {
    const stageLow = {
      stage: "primary" as const,
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      input: 33_247,
      output: 3_461,
      apiOutputTokens: 3_461,
      apiReportedInputTokens: 33_247,
      cacheWriteTokens: 128,
      cacheReadTokens: 0,
      estimated: false,
      upstreamCostUsd: 0.001,
      usageReportingEvidence: {
        cacheRead: "reported_valid" as const,
        cacheWrite: "reported_valid" as const,
        reasoning: "reported_valid" as const,
      },
    };
    const stageHigh = { ...stageLow, upstreamCostUsd: 0.05 };

    const lowLegacy = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 33_247,
      outputTokens: 3_461,
      apiPromptTokens: 33_247,
      apiCompletionTokens: 3_461,
      upstreamCostUsd: 0.001,
    }).total;
    const highLegacy = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 33_247,
      outputTokens: 3_461,
      apiPromptTokens: 33_247,
      apiCompletionTokens: 3_461,
      upstreamCostUsd: 0.05,
    }).total;

    assert.ok(highLegacy > lowLegacy, "legacy BASE varies with upstreamCostUsd for V4 Pro CI");

    const lowDecision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      stages: [stageLow],
      legacyFinalPoints: lowLegacy,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    const highDecision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      stages: [stageHigh],
      legacyFinalPoints: highLegacy,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase2DeepSeekPublishedBillingEnabled: true,
    });

    assert.equal(lowDecision.contract, "legacy");
    assert.equal(highDecision.contract, "legacy");
    assert.equal(lowDecision.points, lowLegacy);
    assert.equal(highDecision.points, highLegacy);
    assert.notEqual(lowDecision.points, highDecision.points);
  });
});

describe.skip("stable published billing fail-closed — DESIRED invariant (STOP: product decision required)", () => {
  it("D/E/F — blocked or incomplete published attempt must NOT charge procurement-coupled legacy BASE", () => {
    void dispatchV41;
    assert.fail("Implement after canonical fail-closed policy is chosen");
  });

  it("G — legacy-only model (Terra) unchanged", () => {
    void CHEAPER_INFERENCE_GPT_56_TERRA_MODEL;
    assert.fail("Implement after canonical fail-closed policy is chosen");
  });

  it("I — settlement replay exactly once under fail-closed policy", () => {
    void settleChatTurnBillingExactlyOnce;
    void Database;
    assert.fail("Implement after canonical fail-closed policy is chosen");
  });
});
