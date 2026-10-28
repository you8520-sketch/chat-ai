import "server-only";

import {
  ADULT_OFF_CLASSIFIER_JSON_SCHEMA,
  ADULT_OFF_CLASSIFIER_SCHEMA_NAME,
  ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT,
  AdultOffClassifierCallError,
  AdultOffClassifierOutputError,
  buildAdultOffClassifierUserMessage,
  parseAdultOffClassifierOutput,
  type AdultOffClassify,
  type AdultOffClassifierCallOutcome,
  type AdultOffClassifierResult,
  type AdultOffClassifierUsage,
} from "@/lib/adultOffOutputGuard";
import {
  finalizeProviderCostAttempt,
  startProviderCostAttempt,
  type ProviderCostFinalizeInput,
  type ProviderCostLedgerContext,
  type ProviderCostPhysicalAttemptHandle,
} from "@/lib/providerCostLedger";

/**
 * 성인 OFF 출력 검사용 독립 분류 모델. Main RP 모델과 호출·컨텍스트를 공유하지 않는다.
 * 단일 시도다: 실패는 자동 재시도하지 않고 호출자가 미승인으로 처리한다.
 * 전송은 공식 OpenAI Chat Completions 한 곳이다.
 */
export const ADULT_OFF_CLASSIFIER_MODEL = "gpt-6-luna";
export const ADULT_OFF_CLASSIFIER_PROVIDER = "openai";
export const ADULT_OFF_CLASSIFIER_REQUEST_KIND = "adult-off-output-moderation";
/** 사용자 응답을 막고 기다리는 동기 출력 검사의 기본 상한. */
export const ADULT_OFF_CLASSIFIER_TIMEOUT_MS = 60_000;
export const ADULT_OFF_CLASSIFIER_MAX_TOKENS = 200;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/** 분류 호출이 속한 턴의 원장 식별자. 현재 턴의 generation scope 에서 그대로 가져온다. */
export type AdultOffClassifierTurnScope = {
  chatId: number;
  assistantMessageId: number;
  generationSequence: number;
  generationRequestId: string | null;
};

/**
 * 턴 원장에 연결된 분류 호출 원장 컨텍스트. 사용자 청구와는 무관한 플랫폼 부담 moderation 비용이며,
 * 기존 턴 합계(family 별 집계)에는 합산되지 않고 request_kind 로 턴 단위 조회한다.
 */
export function buildAdultOffClassifierLedgerContext(
  scope: AdultOffClassifierTurnScope
): ProviderCostLedgerContext {
  return {
    chatId: scope.chatId,
    assistantMessageId: scope.assistantMessageId,
    generationSequence: scope.generationSequence,
    generationRequestId: scope.generationRequestId,
    family: "background",
    fundingClass: "platform_funded",
    executionPhase: "sync_post_turn",
    jobAttemptOrdinal: 1,
    requestedProvider: ADULT_OFF_CLASSIFIER_PROVIDER,
    requestedModel: ADULT_OFF_CLASSIFIER_MODEL,
    requestKind: ADULT_OFF_CLASSIFIER_REQUEST_KIND,
    costCenter: "moderation",
  };
}

type OfficialChatUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown };
  completion_tokens_details?: { reasoning_tokens?: unknown };
};

type OfficialChatBody = {
  id?: unknown;
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: OfficialChatUsage;
  billing?: { billed_cost_usd?: unknown };
};

