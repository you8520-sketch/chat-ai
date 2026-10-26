import "server-only";

import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import {
  CompatibleCompletionError,
  callOpenRouterCompletion,
} from "@/lib/openRouterCompletion";
import type { ProviderCostLedgerContext } from "@/lib/providerCostLedger";
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

/**
 * 성인 OFF 출력 검사용 독립 분류 모델. Main RP 모델과 호출·컨텍스트를 공유하지 않는다.
 * 단일 시도다: 실패는 자동 재시도하지 않고 호출자가 미승인으로 처리한다.
 */
export const ADULT_OFF_CLASSIFIER_MODEL = CHEAPER_INFERENCE_GPT_6_LUNA_MODEL;
export const ADULT_OFF_CLASSIFIER_REQUEST_KIND = "adult-off-output-moderation";
/** 사용자 응답을 막고 기다리는 동기 출력 검사의 기본 상한. CheaperInference Luna 라우팅 지연이 25초를 넘을 수 있다. */
export const ADULT_OFF_CLASSIFIER_TIMEOUT_MS = 60_000;
export const ADULT_OFF_CLASSIFIER_MAX_TOKENS = 200;

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
    requestedProvider: "cheaperinference",
    requestedModel: ADULT_OFF_CLASSIFIER_MODEL,
    requestKind: ADULT_OFF_CLASSIFIER_REQUEST_KIND,
    costCenter: "moderation",
  };
}

function isTimeoutLike(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
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

function toCallError(error: unknown, startedAt: number): AdultOffClassifierCallError {
  if (error instanceof CompatibleCompletionError) {
    const usage = error.usage;
    const timedOut = isTimeoutLike(error.cause);
    const outcome: Exclude<AdultOffClassifierCallOutcome, "ok"> = timedOut
      ? "timeout"
      : usage
        ? "empty_completion"
        : error.httpStatus != null && error.httpStatus >= 400
          ? "http_error"
          : "invalid_response_json";
    return new AdultOffClassifierCallError(
      error.message,
      outcome,
      failureUsage({
        startedAt,
        outcome,
        httpStatus: error.httpStatus,
        providerRequestId: error.providerRequestId,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        costUsd: usage?.cheaperInferenceBilledCostUsd ?? usage?.upstreamCostUsd,
      })
    );
  }
  const outcome = isTimeoutLike(error) ? "timeout" : "transport_error";
  return new AdultOffClassifierCallError(
    (error as Error | undefined)?.message ?? String(error),
    outcome,
    failureUsage({ startedAt, outcome, httpStatus: null, providerRequestId: null })
  );
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
  const ledgerContext = buildAdultOffClassifierLedgerContext(scope);
  return async (windowText): Promise<AdultOffClassifierResult> => {
    const startedAt = Date.now();
    let completion: Awaited<ReturnType<typeof callOpenRouterCompletion>>;
    try {
      completion = await callOpenRouterCompletion({
        system: ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT,
        history: [{ role: "user", content: buildAdultOffClassifierUserMessage(windowText) }],
        model: ADULT_OFF_CLASSIFIER_MODEL,
        temperature: 0,
        maxTokens: ADULT_OFF_CLASSIFIER_MAX_TOKENS,
        disableReasoning: true,
        requestKind: ADULT_OFF_CLASSIFIER_REQUEST_KIND,
        timeoutMs,
        ledgerContext,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: ADULT_OFF_CLASSIFIER_SCHEMA_NAME,
            strict: true,
            schema: ADULT_OFF_CLASSIFIER_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      });
    } catch (error) {
      throw toCallError(error, startedAt);
    }
    const usage = completion.usage;
    const base = {
      model: ADULT_OFF_CLASSIFIER_MODEL,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      costUsd: usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? null,
      providerRequestId: usage.providerRequestId ?? null,
      latencyMs: Date.now() - startedAt,
      httpStatus: null,
    };
    try {
      const verdict = parseAdultOffClassifierOutput(completion.text);
      return { verdict, usage: { ...base, outcome: "ok" } };
    } catch (error) {
      if (error instanceof AdultOffClassifierOutputError) {
        throw new AdultOffClassifierCallError(error.message, "invalid_output", {
          ...base,
          outcome: "invalid_output",
        });
      }
      throw error;
    }
  };
}
