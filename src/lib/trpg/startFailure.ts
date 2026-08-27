import {
  classifyTrpgBillingErrorCode,
  extractTrpgBillingErrorCode,
  extractTrpgBillingSubstage,
  parseTrpgBillingErrorCode,
  parseTrpgBillingSubstage,
  sanitizeTrpgBillingFailureHint,
  type TrpgBillingErrorCode,
  type TrpgBillingSubstage,
} from "./billingFailure";
import {
  TRPG_GM_MODEL,
  TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE,
  TRPG_PLAYER_INSUFFICIENT_POINTS_MESSAGE,
} from "./types";

export const TRPG_START_FAILURE_CLASSES = ["A", "B", "C"] as const;
export type TrpgStartFailureClass = (typeof TRPG_START_FAILURE_CLASSES)[number];

export const TRPG_FAILURE_STAGES = [
  "provider_call",
  "gm_output_parse",
  "asset_tagging",
  "state_validation",
  "ledger_apply",
  "gm_persist",
  "story_progress",
  "billing",
  "round_complete",
] as const;
export type TrpgFailureStage = (typeof TRPG_FAILURE_STAGES)[number];

export const TRPG_FAILURE_KINDS = [
  "provider_timeout",
  "provider_http",
  "empty_completion",
  "gm_output_parse",
  "state_error",
  "billing_insufficient",
  "billing_error",
  "persist_error",
  "parse_state",
  "orphan_generation",
  "gm_generation_orphan_reclaimed",
  "unknown",
] as const;
export type TrpgFailureKind = (typeof TRPG_FAILURE_KINDS)[number];

export type TrpgStartFailure = {
  class: TrpgStartFailureClass;
  error: string;
  kind?: TrpgFailureKind;
  stage?: TrpgFailureStage;
  billingSubstage?: TrpgBillingSubstage;
  billingErrorCode?: TrpgBillingErrorCode;
  model?: string;
  elapsedMs?: number | null;
  trueOffRequested?: boolean;
  httpStatus?: number | null;
  reasoningTokens?: number | "unavailable";
};

export type TrpgRoundErrorJson = {
  class: TrpgStartFailureClass;
  error: string;
  kind: TrpgFailureKind;
  stage?: TrpgFailureStage;
  billingSubstage?: TrpgBillingSubstage;
  billingErrorCode?: TrpgBillingErrorCode;
  model: string;
  elapsedMs: number | null;
  trueOffRequested: true;
  httpStatus: number | null;
  reasoningTokens: number | "unavailable";
};

export type TrpgCallFailureMeta = {
  elapsedMs?: number;
  httpStatus?: number | null;
  reasoningTokens?: number | "unavailable";
  stage?: TrpgFailureStage;
  billingSubstage?: TrpgBillingSubstage;
  billingErrorCode?: TrpgBillingErrorCode;
};

const PRE_GM_MESSAGE =
  /찾을 수 없|방장만|이미 시작|시트를 만들어야|로그인이 필요|관리자만|잘못된 캠페인/;

const PROVIDER_MESSAGE =
  /\[TRPG\]\s+\d{3}|timeout|AbortError|TimeoutError|empty completion|fetch failed|ECONN|ETIMEDOUT|UND_ERR|NO_CHEAPER_INFERENCE_KEY/i;

const HTTP_STATUS_RE = /\[TRPG\]\s+(\d{3})\b/;

const INSUFFICIENT_MESSAGE =
  /포인트가 부족|방장의 포인트가 부족|플레이어의 포인트가 부족/;

const PARSE_MESSAGE = /<<<NARRATION>>>|<<<DELTA>>>|GM output|parse|JSON/i;
const STATE_MESSAGE = /unknown_participant|hp_out_of_range|duplicate_player|missing_item|state/i;
const PERSIST_MESSAGE = /no such table|SQLITE_|UNIQUE constraint|persist/i;

export function extractTrpgFailureStage(error: unknown): TrpgFailureStage | undefined {
  if (typeof error === "object" && error && "stage" in error) {
    const stage = (error as { stage?: unknown }).stage;
    return TRPG_FAILURE_STAGES.find((item) => item === stage);
  }
  return undefined;
}

export function classifyTrpgStartFailure(opts: {
  error: unknown;
  /** True when opening round 0 was inserted before the GM ran. */
  reachedOpeningRound?: boolean;
  /** Usage rows written after a successful GM provider response. Compatibility only. */
  gmUsageCount?: number;
  stage?: TrpgFailureStage;
}): TrpgStartFailure {
  const error = opts.error instanceof Error ? opts.error.message : String(opts.error ?? "start failed");
  const stage = opts.stage ?? extractTrpgFailureStage(opts.error);
  if (!opts.reachedOpeningRound) {
    return { class: "A", error, stage };
  }
  const kind = classifyTrpgFailureKind({
    classified: { class: "B", error, stage },
    error: opts.error,
    stage,
  });
  if (
    kind === "provider_timeout" ||
    kind === "provider_http" ||
    kind === "empty_completion"
  ) {
    return { class: "B", error, stage };
  }
  if (PRE_GM_MESSAGE.test(error) && !PROVIDER_MESSAGE.test(error) && !stage) {
    return { class: "A", error, stage };
  }
  if (stage && stage !== "provider_call") {
    return { class: "C", error, stage };
  }
  if ((opts.gmUsageCount ?? 0) > 0) {
    return { class: "C", error, stage };
  }
  return { class: "B", error, stage };
}

