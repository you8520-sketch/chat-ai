import type { TokenUsage } from "@/lib/ai";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

/** OpenRouter / Anthropic usage — cache 분리 정산용 */
export type OpenRouterUsageBreakdown = {
  promptTokens: number;
  completionTokens: number;
  /** completion_tokens_details.reasoning_tokens (Qwen thinking 등) */
  reasoningTokens: number;
  /** prompt_tokens_details.cached_tokens — Anthropic explicit + Gemini/DeepSeek implicit */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** prompt − cache read − cache write (≥0) */
  standardInputTokens: number;
  /** OpenRouter upstream_inference_cost (USD) */
  upstreamCostUsd?: number;
  /** cost_details.upstream_inference_prompt_cost */
  upstreamPromptCostUsd?: number;
  /** cost_details.upstream_inference_completions_cost */
  upstreamCompletionCostUsd?: number;
  /** OpenRouter cache_discount (USD — 양수=절약, 음수=캐시 write surcharge) */
  cacheDiscountUsd?: number;
  /** Unparsed prompt_tokens_details keys for provider-specific fields */
  promptTokensDetailsRaw?: Record<string, number>;
  estimated: boolean;
};

function readNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function readSignedUsd(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return n;
}

/** Extract numeric fields from prompt_tokens_details for diagnostics */
export function extractPromptTokensDetailsRaw(
  details: Record<string, unknown> | null
): Record<string, number> | undefined {
  if (!details) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(details)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) out[key] = Math.round(n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickUsageField(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = readNum(obj[k]);
    if (v > 0) return v;
  }
  return 0;
}

/** completion_tokens_details.reasoning_tokens 등 */
export function parseReasoningTokens(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const details =
    u.completion_tokens_details && typeof u.completion_tokens_details === "object"
      ? (u.completion_tokens_details as Record<string, unknown>)
      : null;
  if (details) {
    return pickUsageField(details, ["reasoning_tokens", "reasoning"]);
  }
  return pickUsageField(u, ["reasoning_tokens"]);
}

/** usage 객체·응답 헤더에서 cache read / creation 토큰 분리 파싱 */
export function parseOpenRouterUsage(
  usage: unknown,
  headers?: Headers | null
): OpenRouterUsageBreakdown {
  const empty: OpenRouterUsageBreakdown = {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    standardInputTokens: 0,
    estimated: true,
  };
  if (!usage || typeof usage !== "object") return empty;

  const u = usage as Record<string, unknown>;
  const details =
    u.prompt_tokens_details && typeof u.prompt_tokens_details === "object"
      ? (u.prompt_tokens_details as Record<string, unknown>)
      : null;

  const promptTokens = readNum(u.prompt_tokens ?? u.input_tokens);
  const completionTokens = readNum(u.completion_tokens ?? u.output_tokens);
  const reasoningTokens = parseReasoningTokens(u);

  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  if (details) {
    cacheReadTokens = pickUsageField(details, [
      "cached_tokens",
      "cache_read_tokens",
      "cache_read_input_tokens",
    ]);
    cacheWriteTokens = pickUsageField(details, [
      "cache_write_tokens",
      "cache_creation_tokens",
      "cache_creation_input_tokens",
    ]);
  }

  cacheReadTokens = Math.max(
    cacheReadTokens,
    pickUsageField(u, [
      "cache_read_tokens",
      "cache_read_input_tokens",
      "cached_tokens",
    ])
  );
  cacheWriteTokens = Math.max(
    cacheWriteTokens,
    pickUsageField(u, [
      "cache_write_tokens",
      "cache_creation_tokens",
      "cache_creation_input_tokens",
    ])
  );

  if (headers) {
    cacheReadTokens = Math.max(
      cacheReadTokens,
      readNum(headers.get("x-cache-read-tokens") ?? headers.get("x-anthropic-cache-read-input-tokens"))
    );
    cacheWriteTokens = Math.max(
      cacheWriteTokens,
      readNum(
        headers.get("x-cache-write-tokens") ??
          headers.get("x-cache-creation-tokens") ??
          headers.get("x-anthropic-cache-creation-input-tokens")
      )
    );
  }

  if (
    cacheReadTokens > 0 &&
    cacheWriteTokens > 0 &&
    cacheWriteTokens === cacheReadTokens
  ) {
    // Implicit cache (Gemini) may echo the same count in cached_tokens + cache_write_tokens
    cacheWriteTokens = 0;
  }

  cacheReadTokens = Math.min(cacheReadTokens, promptTokens);
  cacheWriteTokens = Math.min(cacheWriteTokens, Math.max(0, promptTokens - cacheReadTokens));

  const standardInputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);

  let upstreamCostUsd = 0;
  let upstreamPromptCostUsd: number | undefined;
  let upstreamCompletionCostUsd: number | undefined;
  const costDetails =
    u.cost_details && typeof u.cost_details === "object"
      ? (u.cost_details as Record<string, unknown>)
      : null;
  if (costDetails) {
    upstreamCostUsd = readNum(costDetails.upstream_inference_cost);
    upstreamPromptCostUsd = readSignedUsd(costDetails.upstream_inference_prompt_cost);
    upstreamCompletionCostUsd = readSignedUsd(costDetails.upstream_inference_completions_cost);
  }
  if (!upstreamCostUsd) {
    upstreamCostUsd = readNum(u.cost);
  }
  const cacheDiscountUsd = readSignedUsd(u.cache_discount);
  const promptTokensDetailsRaw = extractPromptTokensDetailsRaw(details);

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    standardInputTokens,
    ...(upstreamCostUsd > 0 ? { upstreamCostUsd } : {}),
    ...(upstreamPromptCostUsd != null ? { upstreamPromptCostUsd } : {}),
    ...(upstreamCompletionCostUsd != null ? { upstreamCompletionCostUsd } : {}),
    ...(cacheDiscountUsd != null ? { cacheDiscountUsd } : {}),
    ...(promptTokensDetailsRaw ? { promptTokensDetailsRaw } : {}),
    estimated: promptTokens <= 0 && completionTokens <= 0,
  };
}

