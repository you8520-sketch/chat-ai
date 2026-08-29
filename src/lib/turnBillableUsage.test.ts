import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import {
  billableOpenRouterOutputTokens,
  billableOutputTokens,
  resolveTurnBillableInput,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
} from "@/lib/points";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
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

/** Mirrors route.ts inline legacy assembly (lines ~4059–4268). */
function resolveLegacyLiveTurnUsageBasis(opts: {
  stages: StageUsage[];
  modelId: string;
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
  savedText?: string;
  targetResponseChars?: number | null;
}) {
  const billableStages = selectBillableStages(opts.stages, {
    refusalFallbackDelivered: opts.refusalFallbackDelivered ?? false,
  });
  const primaryStage = billableStages[0];
  const stageBillableInput = primaryStage?.input ?? 0;
  const summedApiOutput = sumOpenRouterStageOutputTokens(opts.stages);
  const summedApiReasoning = sumOpenRouterStageReasoningTokens(opts.stages);
  const opusApiOutputTokens =
    summedApiOutput > 0
      ? summedApiOutput
      : primaryStage?.apiOutputTokens ?? primaryStage?.output ?? 0;
  const billableApiOutputTokens = billableOpenRouterOutputTokens(
    opts.modelId,
    opusApiOutputTokens,
    summedApiReasoning
  );
  const totalInput = resolveTurnBillableInput({
    stageInput: stageBillableInput,
    promptAuditTotal: opts.promptAuditTotal ?? undefined,
  });
  const totalOutput =
    billableApiOutputTokens > 0
      ? billableApiOutputTokens
      : billableOutputTokens(
          primaryStage?.apiOutputTokens ?? 0,
          opts.savedText ?? "",
          opts.targetResponseChars ?? null
        );
  return {
    selectedStage: primaryStage?.stage ?? null,
    legacyBillablePrompt: totalInput,
    legacyCacheRead: primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens ?? 0,
    legacyCacheWrite: primaryStage?.cacheWriteTokens ?? 0,
    legacyApiCompletionTotal: opusApiOutputTokens,
    legacyReasoningTotal: summedApiReasoning,
    legacyContentOutput: billableApiOutputTokens,
    legacyChargeOutput: totalOutput,
  };
}

function assertCompleteParity(opts: {
  stages: StageUsage[];
  modelId: string;
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
  savedText?: string;
  targetResponseChars?: number | null;
}) {
  const legacy = resolveLegacyLiveTurnUsageBasis(opts);
  const candidate = resolveTurnBillableUsage({
    stages: opts.stages,
    modelId: opts.modelId,
    refusalFallbackDelivered: opts.refusalFallbackDelivered,
    promptAuditTotal: opts.promptAuditTotal,
    savedText: opts.savedText,
    targetResponseChars: opts.targetResponseChars,
  });
  assert.equal(candidate.status, "resolved", JSON.stringify(candidate));
  assert.equal(candidate.usageCoverage, "complete", JSON.stringify(candidate.diagnostics));

  assert.equal(candidate.usage!.promptTokens, legacy.legacyBillablePrompt);
  assert.equal(candidate.usage!.cacheReadTokens, legacy.legacyCacheRead);
  assert.equal(candidate.usage!.cacheWriteTokens, legacy.legacyCacheWrite);
  assert.equal(candidate.diagnostics.apiCompletionTotalTokens, legacy.legacyApiCompletionTotal);
  assert.equal(candidate.usage!.reasoningTokens, legacy.legacyReasoningTotal);
  assert.equal(candidate.diagnostics.legacyChargeOutputTokens, legacy.legacyChargeOutput);

  const mismatches = compareTurnBillableUsageWithLegacy(candidate, {
    totalInput: legacy.legacyBillablePrompt,
    totalOutput: legacy.legacyChargeOutput,
    cacheReadTokens: legacy.legacyCacheRead,
    cacheWriteTokens: legacy.legacyCacheWrite,
    apiCompletionTotal: legacy.legacyApiCompletionTotal,
    reasoningTotal: legacy.legacyReasoningTotal,
  });
  assert.deepEqual(mismatches, []);
}

const HEALTHY_PROSE =
  "가".repeat(50) +
  " 그는 조용히 고개를 들었다. 창밖의 바람이 차갑게 스쳤다. 발걸음을 옮기며 숨을 고른다.";

