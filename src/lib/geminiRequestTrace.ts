import { randomUUID } from "node:crypto";

import { estimatePayloadFromBody } from "@/lib/mockApiMode";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import { describeGeminiThinkingConfig } from "@/lib/geminiClient";
import type { TokenUsage } from "@/lib/ai";
/** Google AI Studio 대략 단가 (USD / 1M tokens) — 진단용 추정치 */
const USD_PER_M: Record<string, { input: number; output: number; cacheWrite: number }> = {
  "gemini-3-flash-preview": { input: 0.5, output: 3.0, cacheWrite: 0.5 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0.3 },
};

const DEFAULT_USD_PER_M = { input: 1.0, output: 6.0, cacheWrite: 1.0 };
const KRW_PER_USD = Number(process.env.GEMINI_TRACE_KRW_PER_USD) || 1350;
/** Gemini explicit cache read — input 대비 ~90% 할인 (2.5-flash 진단용) */
const GEMINI_CACHE_READ_INPUT_RATE_MULTIPLIER = 0.1;

export type GeminiRequestTraceRecord = {
  requestId: string;
  turnRequestId: string;
  conversationId: number;
  phase: "pre-request" | "stream" | "background" | "cache-create";
  requestKind: string;
  model: string;
  estimatedInputTokens: number;
  promptTokenCount: number;
  outputTokenCount: number;
  thoughtsTokenCount: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: string;
  cachedContentTokenCount: number;
  estimatedCostKrw: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  retryIndex: number;
  success: boolean;
  error?: string;
};

type PendingRequest = {
  requestId: string;
  phase: GeminiRequestTraceRecord["phase"];
  requestKind: string;
  model: string;
  estimatedInputTokens: number;
  retryIndex: number;
  startedAtMs: number;
  thinkingEnabled: boolean;
  thinkingBudget?: number;
  thinkingLevel?: string;
};

function resolveRates(modelId: string) {
  const key = modelId.toLowerCase();
  for (const [pattern, rates] of Object.entries(USD_PER_M)) {
    if (key.includes(pattern.replace("gemini-", "").split("-")[0]!) || key === pattern) {
      return rates;
    }
  }
  if (/3-flash|3\.0-flash/i.test(key)) return USD_PER_M["gemini-3-flash-preview"]!;
  if (/2\.5-flash/i.test(key)) return USD_PER_M["gemini-2.5-flash"]!;
  return DEFAULT_USD_PER_M;
}

export function estimateGeminiCostKrw(opts: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens?: number;
  cachedContentTokenCount?: number;
  requestKind?: string;
}): number {
  const rates = resolveRates(opts.model);
  const input = Math.max(0, opts.inputTokens);
  const output = Math.max(0, opts.outputTokens);
  const thoughts = Math.max(0, opts.thoughtsTokens ?? 0);
  const isCacheCreate = /cachedContents-create/i.test(opts.requestKind ?? "");
  const cacheWrite = isCacheCreate ? Math.max(0, opts.cachedContentTokenCount ?? input) : 0;
  const cachedRead = !isCacheCreate
    ? Math.min(Math.max(0, opts.cachedContentTokenCount ?? 0), input)
    : 0;
  const standardInput = isCacheCreate ? 0 : Math.max(0, input - cachedRead);

  const usd = isCacheCreate
    ? (cacheWrite / 1_000_000) * rates.cacheWrite +
      ((output + thoughts) / 1_000_000) * rates.output
    : (standardInput / 1_000_000) * rates.input +
      (cachedRead / 1_000_000) * rates.input * GEMINI_CACHE_READ_INPUT_RATE_MULTIPLIER +
      ((output + thoughts) / 1_000_000) * rates.output;

  return Math.round(usd * KRW_PER_USD * 100) / 100;
}

/** 유저 메시지 1건당 Gemini HTTP 호출 추적 */
export class GeminiTurnTrace {
  readonly turnRequestId: string;
  readonly conversationId: number;
  private readonly records: GeminiRequestTraceRecord[] = [];
  private readonly pending = new Map<string, PendingRequest>();
  private readonly retryByKind = new Map<string, number>();

  constructor(conversationId: number) {
    this.turnRequestId = randomUUID().slice(0, 12);
    this.conversationId = conversationId;
  }

