import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
} from "@/lib/chatModels";
import { resolveChatBillingContract } from "@/lib/chatBillingContractDispatch";
import { isPublishedCacheBreakdownPriceNeutral } from "@/lib/modelPublishedPricingPolicy";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-10-08",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;

function solStage(overrides: Partial<StageUsage> = {}): StageUsage {
  return {
    stage: "primary",
    model: SOL,
    input: 17_104,
    output: 2_726,
    apiOutputTokens: 2_726,
    apiReportedInputTokens: 17_104,
    estimated: false,
    ...overrides,
  };
}

function dispatchSol(stages: StageUsage[]) {
  return resolveChatBillingContract({
    deliveredModelId: SOL,
    selectedModelId: SOL,
    stages,
    legacyFinalPoints: 999,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: FX,
    phase1PublishedBillingEnabled: true,
  });
}

describe("cache-neutral usage coverage through resolveChatBillingContract", () => {
  it("published models treat cache partition as price-neutral", () => {
    assert.equal(isPublishedCacheBreakdownPriceNeutral(SOL), true);
    assert.equal(isPublishedCacheBreakdownPriceNeutral(GEMINI_38_FLASH_MODEL), true);
    assert.equal(isPublishedCacheBreakdownPriceNeutral(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), true);
    assert.equal(isPublishedCacheBreakdownPriceNeutral(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL), true);
  });

  it("Sol normal input/output + unreported cache read stays Standard published P", () => {
    const decision = dispatchSol([
      solStage({
        usageReportingEvidence: {
          cacheRead: "unreported",
          cacheWrite: "reported_valid",
          reasoning: "unreported",
        },
        cacheWriteTokens: 0,
      }),
    ]);
    assert.equal(decision.contract, "published_phase1");
    assert.ok(decision.points > 0);
    assert.notEqual(decision.points, 999);
  });

  it("Sol normal input/output + unreported cache write stays Standard published P", () => {
    const decision = dispatchSol([
      solStage({
        usageReportingEvidence: {
          cacheRead: "reported_valid",
          cacheWrite: "unreported",
          reasoning: "unreported",
        },
        cacheReadTokens: 0,
      }),
    ]);
    assert.equal(decision.contract, "published_phase1");
    assert.ok(decision.points > 0);
  });

  it("Sol cache buckets above capped prompt stay Standard P", () => {
    const miss = dispatchSol([solStage({ cacheReadTokens: 0, cacheWriteTokens: 0 })]);
    const over = dispatchSol([
      solStage({
        cacheReadTokens: 20_000,
        cacheWriteTokens: 1_000,
        usageReportingEvidence: {
          cacheRead: "reported_valid",
          cacheWrite: "reported_valid",
          reasoning: "unreported",
        },
      }),
    ]);
    const usage = resolveTurnBillableUsage({
      stages: [
        solStage({
          cacheReadTokens: 20_000,
          cacheWriteTokens: 1_000,
          usageReportingEvidence: {
            cacheRead: "reported_valid",
            cacheWrite: "reported_valid",
            reasoning: "unreported",
          },
        }),
      ],
      modelId: SOL,
      promptAuditTotal: 10_000,
    });
    assert.equal(over.contract, "published_phase1");
    assert.equal(over.points, miss.points);
    assert.equal(usage.status, "resolved");
    assert.equal(usage.usageCoverage, "complete");
    assert.ok(usage.diagnostics.coverageReasons.includes("cache_exceeds_capped_prompt"));
  });

  it("same Sol input/output miss/read/write keep the same user P", () => {
    const miss = dispatchSol([solStage({ cacheReadTokens: 0, cacheWriteTokens: 0 })]);
    const read = dispatchSol([
      solStage({
        cacheReadTokens: 8_000,
        cacheWriteTokens: 0,
        usageReportingEvidence: {
          cacheRead: "reported_valid",
          cacheWrite: "reported_valid",
          reasoning: "unreported",
        },
      }),
    ]);
    const write = dispatchSol([
      solStage({
        cacheReadTokens: 0,
        cacheWriteTokens: 8_000,
        usageReportingEvidence: {
          cacheRead: "reported_valid",
          cacheWrite: "reported_valid",
          reasoning: "unreported",
        },
      }),
    ]);
    assert.equal(miss.contract, "published_phase1");
    assert.equal(read.points, miss.points);
    assert.equal(write.points, miss.points);
  });

  it("provider cache USD still differs for the same Sol tokens", () => {
    const miss = openRouterUsdCostFromRates({
      modelId: SOL,
      promptTokens: 17_104,
      outputTokens: 2_726,
    }).usdCost;
    const hit = openRouterUsdCostFromRates({
      modelId: SOL,
      promptTokens: 17_104,
      outputTokens: 2_726,
      cacheReadTokens: 8_000,
    }).usdCost;
    const write = openRouterUsdCostFromRates({
      modelId: SOL,
      promptTokens: 17_104,
      outputTokens: 2_726,
      cacheWriteTokens: 8_000,
    }).usdCost;
    assert.ok(hit < miss);
    assert.ok(write > miss);
  });

  it("missing Sol input/output still fail-closes", () => {
    const noStages = dispatchSol([]);
    assert.equal(noStages.contract, "published_fail_closed");
    assert.equal(noStages.points, 0);

    const noOutput = dispatchSol([
      solStage({
        output: 0,
        apiOutputTokens: 0,
      }),
    ]);
    assert.equal(noOutput.contract, "published_fail_closed");
    assert.equal(noOutput.points, 0);

    const estimated = dispatchSol([solStage({ estimated: true })]);
    assert.equal(estimated.contract, "published_fail_closed");
    assert.equal(estimated.points, 0);
  });

  it("OpenRouter Gemini reasoning normalization errors still fail-close coverage", () => {
    const usage = resolveTurnBillableUsage({
      stages: [
        {
          stage: "openRouterAdult",
          model: "google/gemini-3.1-pro-preview",
          input: 5000,
          output: 400,
          apiOutputTokens: 400,
          apiReportedInputTokens: 5000,
          apiReasoningOutputTokens: 6,
          estimated: false,
          usageReportingEvidence: {
            cacheRead: "reported_valid",
            cacheWrite: "reported_valid",
            reasoning: "reported_invalid",
          },
        },
      ],
      modelId: "google/gemini-3.1-pro-preview",
    });
    assert.equal(usage.diagnostics.fieldSources.reasoning, "SANITIZED_MALFORMED");
    assert.notEqual(usage.usageCoverage, "complete");
  });

  it("Gemini 3.8 / DeepSeek V4.1 / Opus 5.5 unreported cache still publish", () => {
    for (const modelId of [
      GEMINI_38_FLASH_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    ]) {
      const decision = resolveChatBillingContract({
        deliveredModelId: modelId,
        selectedModelId: modelId,
        stages: [
          {
            stage: "primary",
            model: modelId,
            input: 10_000,
            output: 800,
            apiOutputTokens: 800,
            apiReportedInputTokens: 10_000,
            estimated: false,
            usageReportingEvidence: {
              cacheRead: "unreported",
              cacheWrite: "unreported",
              reasoning: "unreported",
            },
          },
        ],
        legacyFinalPoints: 999,
        billingWaiverReason: null,
        legacyWaiverMinimum: 0,
        fxSnapshot: FX,
        phase1PublishedBillingEnabled: true,
        phase2DeepSeekPublishedBillingEnabled: true,
      });
      assert.ok(
        decision.contract === "published_phase1" || decision.contract === "published_phase2",
        modelId
      );
      assert.ok(decision.points > 0, modelId);
    }
  });
});
