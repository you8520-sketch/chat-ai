import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import { computeTurnBilling } from "@/lib/points";
import {
  billableOpenRouterOutputTokens,
  resolveRouteApiTokensForCost,
  resolveTurnBillableInput,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
} from "@/lib/stageBillableUsage";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import {
  resolveLivePricingCompletionBasis,
  resolveLivePricingPromptBasis,
} from "@/lib/turnBillableUsageBasis";
import { compareTurnBillableUsageWithLegacy } from "@/lib/turnBillableUsageCanary";

const FX_1530: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

function stage(partial: Partial<StageUsage> & Pick<StageUsage, "stage" | "model" | "input" | "output">): StageUsage {
  return { estimated: false, ...partial };
}

/** LEVEL 1 — mirrors route.ts inline legacy assembly. */
function resolveLegacyRouteUsageBasis(opts: {
  stages: StageUsage[];
  modelId: string;
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
}) {
  const billableStages = selectBillableStages(opts.stages, {
    refusalFallbackDelivered: opts.refusalFallbackDelivered ?? false,
  });
  const primaryStage = billableStages[0];
  const summedApiOutput = sumOpenRouterStageOutputTokens(opts.stages);
  const summedApiReasoning = sumOpenRouterStageReasoningTokens(opts.stages);
  const apiTokens = resolveRouteApiTokensForCost(primaryStage, summedApiOutput);
  const routeTotalInput = resolveTurnBillableInput({
    stageInput: primaryStage?.input ?? 0,
    promptAuditTotal: opts.promptAuditTotal ?? undefined,
  });
  const routeChargeOutput = billableOpenRouterOutputTokens(
    opts.modelId,
    apiTokens.apiCompletionTokensForCost,
    summedApiReasoning
  );
  return {
    selectedStage: primaryStage?.stage ?? null,
    stageInput: primaryStage?.input ?? 0,
    routeTotalInput,
    apiPromptTokensForCost: apiTokens.apiPromptTokensForCost,
    apiCompletionTokensForCost: apiTokens.apiCompletionTokensForCost,
    routeChargeOutput,
    reasoningTotal: summedApiReasoning,
    cacheRead: primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens ?? 0,
    cacheWrite: primaryStage?.cacheWriteTokens ?? 0,
    cacheReadReported:
      primaryStage?.cacheReadTokens != null || primaryStage?.cachedContentTokens != null,
    cacheWriteReported: primaryStage?.cacheWriteTokens != null,
  };
}

function assertLevel1Parity(opts: Parameters<typeof resolveLegacyRouteUsageBasis>[0]) {
  const legacy = resolveLegacyRouteUsageBasis(opts);
  const candidate = resolveTurnBillableUsage({
    stages: opts.stages,
    modelId: opts.modelId,
    refusalFallbackDelivered: opts.refusalFallbackDelivered,
    promptAuditTotal: opts.promptAuditTotal,
  });
  assert.equal(candidate.status, "resolved");
  assert.equal(candidate.usageCoverage, "complete", JSON.stringify(candidate.diagnostics));
  assert.equal(candidate.usage!.promptTokens, legacy.routeTotalInput);
  assert.equal(candidate.usage!.cacheReadTokens, legacy.cacheRead);
  assert.equal(candidate.usage!.cacheWriteTokens, legacy.cacheWrite);
  assert.equal(candidate.diagnostics.apiCompletionTokensForCost, legacy.apiCompletionTokensForCost);
  assert.equal(candidate.usage!.reasoningTokens, legacy.reasoningTotal);
  assert.equal(candidate.diagnostics.routeChargeOutputTokens, legacy.routeChargeOutput);

  const canary = compareTurnBillableUsageWithLegacy(candidate, {
    routeTotalInput: legacy.routeTotalInput,
    routeChargeOutput: legacy.routeChargeOutput,
    cacheReadTokens: legacy.cacheRead,
    cacheWriteTokens: legacy.cacheWrite,
    apiCompletionTotal: legacy.apiCompletionTokensForCost,
    reasoningTotal: legacy.reasoningTotal,
  });
  assert.equal(canary.status, "match");
}