  startRequest(opts: {
    phase: GeminiRequestTraceRecord["phase"];
    requestKind: string;
    model: string;
    estimatedInputTokens?: number;
    body?: Record<string, unknown>;
  }): string {
    const requestId = randomUUID().slice(0, 12);
    const retryKey = `${opts.phase}:${opts.requestKind}:${opts.model}`;
    const retryIndex = this.retryByKind.get(retryKey) ?? 0;
    this.retryByKind.set(retryKey, retryIndex + 1);

    let estimatedInputTokens = opts.estimatedInputTokens ?? 0;
    if (opts.body) {
      estimatedInputTokens = estimatePayloadFromBody(opts.body).tokens;
    }

    const genConfig = opts.body?.generationConfig as Record<string, unknown> | undefined;
    const thinkingConfig = genConfig?.thinkingConfig as Record<string, unknown> | undefined;
    const thinkingDiagnostics = describeGeminiThinkingConfig(thinkingConfig);

    const startedAtMs = Date.now();
    this.pending.set(requestId, {
      requestId,
      phase: opts.phase,
      requestKind: opts.requestKind,
      model: opts.model,
      estimatedInputTokens,
      retryIndex,
      startedAtMs,
      thinkingEnabled: thinkingDiagnostics.thinkingEnabled,
      thinkingBudget: thinkingDiagnostics.thinkingBudget,
      thinkingLevel: thinkingDiagnostics.thinkingLevel,
    });

    console.log("[gemini-request-trace] start", {
      requestId,
      turnRequestId: this.turnRequestId,
      conversationId: this.conversationId,
      phase: opts.phase,
      requestKind: opts.requestKind,
      model: opts.model,
      estimatedInputTokens,
      retryIndex,
      ...thinkingDiagnostics,
    });

    return requestId;
  }

  endRequest(
    requestId: string,
    usage?: Partial<TokenUsage> & {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      cachedContentTokenCount?: number;
    },
    error?: unknown
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);

    const endedAtMs = Date.now();
    const promptTokenCount = usage?.promptTokenCount ?? usage?.inputTokens ?? pending.estimatedInputTokens;
    const outputTokenCount = usage?.candidatesTokenCount ?? usage?.outputTokens ?? 0;
    const thoughtsTokenCount = usage?.thoughtsTokenCount ?? usage?.thoughtsTokens ?? 0;
    const cachedContentTokenCount = usage?.cachedContentTokenCount ?? usage?.cachedContentTokens ?? 0;
    const success = !error;

    const record: GeminiRequestTraceRecord = {
      requestId,
      turnRequestId: this.turnRequestId,
      conversationId: this.conversationId,
      phase: pending.phase,
      requestKind: pending.requestKind,
      model: pending.model,
      estimatedInputTokens: pending.estimatedInputTokens,
      promptTokenCount,
      outputTokenCount,
      thoughtsTokenCount,
      thinkingEnabled: pending.thinkingEnabled,
      thinkingBudget: pending.thinkingBudget,
      thinkingLevel: pending.thinkingLevel,
      cachedContentTokenCount,
      estimatedCostKrw: estimateGeminiCostKrw({
        model: pending.model,
        inputTokens: promptTokenCount,
        outputTokens: outputTokenCount,
        thoughtsTokens: thoughtsTokenCount,
        cachedContentTokenCount,
        requestKind: pending.requestKind,
      }),
      startedAt: new Date(pending.startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - pending.startedAtMs,
      retryIndex: pending.retryIndex,
      success,
      error: error ? (error as Error).message ?? String(error) : undefined,
    };

    this.records.push(record);

    console.log("[gemini-request-trace] end", record);
  }

  getSummary() {
    const totalEstimatedCostKrw = this.records.reduce((sum, r) => sum + r.estimatedCostKrw, 0);
    const totalPromptTokens = this.records.reduce((sum, r) => sum + r.promptTokenCount, 0);
    const totalOutputTokens = this.records.reduce(
      (sum, r) => sum + r.outputTokenCount + r.thoughtsTokenCount,
      0
    );

    return {
      turnRequestId: this.turnRequestId,
      conversationId: this.conversationId,
      requestCount: this.records.length,
      totalPromptTokens,
      totalOutputTokens,
      totalEstimatedCostKrw: Math.round(totalEstimatedCostKrw * 100) / 100,
      requests: this.records,
    };
  }

  logTurnSummary(context?: string): void {
    const summary = this.getSummary();
    const isolation = isGeminiIsolationMode();

    console.log("[gemini-turn-trace] TOTAL_REQUEST_COUNT_PER_TURN", {
      TOTAL_REQUEST_COUNT_PER_TURN: summary.requestCount,
      turnRequestId: summary.turnRequestId,
      conversationId: summary.conversationId,
      context: context ?? "chat-turn",
      totalEstimatedCostKrw: summary.totalEstimatedCostKrw,
      isolationMode: isolation,
      isolationViolation: isolation && summary.requestCount !== 1,
    });

    console.log("[gemini-turn-trace] summary", {
      context: context ?? "chat-turn",
      ...summary,
      warning:
        isolation && summary.requestCount !== 1
          ? "ISOLATION_VIOLATION — expected exactly 1 Gemini HTTP request per user message"
          : summary.requestCount > 4
            ? "HIGH_REQUEST_COUNT — 1 user message triggered many Gemini HTTP calls"
            : summary.totalEstimatedCostKrw > 500
              ? "HIGH_ESTIMATED_COST — check model tier, explicit cache create, or duplicate retries"
              : undefined,
    });
  }
}
