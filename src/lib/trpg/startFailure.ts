import { TRPG_GM_MODEL } from "./types";

export const TRPG_START_FAILURE_CLASSES = ["A", "B", "C"] as const;
export type TrpgStartFailureClass = (typeof TRPG_START_FAILURE_CLASSES)[number];

export const TRPG_FAILURE_KINDS = [
  "provider_timeout",
  "provider_http",
  "empty_completion",
  "parse_state",
  "unknown",
] as const;
export type TrpgFailureKind = (typeof TRPG_FAILURE_KINDS)[number];

export type TrpgStartFailure = {
  class: TrpgStartFailureClass;
  error: string;
  kind?: TrpgFailureKind;
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
};

const PRE_GM_MESSAGE =
  /찾을 수 없|방장만|이미 시작|시트를 만들어야|로그인이 필요|관리자만|잘못된 캠페인/;

const PROVIDER_MESSAGE =
  /\[TRPG\]\s+\d{3}|timeout|AbortError|TimeoutError|empty completion|fetch failed|ECONN|ETIMEDOUT|UND_ERR|NO_CHEAPER_INFERENCE_KEY/i;

const HTTP_STATUS_RE = /\[TRPG\]\s+(\d{3})\b/;

export function classifyTrpgStartFailure(opts: {
  error: unknown;
  /** True when opening round 0 was inserted before the GM ran. */
  reachedOpeningRound?: boolean;
  /** Usage rows written after a successful GM provider response. */
  gmUsageCount?: number;
}): TrpgStartFailure {
  const error = opts.error instanceof Error ? opts.error.message : String(opts.error ?? "start failed");
  if (!opts.reachedOpeningRound) {
    return { class: "A", error };
  }
  if ((opts.gmUsageCount ?? 0) > 0) {
    return { class: "C", error };
  }
  if (PRE_GM_MESSAGE.test(error) && !PROVIDER_MESSAGE.test(error)) {
    return { class: "A", error };
  }
  return { class: "B", error };
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
  classified: TrpgStartFailure;
  error: unknown;
}): TrpgFailureKind {
  if (opts.classified.class === "C") return "parse_state";
  if (opts.classified.class === "A") return "unknown";
  const raw = opts.classified.error;
  const name = opts.error instanceof Error ? opts.error.name : "";
  if (/empty completion/i.test(raw)) return "empty_completion";
  if (/timeout|AbortError|TimeoutError|aborted/i.test(raw) || name === "TimeoutError" || name === "AbortError") {
    return "provider_timeout";
  }
  if (extractTrpgHttpStatus(opts.error) != null || HTTP_STATUS_RE.test(raw)) return "provider_http";
  if (PROVIDER_MESSAGE.test(raw)) return "unknown";
  return "unknown";
}

export function attachTrpgCallFailureMeta(error: unknown, meta: TrpgCallFailureMeta): Error {
  const err = error instanceof Error ? error : new Error(String(error ?? "GM call failed"));
  if (meta.elapsedMs != null) (err as Error & TrpgCallFailureMeta).elapsedMs = meta.elapsedMs;
  if (meta.httpStatus !== undefined) (err as Error & TrpgCallFailureMeta).httpStatus = meta.httpStatus;
  if (meta.reasoningTokens !== undefined) {
    (err as Error & TrpgCallFailureMeta).reasoningTokens = meta.reasoningTokens;
  }
  return err;
}

export function buildTrpgRoundErrorJson(opts: {
  error: unknown;
  reachedOpeningRound?: boolean;
  gmUsageCount?: number;
  model?: string;
  elapsedMs?: number | null;
}): TrpgRoundErrorJson {
  const classified = classifyTrpgStartFailure({
    error: opts.error,
    reachedOpeningRound: opts.reachedOpeningRound,
    gmUsageCount: opts.gmUsageCount,
  });
  const kind = classifyTrpgFailureKind({ classified, error: opts.error });
  const elapsedMs = opts.elapsedMs ?? extractTrpgElapsedMs(opts.error);
  return {
    class: classified.class,
    error: classified.error,
    kind,
    model: opts.model ?? TRPG_GM_MODEL,
    elapsedMs,
    trueOffRequested: true,
    httpStatus: extractTrpgHttpStatus(opts.error),
    reasoningTokens: extractTrpgReasoningTokens(opts.error),
  };
}

export function sanitizeTrpgFailureHint(
  failure: Pick<TrpgStartFailure, "kind" | "httpStatus" | "class" | "error"> | null | undefined
): string {
  if (!failure) return "GM 생성 실패";
  const kind =
    failure.kind ??
    classifyTrpgFailureKind({
      classified: { class: failure.class, error: failure.error },
      error: failure.error,
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
    case "parse_state":
      return "GM 생성 실패 · Parse/state error";
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
      model?: unknown;
      elapsedMs?: unknown;
      trueOffRequested?: unknown;
      httpStatus?: unknown;
      reasoningTokens?: unknown;
    };
    const failureClass = TRPG_START_FAILURE_CLASSES.find((item) => item === parsed.class);
    const error = typeof parsed.error === "string" && parsed.error.trim() ? parsed.error : raw;
    const kind = TRPG_FAILURE_KINDS.find((item) => item === parsed.kind);
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