/** Dev billing visibility — same cached_tokens field for Anthropic + implicit providers */
export function logOpenRouterUsageCacheDiagnostics(opts: {
  modelId: string;
  breakdown: OpenRouterUsageBreakdown;
  rawUsage?: unknown;
  consecutiveTurnsStable?: number;
}): void {
  const b = opts.breakdown;
  const cacheHitPct =
    b.promptTokens > 0 ? Math.round((b.cacheReadTokens / b.promptTokens) * 1000) / 10 : 0;
  const providerCacheReported = b.cacheReadTokens > 0 || b.cacheWriteTokens > 0;

  const rates = resolveOpenRouterModelRates(opts.modelId);

  console.log("[openrouter-cache-diagnostics]", {
    model: opts.modelId,
    provider_family: rates.family,
    provider_cache_label: rates.label,
    prompt_tokens: b.promptTokens,
    cached_tokens: b.cacheReadTokens,
    cache_write_tokens: b.cacheWriteTokens,
    standard_input_tokens: b.standardInputTokens,
    cache_hit_pct: cacheHitPct,
    provider_cache_reported: providerCacheReported,
    cache_discount_usd: b.cacheDiscountUsd,
    upstream_cost_usd: b.upstreamCostUsd,
    upstream_prompt_cost_usd: b.upstreamPromptCostUsd,
    upstream_completion_cost_usd: b.upstreamCompletionCostUsd,
    prompt_tokens_details: b.promptTokensDetailsRaw,
    consecutive_turns_stable: opts.consecutiveTurnsStable,
    note: providerCacheReported
      ? "provider reported cache via prompt_tokens_details.cached_tokens (explicit or implicit)"
      : "no cached_tokens in usage — not necessarily zero savings (check upstream_prompt_cost trend)",
  });

  if (process.env.NODE_ENV !== "production" && opts.rawUsage) {
    console.log("[openrouter-cache-diagnostics] raw_usage", JSON.stringify(opts.rawUsage));
  }
}

export function tokenUsageFromOpenRouterBreakdown(b: OpenRouterUsageBreakdown): TokenUsage {
  return {
    inputTokens: b.promptTokens,
    outputTokens: b.completionTokens,
    estimated: b.estimated,
    ...(b.reasoningTokens > 0 ? { reasoningOutputTokens: b.reasoningTokens } : {}),
    ...(b.cacheReadTokens > 0 ? { cacheReadTokens: b.cacheReadTokens } : {}),
    ...(b.cacheWriteTokens > 0 ? { cacheWriteTokens: b.cacheWriteTokens } : {}),
    ...(b.standardInputTokens >= 0 ? { standardInputTokens: b.standardInputTokens } : {}),
    ...(b.upstreamCostUsd != null && b.upstreamCostUsd > 0
      ? { upstreamCostUsd: b.upstreamCostUsd }
      : {}),
    ...(b.cacheDiscountUsd != null && b.cacheDiscountUsd !== 0
      ? { cacheDiscountUsd: b.cacheDiscountUsd }
      : {}),
  };
}