describe("turnBillableUsage — effective billing basis (LEVEL 2)", () => {
  it("G37 live pricing prefers apiPromptTokensForCost over route totalInput", () => {
    const routeInput = 9000;
    const apiPromptLow = 9000;
    const apiPromptHigh = 30_000;
    const output = 2500;
    const routeBilling = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: routeInput,
      outputTokens: output,
      apiPromptTokens: apiPromptLow,
      apiCompletionTokens: output,
    });
    const apiBilling = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: routeInput,
      outputTokens: output,
      apiPromptTokens: apiPromptHigh,
      apiCompletionTokens: output,
    });
    assert.notEqual(routeBilling.total, apiBilling.total);
    assert.equal(
      resolveLivePricingPromptBasis(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, routeInput, apiPromptHigh),
      apiPromptHigh
    );
  });

  it("G31 live pricing uses route totalInput (apiPrompt override does not change charge)", () => {
    const routeInput = 9000;
    const apiPrompt = 12_000;
    const output = 4307;
    const routeBilling = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      inputTokens: routeInput,
      outputTokens: output,
      apiPromptTokens: routeInput,
      apiCompletionTokens: output,
    });
    const apiBilling = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      inputTokens: routeInput,
      outputTokens: output,
      apiPromptTokens: apiPrompt,
      apiCompletionTokens: output,
    });
    assert.equal(routeBilling.total, apiBilling.total);
    assert.equal(resolveLivePricingPromptBasis(OPENROUTER_GEMINI_31_PRO_MODEL, routeInput, apiPrompt), routeInput);
  });

  it("Opus5 live pricing prefers apiPrompt via unified-reasoning margins path", () => {
    const routeInput = 9000;
    const apiPrompt = 12_000;
    const output = 500;
    const routeBilling = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      inputTokens: routeInput,
      outputTokens: output,
      savedTextChars: 2000,
      apiPromptTokens: routeInput,
      apiCompletionTokens: output,
    });
    const apiBilling = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      inputTokens: routeInput,
      outputTokens: output,
      savedTextChars: 2000,
      apiPromptTokens: apiPrompt,
      apiCompletionTokens: output,
    });
    assert.notEqual(routeBilling.total, apiBilling.total);
    assert.equal(
      resolveLivePricingPromptBasis(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, routeInput, apiPrompt),
      apiPrompt
    );
  });

  it("adversarial A — stage 10k, api 12k, audit 9k", () => {
    const stages = [
      stage({
        stage: "primary",
        model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        input: 10_000,
        output: 2500,
        apiOutputTokens: 2500,
        apiReportedInputTokens: 12_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ];
    const legacy = resolveLegacyRouteUsageBasis({
      stages,
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptAuditTotal: 9000,
    });
    assert.equal(legacy.routeTotalInput, 9000);
    assert.equal(legacy.apiPromptTokensForCost, 12_000);
    const candidate = resolveTurnBillableUsage({
      stages,
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptAuditTotal: 9000,
    });
    assert.equal(candidate.diagnostics.routeTotalInput, 9000);
    assert.equal(candidate.diagnostics.livePricingPromptBasis, 12_000);
    assert.notEqual(candidate.diagnostics.routeTotalInput, candidate.diagnostics.livePricingPromptBasis);
  });
});

describe("turnBillableUsage — LEVEL 1 route parity (complete scenarios)", () => {
  it("S1 normal single-stage with explicit cache", () => {
    assertLevel1Parity({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 12_000,
          output: 900,
          apiOutputTokens: 900,
          cacheReadTokens: 500,
          cacheWriteTokens: 100,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    });
  });

  it("S2 refusal fallback", () => {
    assertLevel1Parity({
      stages: [
        stage({ stage: "primary-refused", model: OPENROUTER_QWEN_37_MAX_MODEL, input: 8000, output: 100 }),
        stage({
          stage: "fallback",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 9500,
          output: 700,
          apiOutputTokens: 700,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      refusalFallbackDelivered: true,
    });
  });

  it("S3 primary + recovery — recovery input not billed", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
        input: 10_000,
        output: 400,
        apiOutputTokens: 400,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      }),
      stage({
        stage: "server-under-length-recovery",
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
        input: 11_000,
        output: 350,
        apiOutputTokens: 350,
      }),
    ];
    assertLevel1Parity({ stages, modelId: OPENROUTER_GEMINI_31_PRO_MODEL });
    assert.equal(resolveLegacyRouteUsageBasis({ stages, modelId: OPENROUTER_GEMINI_31_PRO_MODEL }).routeTotalInput, 10_000);
  });

  it("S8 Muse reasoning-bearing output", () => {
    assertLevel1Parity({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_MUSE_SPARK_11_MODEL,
          input: 5000,
          output: 1200,
          apiOutputTokens: 1200,
          apiReasoningOutputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      ],
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
    });
  });

  it("S9 promptAudit cap", () => {
    assertLevel1Parity({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 15_000,
          output: 500,
          apiOutputTokens: 500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      promptAuditTotal: 12_000,
    });
  });
});

