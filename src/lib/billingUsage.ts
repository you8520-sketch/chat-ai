/**
 * Canonical billable usage owner — provider-independent normalized token buckets.
 */

export type ReasoningAccounting =
  | "included_in_output"
  | "separate"
  | "none"
  | "unknown";

export type NormalizedBillableUsage = {
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  visibleOutputTokens: number;
  reasoningTokens: number;
  billableOutputTokens: number;
  reasoningAccounting: ReasoningAccounting;
};

export type UserBillableUsageCoverage = "complete" | "partial" | "unknown";

/** Canonical billable usage normalizer — single owner for reasoning accounting */
export function normalizeBillableUsage(opts: {
  modelId: string;
  promptTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
}): NormalizedBillableUsage {
  const promptTokens = Math.max(0, opts.promptTokens);
  const cacheReadTokens = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWriteTokens = Math.max(0, opts.cacheWriteTokens ?? 0);
  const standardInputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const visibleOutputTokens = Math.max(0, opts.outputTokens);
  const reasoningTokens = Math.max(0, opts.reasoningTokens ?? 0);
  // Contract: reasoning_tokens from completion_tokens_details is subset of completion_tokens (included)
  let reasoningAccounting: ReasoningAccounting = "none";
  let billableOutputTokens = visibleOutputTokens;
  if (reasoningTokens <= 0) {
    reasoningAccounting = "none";
    billableOutputTokens = visibleOutputTokens;
  } else {
    reasoningAccounting = "included_in_output";
    billableOutputTokens = visibleOutputTokens;
  }
  return {
    promptTokens,
    cacheReadTokens,
    cacheWriteTokens,
    standardInputTokens,
    visibleOutputTokens,
    reasoningTokens,
    billableOutputTokens,
    reasoningAccounting,
  };
}

export function validateNormalizedBillableUsage(usage: NormalizedBillableUsage): boolean {
  if (
    !Number.isFinite(usage.promptTokens) ||
    !Number.isFinite(usage.cacheReadTokens) ||
    !Number.isFinite(usage.cacheWriteTokens) ||
    !Number.isFinite(usage.standardInputTokens) ||
    !Number.isFinite(usage.visibleOutputTokens) ||
    !Number.isFinite(usage.reasoningTokens) ||
    !Number.isFinite(usage.billableOutputTokens)
  ) {
    return false;
  }
  if (
    usage.promptTokens < 0 ||
    usage.cacheReadTokens < 0 ||
    usage.cacheWriteTokens < 0 ||
    usage.standardInputTokens < 0 ||
    usage.visibleOutputTokens < 0 ||
    usage.reasoningTokens < 0 ||
    usage.billableOutputTokens < 0
  ) {
    return false;
  }
  const expectedStandard = Math.max(0, usage.promptTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  if (usage.standardInputTokens !== expectedStandard) {
    return false;
  }
  if (usage.cacheReadTokens + usage.cacheWriteTokens > usage.promptTokens) {
    return false;
  }
  return true;
}
