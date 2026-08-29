import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import { computeTurnBilling } from "@/lib/points";
import { parseOpenRouterUsage, parseReasoningTokens, tokenUsageFromOpenRouterBreakdown } from "@/lib/openRouterUsage";
import type { TokenUsage } from "@/lib/tokenUsage";
import {
  billableOpenRouterOutputTokens,
  resolveRouteApiTokensForCost,
  resolveTurnBillableInput,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
} from "@/lib/stageBillableUsage";
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

const FORBIDDEN_CANDIDATE_IMPORT_PATTERNS = [
  "@/lib/points",
  "@/lib/pointsReasoningMargins",
  "@/lib/pointsMuse60",
  "@/lib/gemini37FlashPricing",
  "@/lib/exchangeRate",
  "@/lib/publishedUserChargeEngine",
  "@/lib/publishedUserCharge",
  "@/lib/shadowPricing",
  "@/lib/db",
  "@/lib/database",
] as const;

function collectProductionImports(entryPath: string, visited = new Set<string>()): string[] {
  const abs = resolve(entryPath);
  if (visited.has(abs) || !existsSync(abs)) return [];
  visited.add(abs);

  const content = readFileSync(abs, "utf8");
  const imports: string[] = [];
  const importRe = /^import(?! type)\s[\s\S]*?\sfrom\s+["'](@\/[^"']+|\.[^"']*)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    const spec = match[1];
    imports.push(spec);
    if (spec.startsWith("@/")) {
      const rel = spec.slice(2);
      const candidates = [
        join(process.cwd(), "src", `${rel}.ts`),
        join(process.cwd(), "src", rel, "index.ts"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          imports.push(...collectProductionImports(candidate, visited));
          break;
        }
      }
    } else if (spec.startsWith(".")) {
      const base = resolve(abs, "..", spec);
      const candidates = [`${base}.ts`, join(base, "index.ts")];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          imports.push(...collectProductionImports(candidate, visited));
          break;
        }
      }
    }
  }
  return imports;
}

function stage(partial: Partial<StageUsage> & Pick<StageUsage, "stage" | "model" | "input" | "output">): StageUsage {
  return { estimated: false, ...partial };
}