describe("turnBillableUsage — legacy parity scenarios", () => {
  it("S1 — normal single-stage success", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 12_000,
        output: 900,
        apiOutputTokens: 900,
        cacheReadTokens: 500,
        cacheWriteTokens: 100,
      }),
    ];
    assertCompleteParity({ stages, modelId: OPENROUTER_QWEN_37_MAX_MODEL });
  });

  it("S2 — refusal fallback delivered", () => {
    const stages = [
      stage({ stage: "primary-refused", model: OPENROUTER_QWEN_37_MAX_MODEL, input: 8000, output: 100 }),
      stage({
        stage: "fallback",
        model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        input: 9500,
        output: 700,
        apiOutputTokens: 700,
      }),
    ];
    assertCompleteParity({
      stages,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      refusalFallbackDelivered: true,
    });
    const legacy = resolveLegacyLiveTurnUsageBasis({
      stages,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      refusalFallbackDelivered: true,
    });
    assert.equal(legacy.selectedStage, "fallback");
    assert.equal(legacy.legacyBillablePrompt, 9500);
  });

  it("S3 — primary + under-length recovery success", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_GEMINI_36_FLASH_MODEL,
        input: 10_000,
        output: 400,
        apiOutputTokens: 400,
      }),
      stage({
        stage: "server-under-length-recovery",
        model: OPENROUTER_GEMINI_36_FLASH_MODEL,
        input: 11_000,
        output: 350,
        apiOutputTokens: 350,
      }),
    ];
    assertCompleteParity({ stages, modelId: OPENROUTER_GEMINI_36_FLASH_MODEL });
    const legacy = resolveLegacyLiveTurnUsageBasis({ stages, modelId: OPENROUTER_GEMINI_36_FLASH_MODEL });
    assert.equal(legacy.legacyBillablePrompt, 10_000);
    assert.equal(legacy.legacyApiCompletionTotal, 750);
  });

  it("S4 — primary + narrative continuation success", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
        input: 20_000,
        output: 1500,
        apiOutputTokens: 1500,
      }),
      stage({
        stage: "narrative-length-continuation",
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
        input: 22_000,
        output: 800,
        apiOutputTokens: 800,
      }),
    ];
    assertCompleteParity({ stages, modelId: OPENROUTER_GEMINI_31_PRO_MODEL });
    const legacy = resolveLegacyLiveTurnUsageBasis({ stages, modelId: OPENROUTER_GEMINI_31_PRO_MODEL });
    assert.equal(legacy.legacyBillablePrompt, 20_000);
    assert.equal(legacy.legacyApiCompletionTotal, 2300);
  });

  it("S5 — continuation failure after primary (primary only in stages)", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 8000,
        output: 600,
        apiOutputTokens: 600,
      }),
    ];
    assertCompleteParity({ stages, modelId: OPENROUTER_QWEN_37_MAX_MODEL });
  });

  it("S8 — reasoning-bearing output (Muse content/reasoning split)", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_MUSE_SPARK_11_MODEL,
        input: 5000,
        output: 1200,
        apiOutputTokens: 1200,
        apiReasoningOutputTokens: 200,
      }),
    ];
    assertCompleteParity({ stages, modelId: OPENROUTER_MUSE_SPARK_11_MODEL });
    const legacy = resolveLegacyLiveTurnUsageBasis({ stages, modelId: OPENROUTER_MUSE_SPARK_11_MODEL });
    assert.equal(legacy.legacyApiCompletionTotal, 1200);
    assert.equal(legacy.legacyReasoningTotal, 200);
    assert.equal(legacy.legacyContentOutput, 1000);
    assert.equal(legacy.legacyChargeOutput, 1000);
  });

  it("S9 — promptAudit cap", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        input: 15_000,
        output: 500,
        apiOutputTokens: 500,
      }),
    ];
    assertCompleteParity({
      stages,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      promptAuditTotal: 12_000,
    });
    const legacy = resolveLegacyLiveTurnUsageBasis({
      stages,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      promptAuditTotal: 12_000,
    });
    assert.equal(legacy.legacyBillablePrompt, 12_000);
  });

  it("S10 — cache-bearing primary", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
        input: 8000,
        output: 600,
        apiOutputTokens: 600,
        cacheReadTokens: 3000,
        cacheWriteTokens: 500,
      }),
    ];
    assertCompleteParity({ stages, modelId: OPENROUTER_GEMINI_31_PRO_MODEL });
  });
});