export function extractTrpgHttpStatus(error: unknown): number | null {
  if (typeof error === "object" && error && "httpStatus" in error) {
    const status = (error as { httpStatus?: unknown }).httpStatus;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const match = HTTP_STATUS_RE.exec(raw);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

export function extractTrpgElapsedMs(error: unknown): number | null {
  if (typeof error === "object" && error && "elapsedMs" in error) {
    const elapsed = (error as { elapsedMs?: unknown }).elapsedMs;
    if (typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0) return Math.round(elapsed);
  }
  return null;
}

export function extractTrpgReasoningTokens(error: unknown): number | "unavailable" {
  if (typeof error === "object" && error && "reasoningTokens" in error) {
    const tokens = (error as { reasoningTokens?: unknown }).reasoningTokens;
    if (typeof tokens === "number" && Number.isFinite(tokens)) return tokens;
  }
  return "unavailable";
}

export function classifyTrpgFailureKind(opts: {
  classified: Pick<TrpgStartFailure, "class" | "error" | "stage">;
  error: unknown;
  stage?: TrpgFailureStage;
}): TrpgFailureKind {
  const raw = opts.classified.error;
  const name = opts.error instanceof Error ? opts.error.name : "";
  const stage = opts.stage ?? opts.classified.stage ?? extractTrpgFailureStage(opts.error);

  if (
    INSUFFICIENT_MESSAGE.test(raw) ||
    raw === TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE ||
    raw === TRPG_PLAYER_INSUFFICIENT_POINTS_MESSAGE
  ) {
    return "billing_insufficient";
  }
  if (stage === "billing") return "billing_error";
  if (/orphan generation|lease expired without completing|gm_generation_orphan_reclaimed/i.test(raw)) {
    return "gm_generation_orphan_reclaimed";
  }
  if (/empty completion/i.test(raw)) return "empty_completion";
  if (/timeout|AbortError|TimeoutError|aborted/i.test(raw) || name === "TimeoutError" || name === "AbortError") {
    return "provider_timeout";
  }
  if (extractTrpgHttpStatus(opts.error) != null || HTTP_STATUS_RE.test(raw)) return "provider_http";
  if (stage === "gm_output_parse" || PARSE_MESSAGE.test(raw)) return "gm_output_parse";
  if (stage === "state_validation" || STATE_MESSAGE.test(raw)) return "state_error";
  if (
    stage === "gm_persist" ||
    stage === "story_progress" ||
    stage === "ledger_apply" ||
    stage === "round_complete" ||
    PERSIST_MESSAGE.test(raw)
  ) {
    return "persist_error";
  }
  if (stage === "asset_tagging") return "state_error";
  if (PROVIDER_MESSAGE.test(raw) || stage === "provider_call") return "unknown";
  return "unknown";
}

export function attachTrpgCallFailureMeta(error: unknown, meta: TrpgCallFailureMeta): Error {
  const err = error instanceof Error ? error : new Error(String(error ?? "GM call failed"));
  if (meta.elapsedMs != null) (err as Error & TrpgCallFailureMeta).elapsedMs = meta.elapsedMs;
  if (meta.httpStatus !== undefined) (err as Error & TrpgCallFailureMeta).httpStatus = meta.httpStatus;
  if (meta.reasoningTokens !== undefined) {
    (err as Error & TrpgCallFailureMeta).reasoningTokens = meta.reasoningTokens;
  }
  if (meta.stage && !(err as Error & TrpgCallFailureMeta).stage) {
    (err as Error & TrpgCallFailureMeta).stage = meta.stage;
  }
  if (meta.billingSubstage && !(err as Error & TrpgCallFailureMeta).billingSubstage) {
    (err as Error & TrpgCallFailureMeta).billingSubstage = meta.billingSubstage;
  }
  if (meta.billingErrorCode && !(err as Error & TrpgCallFailureMeta).billingErrorCode) {
    (err as Error & TrpgCallFailureMeta).billingErrorCode = meta.billingErrorCode;
  }
  return err;
}

export function buildTrpgRoundErrorJson(opts: {
  error: unknown;
  reachedOpeningRound?: boolean;
  gmUsageCount?: number;
  model?: string;
  elapsedMs?: number | null;
  stage?: TrpgFailureStage;
}): TrpgRoundErrorJson {
  const stage = opts.stage ?? extractTrpgFailureStage(opts.error);
  const classified = classifyTrpgStartFailure({
    error: opts.error,
    reachedOpeningRound: opts.reachedOpeningRound,
    gmUsageCount: opts.gmUsageCount,
    stage,
  });
  const kind = classifyTrpgFailureKind({ classified, error: opts.error, stage });
  const elapsedMs = opts.elapsedMs ?? extractTrpgElapsedMs(opts.error);
  const billingSubstage = extractTrpgBillingSubstage(opts.error);
  const billingErrorCode =
    extractTrpgBillingErrorCode(opts.error) ??
    (stage === "billing" || kind === "billing_error" || kind === "billing_insufficient"
      ? classifyTrpgBillingErrorCode({ substage: billingSubstage, error: opts.error })
      : undefined);
  return {
    class: classified.class,
    error: classified.error,
    kind,
    stage,
    billingSubstage,
    billingErrorCode: kind === "billing_error" || kind === "billing_insufficient" ? billingErrorCode : undefined,
    model: opts.model ?? TRPG_GM_MODEL,
    elapsedMs,
    trueOffRequested: true,
    httpStatus: extractTrpgHttpStatus(opts.error),
    reasoningTokens: extractTrpgReasoningTokens(opts.error),
  };
}

export function sanitizeTrpgFailureHint(
  failure: Pick<
    TrpgStartFailure,
    "kind" | "httpStatus" | "class" | "error" | "stage" | "billingSubstage"
  > | null | undefined
): string {
  if (!failure) return "GM 생성 실패";
  const kind =
    failure.kind ??
    classifyTrpgFailureKind({
      classified: { class: failure.class, error: failure.error, stage: failure.stage },
      error: failure.error,
      stage: failure.stage,
    });
  switch (kind) {
    case "provider_timeout":
      return "GM 생성 실패 · Provider timeout (180초)";
    case "provider_http": {
      const status = failure.httpStatus ?? extractTrpgHttpStatus(failure.error);
      if (status != null && status >= 500) return "GM 생성 실패 · Provider HTTP 5xx";
      if (status != null) return `GM 생성 실패 · Provider HTTP ${status}`;
      return "GM 생성 실패 · Provider HTTP";
    }
    case "empty_completion":
      return "GM 생성 실패 · Empty completion";
    case "gm_output_parse":
      return "GM 생성 실패 · GM output parse";
    case "state_error":
      return "GM 생성 실패 · State error";
    case "billing_insufficient":
      if (failure.error === TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE) {
        return TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE;
      }
      return TRPG_PLAYER_INSUFFICIENT_POINTS_MESSAGE;
    case "billing_error":
      return sanitizeTrpgBillingFailureHint(failure.billingSubstage);
    case "persist_error":
      return "GM 생성 실패 · Persist error";
    case "parse_state":
      return "GM 생성 실패 · Parse/state error";
    case "orphan_generation":
    case "gm_generation_orphan_reclaimed":
      return "GM 생성 실패 · Generation lease expired";
    case "unknown":
      return "GM 생성 실패";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function parseTrpgStartFailureJson(raw: string | null | undefined): TrpgStartFailure | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as {
      class?: unknown;
      error?: unknown;
      kind?: unknown;
      stage?: unknown;
      billingSubstage?: unknown;
      billingErrorCode?: unknown;
      model?: unknown;
      elapsedMs?: unknown;
      trueOffRequested?: unknown;
      httpStatus?: unknown;
      reasoningTokens?: unknown;
    };
    const failureClass = TRPG_START_FAILURE_CLASSES.find((item) => item === parsed.class);
    const error = typeof parsed.error === "string" && parsed.error.trim() ? parsed.error : raw;
    const kind = TRPG_FAILURE_KINDS.find((item) => item === parsed.kind);
    const stage = TRPG_FAILURE_STAGES.find((item) => item === parsed.stage);
    const billingSubstage = parseTrpgBillingSubstage(parsed.billingSubstage);
    const billingErrorCode = parseTrpgBillingErrorCode(parsed.billingErrorCode);
    const elapsedMs =
      typeof parsed.elapsedMs === "number" && Number.isFinite(parsed.elapsedMs) ? parsed.elapsedMs : null;
    const httpStatus =
      typeof parsed.httpStatus === "number" && Number.isFinite(parsed.httpStatus) ? parsed.httpStatus : null;
    const reasoningTokens =
      typeof parsed.reasoningTokens === "number" && Number.isFinite(parsed.reasoningTokens)
        ? parsed.reasoningTokens
        : parsed.reasoningTokens === "unavailable"
          ? "unavailable"
          : undefined;
    return {
      class: failureClass ?? "C",
      error,
      kind,
      stage,
      billingSubstage,
      billingErrorCode,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      elapsedMs,
      trueOffRequested: parsed.trueOffRequested === true,
      httpStatus,
      reasoningTokens,
    };
  } catch {
    return { class: "C", error: raw };
  }
}