function isTimeoutLike(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function finiteToken(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function headerRequestId(headers: Headers): string | null {
  const raw = headers.get("x-request-id") ?? headers.get("openai-request-id");
  const trimmed = raw?.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

/** Official billing only. A missing amount stays null; token prices are not a billed cost. */
function officialBilledCostUsd(body: OfficialChatBody | null): number | null {
  const raw = body?.billing?.billed_cost_usd;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
    return Number(raw);
  }
  return null;
}

function failureUsage(input: {
  startedAt: number;
  outcome: Exclude<AdultOffClassifierCallOutcome, "ok">;
  httpStatus: number | null;
  providerRequestId: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}): AdultOffClassifierUsage {
  return {
    model: ADULT_OFF_CLASSIFIER_MODEL,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    costUsd: input.costUsd ?? null,
    providerRequestId: input.providerRequestId,
    latencyMs: Date.now() - input.startedAt,
    outcome: input.outcome,
    httpStatus: input.httpStatus,
  };
}

function beginLedger(scope: AdultOffClassifierTurnScope): ProviderCostPhysicalAttemptHandle | null {
  try {
    const attempt = startProviderCostAttempt(buildAdultOffClassifierLedgerContext(scope));
    return attempt.deduplicated ? null : attempt;
  } catch (error) {
    console.warn("[adult-off-classifier] ledger start skipped:", (error as Error).message);
    return null;
  }
}

function settleLedger(
  attempt: ProviderCostPhysicalAttemptHandle | null,
  input: ProviderCostFinalizeInput
): void {
  if (!attempt) return;
  try {
    finalizeProviderCostAttempt(attempt, input);
  } catch (error) {
    console.warn("[adult-off-classifier] ledger finalize skipped:", (error as Error).message);
  }
}

function reportedTokens(usage: OfficialChatUsage | undefined): {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
} {
  return {
    inputTokens: finiteToken(usage?.prompt_tokens),
    outputTokens: finiteToken(usage?.completion_tokens),
    cacheReadTokens: finiteToken(usage?.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens: finiteToken(usage?.prompt_tokens_details?.cache_write_tokens),
    reasoningTokens: finiteToken(usage?.completion_tokens_details?.reasoning_tokens),
  };
}

export type AdultOffClassifierOptions = {
  /** 호출 하나의 클라이언트 타임아웃. 생략하면 동기 출력 검사 기본값(60초). */
  timeoutMs?: number;
};

/**
 * 한 턴의 분류 함수를 만든다. 성공뿐 아니라 HTTP 오류·타임아웃·응답 JSON 깨짐·스키마 위반에서도
 * 확보한 공급자 요청 ID와 usage 를 AdultOffClassifierCallError 에 실어 던진다.
 */
export function createAdultOffClassifier(
  scope: AdultOffClassifierTurnScope,
  options: AdultOffClassifierOptions = {}
): AdultOffClassify {
  const timeoutMs = options.timeoutMs ?? ADULT_OFF_CLASSIFIER_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("adult-off classifier timeoutMs must be a finite positive number");
  }
  return async (windowText): Promise<AdultOffClassifierResult> => {
    const startedAt = Date.now();
    const attempt = beginLedger(scope);
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      const outcome = "transport_error" as const;
      settleLedger(attempt, {
        actualProvider: ADULT_OFF_CLASSIFIER_PROVIDER,
        actualModel: ADULT_OFF_CLASSIFIER_MODEL,
        outcome: "failed_without_usage",
      });
      throw new AdultOffClassifierCallError(
        "OPENAI_API_KEY is not configured",
        outcome,
        failureUsage({ startedAt, outcome, httpStatus: null, providerRequestId: null })
      );
    }

    const body = {
      model: ADULT_OFF_CLASSIFIER_MODEL,
      temperature: 0,
      max_completion_tokens: ADULT_OFF_CLASSIFIER_MAX_TOKENS,
      reasoning_effort: "none",
      messages: [
        { role: "system", content: ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: buildAdultOffClassifierUserMessage(windowText) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: ADULT_OFF_CLASSIFIER_SCHEMA_NAME,
          strict: true,
          schema: ADULT_OFF_CLASSIFIER_JSON_SCHEMA,
        },
      },
    };

    let response: Response;
    try {
      response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const outcome = isTimeoutLike(error) ? "timeout" : "transport_error";
      settleLedger(attempt, {
        actualProvider: ADULT_OFF_CLASSIFIER_PROVIDER,
        actualModel: ADULT_OFF_CLASSIFIER_MODEL,
        outcome: "failed_without_usage",
      });
      throw new AdultOffClassifierCallError(
        (error as Error | undefined)?.message ?? String(error),
        outcome,
        failureUsage({ startedAt, outcome, httpStatus: null, providerRequestId: null })
      );
    }

    const requestId = headerRequestId(response.headers);
    const raw = await response.text();
    let parsed: OfficialChatBody | null = null;
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw) as OfficialChatBody;
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      settleLedger(attempt, {
        actualProvider: ADULT_OFF_CLASSIFIER_PROVIDER,
        actualModel: ADULT_OFF_CLASSIFIER_MODEL,
        httpStatus: response.status,
        providerRequestId: requestId,
        outcome: "failed_without_usage",
      });
      throw new AdultOffClassifierCallError(
        `OpenAI ${response.status}: ${raw.slice(0, 240)}`,
        "http_error",
        failureUsage({
          startedAt,
          outcome: "http_error",
          httpStatus: response.status,
          providerRequestId: requestId,
        })
      );
    }

    if (!parsed) {
      settleLedger(attempt, {
        actualProvider: ADULT_OFF_CLASSIFIER_PROVIDER,
        actualModel: ADULT_OFF_CLASSIFIER_MODEL,
        httpStatus: response.status,
        providerRequestId: requestId,
        outcome: "failed_without_usage",
      });
      throw new AdultOffClassifierCallError(
        "OpenAI response body unreadable",
        "invalid_response_json",
        failureUsage({
          startedAt,
          outcome: "invalid_response_json",
          httpStatus: response.status,
          providerRequestId: requestId,
        })
      );
    }

    const tokens = reportedTokens(parsed.usage);
    const billedCostUsd = officialBilledCostUsd(parsed);
    const content = parsed.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    const ledgerTokens = {
      inputTokens: tokens.inputTokens ?? undefined,
      outputTokens: tokens.outputTokens ?? undefined,
      cacheReadTokens: tokens.cacheReadTokens ?? undefined,
      cacheWriteTokens: tokens.cacheWriteTokens ?? undefined,
      reasoningTokens: tokens.reasoningTokens ?? undefined,
      upstreamCostUsd: billedCostUsd ?? undefined,
      providerRequestId: requestId,
      httpStatus: response.status,
    };

    if (!text) {
      settleLedger(attempt, {
        actualProvider: ADULT_OFF_CLASSIFIER_PROVIDER,
        actualModel: ADULT_OFF_CLASSIFIER_MODEL,
        ...ledgerTokens,
        outcome: tokens.inputTokens == null ? "failed_without_usage" : "failed_with_usage",
      });
      throw new AdultOffClassifierCallError(
        "OpenAI empty completion",
        "empty_completion",
        failureUsage({
          startedAt,
          outcome: "empty_completion",
          httpStatus: response.status,
          providerRequestId: requestId,
          inputTokens: tokens.inputTokens,
          outputTokens: tokens.outputTokens,
          costUsd: billedCostUsd,
        })
      );
    }

    settleLedger(attempt, {
      actualProvider: ADULT_OFF_CLASSIFIER_PROVIDER,
      actualModel: ADULT_OFF_CLASSIFIER_MODEL,
      ...ledgerTokens,
      outcome: "success",
    });

    const usageBase = {
      model: ADULT_OFF_CLASSIFIER_MODEL,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      costUsd: billedCostUsd,
      providerRequestId: requestId,
      latencyMs: Date.now() - startedAt,
      httpStatus: null,
    };
    try {
      const verdict = parseAdultOffClassifierOutput(text);
      return { verdict, usage: { ...usageBase, outcome: "ok" } };
    } catch (error) {
      if (error instanceof AdultOffClassifierOutputError) {
        throw new AdultOffClassifierCallError(error.message, "invalid_output", {
          ...usageBase,
          outcome: "invalid_output",
        });
      }
      throw error;
    }
  };
}
