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

function isSafeNonNegativeInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

function validateReasoningAccountingInvariants(usage: NormalizedBillableUsage): boolean {
  switch (usage.reasoningAccounting) {
    case "none":
      return usage.reasoningTokens === 0 && usage.billableOutputTokens === usage.visibleOutputTokens;
    case "included_in_output":
      return (
        usage.reasoningTokens >= 0 &&
        usage.reasoningTokens <= usage.visibleOutputTokens &&
        usage.billableOutputTokens === usage.visibleOutputTokens
      );
    case "separate":
      return usage.billableOutputTokens === usage.visibleOutputTokens + usage.reasoningTokens;
    case "unknown":
      return false;
    default: {
      const _exhaustive: never = usage.reasoningAccounting;
      return _exhaustive;
    }
  }
}

/**
 * Raw usage normalization policy: sanitize (not strict).
 * Provider parsers may supply fractional/negative raw counts; we floor to integers and clamp negatives to 0.
 * Billing-critical paths must pass validateNormalizedBillableUsage() after normalization — tampered or
 * non-integer fields fail closed at validation time.
 */
export function normalizeBillableUsage(opts: {
  modelId: string;
  promptTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
}): NormalizedBillableUsage {
  const promptTokens = Math.max(0, Math.floor(opts.promptTokens));
  const cacheReadTokens = Math.max(0, Math.floor(opts.cacheReadTokens ?? 0));
  const cacheWriteTokens = Math.max(0, Math.floor(opts.cacheWriteTokens ?? 0));
  const standardInputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const visibleOutputTokens = Math.max(0, Math.floor(opts.outputTokens));
  const reasoningTokens = Math.max(0, Math.floor(opts.reasoningTokens ?? 0));
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
  const tokenFields = [
    usage.promptTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.standardInputTokens,
    usage.visibleOutputTokens,
    usage.reasoningTokens,
    usage.billableOutputTokens,
  ];
  for (const field of tokenFields) {
    if (!isSafeNonNegativeInteger(field)) return false;
  }

  const expectedStandard = Math.max(0, usage.promptTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  if (usage.standardInputTokens !== expectedStandard) {
    return false;
  }
  if (usage.cacheReadTokens + usage.cacheWriteTokens > usage.promptTokens) {
    return false;
  }

  if (usage.reasoningAccounting === "unknown" || usage.reasoningAccounting === "separate") {
    return false;
  }

  return validateReasoningAccountingInvariants(usage);
}
