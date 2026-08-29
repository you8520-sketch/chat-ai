/**
 * Pure stage selection and token aggregation primitives for turn billable usage.
 * No pricing, FX, waiver, or settlement dependencies.
 */
import type { StageUsage } from "@/lib/ai";
import {
  isGeminiChatOpenRouterModel,
  isMuseModel,
  isOpenRouterSimplePointModel,
} from "@/lib/chatModels";

const GEMINI_BILLING_MODEL = /^gemini/i;

export function isGeminiBillingStage(stage: { model: string }): boolean {
  return GEMINI_BILLING_MODEL.test(stage.model) || stage.model === "demo";
}

/** One provider per turn — stealth fallback must never sum Gemini + OpenRouter stages. */
export function selectBillableStages(
  stages: StageUsage[],
  opts?: { stealthFallback?: boolean; refusalFallbackDelivered?: boolean }
): StageUsage[] {
  if (!stages.length) return [];
  if (opts?.refusalFallbackDelivered) {
    return [stages[stages.length - 1]!];
  }
  if (opts?.stealthFallback) {
    const openRouterOnly = stages.filter((s) => !isGeminiBillingStage(s));
    return openRouterOnly.length > 0 ? openRouterOnly : [stages[stages.length - 1]!];
  }
  return [stages[0]!];
}

/** OpenRouter turn — sum non-Gemini stage API completion tokens. */
export function sumOpenRouterStageOutputTokens(stages: StageUsage[]): number {
  return stages
    .filter((s) => !isGeminiBillingStage(s))
    .reduce((sum, s) => sum + Math.max(0, s.apiOutputTokens ?? s.output ?? 0), 0);
}

/** OpenRouter turn — sum non-Gemini stage reasoning_tokens metadata. */
export function sumOpenRouterStageReasoningTokens(stages: StageUsage[]): number {
  return stages
    .filter((s) => !isGeminiBillingStage(s))
    .reduce((sum, s) => sum + Math.max(0, s.apiReasoningOutputTokens ?? 0), 0);
}

/** OpenRouter turn — sum stage upstream_inference_cost (provider economics, not user usage). */
export function sumOpenRouterStageUpstreamUsd(stages: StageUsage[]): number {
  return stages
    .filter((s) => !isGeminiBillingStage(s))
    .reduce((sum, s) => sum + Math.max(0, s.upstreamCostUsd ?? 0), 0);
}

/**
 * Receipt/content output tokens for OpenRouter models.
 * Reasoning may be split from completion for display/simple-point billing paths.
 */
export function billableOpenRouterOutputTokens(
  modelId: string,
  totalApiOutputTokens: number,
  reasoningTokens: number
): number {
  if (totalApiOutputTokens <= 0) return 0;
  if (isOpenRouterSimplePointModel(modelId)) {
    return Math.max(0, totalApiOutputTokens - reasoningTokens);
  }
  if (
    (isMuseModel(modelId) || isGeminiChatOpenRouterModel(modelId)) &&
    reasoningTokens > 0
  ) {
    return Math.max(0, totalApiOutputTokens - reasoningTokens);
  }
  return totalApiOutputTokens;
}

/** Cap stage-reported input by promptAudit assembled total when present. */
export function resolveTurnBillableInput(opts: {
  stageInput: number;
  promptAuditTotal?: number;
}): number {
  let billable = Math.max(0, opts.stageInput);
  if (opts.promptAuditTotal != null && opts.promptAuditTotal > 0) {
    billable = Math.min(billable, opts.promptAuditTotal);
  }
  return billable;
}

/** Route-level apiPromptTokensForCost / apiCompletionTokensForCost assembly. */
export function resolveRouteApiTokensForCost(primaryStage: StageUsage | undefined, summedApiOutput: number) {
  const stageInput = primaryStage?.input ?? 0;
  return {
    apiPromptTokensForCost: primaryStage?.apiReportedInputTokens ?? primaryStage?.input ?? stageInput,
    apiCompletionTokensForCost:
      summedApiOutput > 0
        ? summedApiOutput
        : primaryStage?.apiOutputTokens ?? primaryStage?.output ?? 0,
  };
}