/** Mirrors openRouterAdult.ts stage writer cache field forwarding (>0 only). */
function productionStageUsageFromTokenUsage(
  usage: TokenUsage,
  stageLabel: string,
  modelId: string
): StageUsage {
  return {
    stage: stageLabel,
    model: modelId,
    input: usage.inputTokens,
    output: usage.outputTokens,
    apiReportedInputTokens: usage.apiReportedInputTokens ?? usage.inputTokens,
    apiOutputTokens: usage.outputTokens,
    estimated: usage.estimated ?? false,
    ...(usage.cacheReadTokens != null && usage.cacheReadTokens > 0
      ? { cacheReadTokens: usage.cacheReadTokens }
      : {}),
    ...(usage.cacheWriteTokens != null && usage.cacheWriteTokens > 0
      ? { cacheWriteTokens: usage.cacheWriteTokens }
      : {}),
    ...(usage.reasoningOutputTokens != null && usage.reasoningOutputTokens > 0
      ? { apiReasoningOutputTokens: usage.reasoningOutputTokens }
      : {}),
  };
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

describe("turnBillableUsage — effective billing basis (LEVEL 2 via computeTurnBilling)", () => {
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
  });

  it("G31 OpenRouter live pricing uses route totalInput (apiPrompt override does not change charge)", () => {
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
  });

  it("G31 CI live pricing charge changes when apiPromptTokensForCost changes", () => {
    const routeInput = 9000;
    const output = 4307;
    const low = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      inputTokens: routeInput,
      outputTokens: output,
      apiPromptTokens: routeInput,
      apiCompletionTokens: output,
    });
    const high = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      inputTokens: routeInput,
      outputTokens: output,
      apiPromptTokens: 30_000,
      apiCompletionTokens: output,
    });
    assert.notEqual(low.total, high.total);
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
  });

  it("adversarial A — route totalInput vs apiPromptTokensForCost stay separate at LEVEL 1", () => {
    const stages = [
      stage({
        stage: "primary",
        model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        input: 10_000,
        output: 2500,
        apiOutputTokens: 2500,
        apiReportedInputTokens: 12_000,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
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
    assert.equal(candidate.diagnostics.apiPromptTokensForCost, 12_000);
    assert.notEqual(
      candidate.diagnostics.routeTotalInput,
      candidate.diagnostics.apiPromptTokensForCost
    );
    assert.equal("livePricingPromptBasis" in candidate.diagnostics, false);
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

  it("S2 refusal fallback with production-reachable positive cache", () => {
    assertLevel1Parity({
      stages: [
        stage({ stage: "primary-refused", model: OPENROUTER_QWEN_37_MAX_MODEL, input: 8000, output: 100 }),
        stage({
          stage: "fallback",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 9500,
          output: 700,
          apiOutputTokens: 700,
          cacheReadTokens: 200,
          cacheWriteTokens: 50,
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

  it("S8 Muse reasoning-bearing output with production-reachable positive cache", () => {
    assertLevel1Parity({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_MUSE_SPARK_11_MODEL,
          input: 5000,
          output: 1200,
          apiOutputTokens: 1200,
          apiReasoningOutputTokens: 200,
          cacheReadTokens: 300,
          cacheWriteTokens: 100,
        }),
      ],
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
    });
  });

  it("S9 promptAudit cap with production-reachable positive cache", () => {
    assertLevel1Parity({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 15_000,
          output: 500,
          apiOutputTokens: 500,
          cacheReadTokens: 400,
          cacheWriteTokens: 100,
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

describe("turnBillableUsage — cache production reachability", () => {
  it("absent raw cache fields are not forwarded to TokenUsage or StageUsage", () => {
    const parsed = parseOpenRouterUsage({ prompt_tokens: 100, completion_tokens: 50 });
    const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
    assert.equal("cacheReadTokens" in tokenUsage, false);
    assert.equal("cacheWriteTokens" in tokenUsage, false);

    const stageUsage = productionStageUsageFromTokenUsage(
      tokenUsage,
      "openRouterAdult",
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
    assert.equal(stageUsage.cacheReadTokens, undefined);
    assert.equal(stageUsage.cacheWriteTokens, undefined);
  });

  it("explicit provider zero is not preserved at StageUsage (PRODUCTION_STAGE_CAN_CONTAIN_EXPLICIT_ZERO_CACHE_FIELD=false)", () => {
    const parsed = parseOpenRouterUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    });
    assert.equal(parsed.cacheReadTokens, 0);
    assert.equal(parsed.cacheWriteTokens, 0);

    const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
    assert.equal("cacheReadTokens" in tokenUsage, false);
    assert.equal("cacheWriteTokens" in tokenUsage, false);

    const stageUsage = productionStageUsageFromTokenUsage(
      tokenUsage,
      "openRouterAdult",
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
    assert.equal(stageUsage.cacheReadTokens, undefined);
    assert.equal(stageUsage.cacheWriteTokens, undefined);
  });

  it("positive cache is forwarded to StageUsage", () => {
    const parsed = parseOpenRouterUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 3 },
    });
    const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
    const stageUsage = productionStageUsageFromTokenUsage(
      tokenUsage,
      "openRouterAdult",
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
    assert.equal(stageUsage.cacheReadTokens, 12);
    assert.equal(stageUsage.cacheWriteTokens, 3);
  });

  it("production no-cache stage shape yields partial candidate coverage", () => {
    const parsed = parseOpenRouterUsage({ prompt_tokens: 5000, completion_tokens: 400 });
    const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
    const stageUsage = productionStageUsageFromTokenUsage(
      tokenUsage,
      "openRouterAdult",
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
    const r = resolveTurnBillableUsage({
      stages: [stageUsage],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    assert.equal(r.usageCoverage, "partial");
    assert.equal(r.diagnostics.cacheReadReported, false);
    assert.equal(r.diagnostics.cacheWriteReported, false);
  });
});

describe("CURRENT_BEHAVIOR_CHARACTERIZATION — reasoning production reachability", () => {
  function resolveCandidateFromRawUsage(rawUsage: Record<string, unknown>) {
    const parsed = parseOpenRouterUsage(rawUsage);
    const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
    const stageUsage = productionStageUsageFromTokenUsage(
      tokenUsage,
      "openRouterAdult",
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
    stageUsage.apiOutputTokens = parsed.completionTokens;
    const candidate = resolveTurnBillableUsage({
      stages: [
        {
          ...stageUsage,
          cacheReadTokens: 100,
          cacheWriteTokens: 50,
        },
      ],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    return { parsed, tokenUsage, stageUsage, candidate };
  }

  it("A — reasoning field absent", () => {
    const raw = { prompt_tokens: 5000, completion_tokens: 400 };
    assert.equal(parseReasoningTokens(raw), 0);
    const { parsed, tokenUsage, stageUsage, candidate } = resolveCandidateFromRawUsage(raw);
    assert.equal(parsed.reasoningTokens, 0);
    assert.equal("reasoningOutputTokens" in tokenUsage, false);
    assert.equal(stageUsage.apiReasoningOutputTokens, undefined);
    assert.equal(candidate.diagnostics.reasoningReported, false);
    assert.equal(candidate.diagnostics.fieldSources.reasoning, "MISSING_AND_UNKNOWN");
    assert.equal(candidate.usage!.reasoningTokens, 0);
    assert.equal(candidate.usage!.reasoningAccounting, "none");
    assert.equal(candidate.usageCoverage, "complete");
  });

  it("B — reasoning field explicitly present as 0", () => {
    const raw = {
      prompt_tokens: 5000,
      completion_tokens: 400,
      completion_tokens_details: { reasoning_tokens: 0 },
    };
    assert.equal(parseReasoningTokens(raw), 0);
    const { parsed, tokenUsage, stageUsage, candidate } = resolveCandidateFromRawUsage(raw);
    assert.equal(parsed.reasoningTokens, 0);
    assert.equal("reasoningOutputTokens" in tokenUsage, false);
    assert.equal(stageUsage.apiReasoningOutputTokens, undefined);
    assert.equal(candidate.diagnostics.reasoningReported, false);
    assert.equal(candidate.diagnostics.fieldSources.reasoning, "MISSING_AND_UNKNOWN");
    assert.notEqual(candidate.diagnostics.fieldSources.reasoning, "MISSING_BUT_PROVEN_ZERO");
    assert.equal(candidate.usageCoverage, "complete");
  });

  it("C — reasoning field present > 0", () => {
    const raw = {
      prompt_tokens: 5000,
      completion_tokens: 400,
      completion_tokens_details: { reasoning_tokens: 120 },
    };
    assert.equal(parseReasoningTokens(raw), 120);
    const { parsed, tokenUsage, stageUsage, candidate } = resolveCandidateFromRawUsage(raw);
    assert.equal(parsed.reasoningTokens, 120);
    assert.equal(tokenUsage.reasoningOutputTokens, 120);
    assert.equal(stageUsage.apiReasoningOutputTokens, 120);
    assert.equal(candidate.diagnostics.reasoningReported, true);
    assert.equal(candidate.diagnostics.fieldSources.reasoning, "PROVIDER_REPORTED_EXACT");
    assert.equal(candidate.usage!.reasoningTokens, 120);
    assert.equal(candidate.usage!.reasoningAccounting, "included_in_output");
    assert.equal(candidate.usageCoverage, "complete");
  });

  it("PRODUCTION_STAGE_CAN_CONTAIN_EXPLICIT_ZERO_REASONING_FIELD is false", () => {
    const parsed = parseOpenRouterUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 0 },
    });
    const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
    const stageUsage = productionStageUsageFromTokenUsage(
      tokenUsage,
      "openRouterAdult",
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
    assert.equal(stageUsage.apiReasoningOutputTokens, undefined);
  });

  it("UNPROVEN_ZERO_SOURCE_COUNT is 0 — reasoning absent is not labeled proven zero", () => {
    const r = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 5000,
          output: 400,
          apiOutputTokens: 400,
          cacheReadTokens: 100,
          cacheWriteTokens: 50,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    });
    assert.equal(r.diagnostics.fieldSources.reasoning, "MISSING_AND_UNKNOWN");
    assert.notEqual(r.diagnostics.fieldSources.reasoning, "MISSING_BUT_PROVEN_ZERO");
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
          cacheReadTokens: 100,
          cacheWriteTokens: 50,
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

  it("unknown candidate → not_comparable (not silent match)", () => {
    const candidate = resolveTurnBillableUsage({
      stages: [],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    const result = compareTurnBillableUsageWithLegacy(candidate, {
      routeTotalInput: 0,
      routeChargeOutput: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiCompletionTotal: 0,
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

describe("turnBillableUsage → Published — SYNTHETIC_COMPLETE_CONTRACT (not production-reachable)", () => {
  it("explicit zero cache in stage fixture is synthetic — not emitted by production StageUsage writer", () => {
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
    assert.equal(candidate.diagnostics.cacheReadReported, true);
    assert.equal(candidate.diagnostics.cacheWriteReported, true);

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

describe("turnBillableUsage — diagnostics and purity", () => {
  it("diagnostics retain raw LEVEL-1 facts only (no live pricing policy fields)", () => {
    const candidate = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 5000,
          output: 400,
          apiOutputTokens: 400,
          cacheReadTokens: 100,
          cacheWriteTokens: 50,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    });
    assert.equal(candidate.diagnostics.stageInput, 5000);
    assert.equal(candidate.diagnostics.routeTotalInput, 5000);
    assert.equal(candidate.diagnostics.apiPromptTokensForCost, 5000);
    assert.equal("livePricingPromptBasis" in candidate.diagnostics, false);
    assert.equal("livePricingCompletionBasis" in candidate.diagnostics, false);
  });

  it("transitive dependency graph excludes pricing, FX, DB, and Published modules", () => {
    const entry = join(process.cwd(), "src/lib/turnBillableUsage.ts");
    const allImports = collectProductionImports(entry);
    const forbiddenHits = allImports.filter((imp) =>
      FORBIDDEN_CANDIDATE_IMPORT_PATTERNS.some((pattern) => imp.startsWith(pattern))
    );
    assert.deepEqual(
      forbiddenHits,
      [],
      `forbidden transitive imports: ${forbiddenHits.join(", ")}`
    );
  });
});