describe("turnBillableUsage — coverage semantics", () => {
  it("S6 — empty stages → unavailable unknown", () => {
    const r = resolveTurnBillableUsage({ stages: [], modelId: OPENROUTER_QWEN_37_MAX_MODEL });
    assert.equal(r.status, "unavailable");
    assert.equal(r.usageCoverage, "unknown");
  });

  it("S7 — estimated StageUsage → partial coverage", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 400,
        apiOutputTokens: 400,
        estimated: true,
      }),
    ];
    const r = resolveTurnBillableUsage({ stages, modelId: OPENROUTER_QWEN_37_MAX_MODEL });
    assert.equal(r.status, "resolved");
    assert.equal(r.usageCoverage, "partial");
  });

  it("text fallback output → partial coverage", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 0,
        apiOutputTokens: 0,
      }),
    ];
    const r = resolveTurnBillableUsage({
      stages,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      savedText: HEALTHY_PROSE,
    });
    assert.equal(r.status, "resolved");
    assert.equal(r.usageCoverage, "partial");
    assert.ok(r.diagnostics.legacyChargeOutputTokens > 0);
  });

  it("cache exceeds capped prompt → unavailable (not silently complete)", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 400,
        apiOutputTokens: 400,
        cacheReadTokens: 4000,
        cacheWriteTokens: 2000,
      }),
    ];
    const r = resolveTurnBillableUsage({
      stages,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      promptAuditTotal: 3000,
    });
    assert.equal(r.status, "unavailable");
    assert.equal(r.usageCoverage, "unknown");
    assert.equal(r.reason, "cache_exceeds_capped_prompt");
  });

  it("sanitized malformed prompt → unavailable or partial, never complete", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: -100 as unknown as number,
        output: 400,
        apiOutputTokens: 400,
      }),
    ];
    const r = resolveTurnBillableUsage({ stages, modelId: OPENROUTER_QWEN_37_MAX_MODEL });
    assert.notEqual(r.usageCoverage, "complete");
  });

  it("USER_COVERAGE does not reuse ActualTurnCostCoverage", () => {
    const r = resolveTurnBillableUsage({
      stages: [stage({ stage: "primary", model: OPENROUTER_QWEN_37_MAX_MODEL, input: 1000, output: 100, apiOutputTokens: 100 })],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    });
    assert.equal(r.status, "resolved");
    assert.ok(r.usageCoverage === "complete" || r.usageCoverage === "partial");
  });
});

describe("turnBillableUsage — regression guards", () => {
  it("R1/R2 continuation and recovery input not added to user prompt", () => {
    const stages = [
      stage({ stage: "primary", model: OPENROUTER_QWEN_37_MAX_MODEL, input: 5000, output: 400, apiOutputTokens: 400 }),
      stage({
        stage: "narrative-length-continuation",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 9000,
        output: 300,
        apiOutputTokens: 300,
      }),
    ];
    const r = resolveTurnBillableUsage({ stages, modelId: OPENROUTER_QWEN_37_MAX_MODEL });
    assert.equal(r.status, "resolved");
    assert.equal(r.usage!.promptTokens, 5000);
  });

  it("R3 secondary stage cache not added", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 400,
        apiOutputTokens: 400,
        cacheReadTokens: 100,
      }),
      stage({
        stage: "narrative-length-continuation",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 6000,
        output: 200,
        apiOutputTokens: 200,
        cacheReadTokens: 9999,
      }),
    ];
    const r = resolveTurnBillableUsage({ stages, modelId: OPENROUTER_QWEN_37_MAX_MODEL });
    assert.equal(r.usage!.cacheReadTokens, 100);
  });

  it("R4 reasoning not double-counted in normalized usage", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 1200,
        apiOutputTokens: 1200,
        apiReasoningOutputTokens: 200,
      }),
    ];
    const r = resolveTurnBillableUsage({ stages, modelId: OPENROUTER_QWEN_37_MAX_MODEL });
    assert.equal(r.usage!.reasoningAccounting, "included_in_output");
    assert.equal(r.usage!.billableOutputTokens, r.usage!.visibleOutputTokens);
  });

  it("R5 fallback failed-primary input excluded", () => {
    const stages = [
      stage({ stage: "primary-refused", model: OPENROUTER_QWEN_37_MAX_MODEL, input: 20_000, output: 50 }),
      stage({ stage: "fallback", model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, input: 8000, output: 500, apiOutputTokens: 500 }),
    ];
    const r = resolveTurnBillableUsage({
      stages,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      refusalFallbackDelivered: true,
    });
    assert.equal(r.usage!.promptTokens, 8000);
  });
});

describe("turnBillableUsage — Published integration (frozen goldens)", () => {
  it("G37 A → 48P via candidate complete usage", () => {
    const usage = normalizeBillableUsage({
      modelId: "gemini-3.7-flash",
      promptTokens: 24_952,
      outputTokens: 2_367,
    });
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 48);
  });

  it("G37 B → 80P", () => {
    const usage = normalizeBillableUsage({
      modelId: "gemini-3.7-flash",
      promptTokens: 42_195,
      outputTokens: 3_862,
    });
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.7-flash",
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 80);
  });

  it("G31 → 229P", () => {
    const usage = normalizeBillableUsage({
      modelId: "gemini-3.1-pro-preview",
      promptTokens: 40_689,
      outputTokens: 4_307,
    });
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "gemini-3.1-pro-preview",
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 229);
  });

  it("Opus5 → 695P", () => {
    const usage = normalizeBillableUsage({
      modelId: "claude-opus-5",
      promptTokens: 63_749,
      outputTokens: 3_629,
    });
    const r = computePublishedUserChargeWithSnapshot({
      modelId: "claude-opus-5",
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_1530,
      adjustment: { kind: "none" },
    });
    assert.equal(r.status, "complete");
    if (r.status === "complete") assert.equal(r.snapshot.finalPoints, 695);
  });
});