describe("turnBillableUsage — cache evidence", () => {
  it("C — absent cache fields → partial, not complete", () => {
    const r = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_GEMINI_31_PRO_MODEL,
          input: 5000,
          output: 400,
          apiOutputTokens: 400,
        }),
      ],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    assert.equal(r.status, "resolved");
    assert.equal(r.usageCoverage, "partial");
    assert.equal(r.diagnostics.cacheReadReported, false);
    assert.equal(r.diagnostics.fieldSources.cacheRead, "MISSING_AND_UNKNOWN");
  });

  it("D — explicit cache → complete when all evidence present", () => {
    const r = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_GEMINI_31_PRO_MODEL,
          input: 8000,
          output: 600,
          apiOutputTokens: 600,
          cacheReadTokens: 1000,
          cacheWriteTokens: 200,
        }),
      ],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    assert.equal(r.usageCoverage, "complete");
  });

  it("cache exceeds capped prompt → unavailable", () => {
    const r = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 5000,
          output: 400,
          apiOutputTokens: 400,
          cacheReadTokens: 4000,
          cacheWriteTokens: 2000,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      promptAuditTotal: 3000,
    });
    assert.equal(r.status, "unavailable");
    assert.equal(r.reason, "cache_exceeds_capped_prompt");
  });
});

describe("turnBillableUsage — partial/unknown scenarios", () => {
  it("estimated usage → partial", () => {
    const r = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 5000,
          output: 400,
          apiOutputTokens: 400,
          estimated: true,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    });
    assert.equal(r.usageCoverage, "partial");
  });

  it("missing API completion → unavailable (no text fallback in candidate)", () => {
    const r = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 5000,
          output: 0,
          apiOutputTokens: 0,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    });
    assert.equal(r.status, "unavailable");
    assert.equal(r.reason, "completion_api_missing");
  });
});

describe("turnBillableUsageCanary — structured comparison", () => {
  it("partial candidate → not_comparable (not silent match)", () => {
    const candidate = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_GEMINI_31_PRO_MODEL,
          input: 5000,
          output: 400,
          apiOutputTokens: 400,
        }),
      ],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    const result = compareTurnBillableUsageWithLegacy(candidate, {
      routeTotalInput: 5000,
      routeChargeOutput: 400,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiCompletionTotal: 400,
      reasoningTotal: 0,
    });
    assert.equal(result.status, "not_comparable");
  });
});

describe("publishedUserCharge — existing golden guards (not candidate integration)", () => {
  it("G37 A → 48P", () => {
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage: {
        promptTokens: 24_952,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        standardInputTokens: 24_952,
        visibleOutputTokens: 2367,
        reasoningTokens: 0,
        billableOutputTokens: 2367,
        reasoningAccounting: "none",
      },
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 48);
  });
});

describe("turnBillableUsage → Published (candidate integration)", () => {
  it("G31 complete fixture through resolveTurnBillableUsage", () => {
    const candidate = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_GEMINI_31_PRO_MODEL,
          input: 40_689,
          output: 4307,
          apiOutputTokens: 4307,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      ],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    assert.equal(candidate.status, "resolved");
    assert.equal(candidate.usageCoverage, "complete");
    const published = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.1-pro-preview",
      usage: candidate.usage!,
      usageCoverage: candidate.usageCoverage,
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(published.status, "complete");
    if (published.status === "complete") assert.equal(published.snapshot.finalPoints, 229);
  });

  it("G31 absent cache → partial blocks Published complete charge", () => {
    const candidate = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_GEMINI_31_PRO_MODEL,
          input: 40_689,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    assert.equal(candidate.usageCoverage, "partial");
    const published = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.1-pro-preview",
      usage: candidate.usage!,
      usageCoverage: candidate.usageCoverage,
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.notEqual(published.status, "complete");
  });
});

describe("turnBillableUsage — purity", () => {
  it("does not import @/lib/points from turnBillableUsage module graph", async () => {
    const mod = await import("@/lib/turnBillableUsage");
    assert.equal(typeof mod.resolveTurnBillableUsage, "function");
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./turnBillableUsage.ts", import.meta.url), "utf8")
    );
    assert.ok(!src.includes('from "@/lib/points"'));
    assert.ok(!src.includes("from '@/lib/points'"));
  });
});
