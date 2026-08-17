import type { RawUsageRecord, UsageField } from "./types";

function asUsageField(value: unknown): UsageField {
  return typeof value === "number" && Number.isFinite(value) ? value : "unavailable";
}

function pickReasoningTokens(usage: Record<string, unknown>): UsageField {
  if (typeof usage.reasoning_tokens === "number") return usage.reasoning_tokens;
  const details = usage.completion_tokens_details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const nested = (details as Record<string, unknown>).reasoning_tokens;
    if (typeof nested === "number") return nested;
  }
  const outputDetails = usage.output_tokens_details;
  if (outputDetails && typeof outputDetails === "object" && !Array.isArray(outputDetails)) {
    const nested = (outputDetails as Record<string, unknown>).reasoning_tokens;
    if (typeof nested === "number") return nested;
  }
  return "unavailable";
}

const KNOWN_USAGE_KEYS = new Set([
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "reasoning_tokens",
  "prompt_tokens_details",
  "completion_tokens_details",
  "output_tokens_details",
  "cost",
  "total_cost",
]);

export function extractRawUsage(payload: unknown): RawUsageRecord {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const usage =
    root.usage && typeof root.usage === "object" && !Array.isArray(root.usage)
      ? (root.usage as Record<string, unknown>)
      : {};
  const details = usage.prompt_tokens_details;
  const cachedFromDetails =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>).cached_tokens
      : undefined;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(usage)) {
    if (!KNOWN_USAGE_KEYS.has(key)) extra[key] = value;
  }
  if (typeof usage.total_tokens === "number") extra.total_tokens = usage.total_tokens;
  const promptTokens = asUsageField(usage.prompt_tokens);
  const completionTokens = asUsageField(usage.completion_tokens);
  const reasoningTokens = pickReasoningTokens(usage);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cached_tokens: asUsageField(usage.cached_tokens ?? cachedFromDetails),
    reasoning_tokens: reasoningTokens,
    visible_completion_tokens: visibleCompletionTokens(completionTokens, reasoningTokens),
    completion_tokens_details: usage.completion_tokens_details ?? "unavailable",
    cost: usage.cost ?? usage.total_cost ?? root.cost ?? "unavailable",
    extra,
  };
}

export function visibleCompletionTokens(
  completion: UsageField,
  reasoning: UsageField
): UsageField {
  if (typeof completion !== "number") return "unavailable";
  if (typeof reasoning !== "number") return "unavailable";
  return Math.max(0, completion - reasoning);
}

export function countKoreanChars(text: string): number {
  return [...text].filter((ch) => /[\uAC00-\uD7A3]/.test(ch)).length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
