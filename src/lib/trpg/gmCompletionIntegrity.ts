import { attachTrpgCallFailureMeta } from "./startFailure";
import { isTrpgGmStructuredShape, parseTrpgGmStructuredJson } from "./gmStructuredOutput";

/** Provider terminal reasons that must not commit as a healthy GM round. */
export const GM_ABNORMAL_PROVIDER_FINISH_REASONS = ["length", "content_filter", "error"] as const;

export type GmCompletionIntegrityStatus =
  | "healthy"
  | "abnormal_finish_reason"
  | "missing_structured_output"
  | "empty_narration"
  | "empty_output";

/** Provider terminal metadata used for integrity policy (not transport diagnostics). */
export type GmCompletionTransportMeta = {
  finishReason?: string | null;
};

export type GmCompletionIntegrityAssessment = {
  ok: boolean;
  status: GmCompletionIntegrityStatus;
  error?: string;
};

/** Preserve the last non-null terminal finish_reason from provider SSE payloads. */
export function finishReasonFromSsePayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const reason = (payload as { choices?: Array<{ finish_reason?: unknown }> }).choices?.[0]?.finish_reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed ? trimmed : null;
}

export function isGmAbnormalProviderFinishReason(finishReason: string | null | undefined): boolean {
  if (!finishReason) return false;
  return (GM_ABNORMAL_PROVIDER_FINISH_REASONS as readonly string[]).includes(finishReason.toLowerCase());
}

/** Single canonical GM completion integrity owner — assess before parse/commit. */
export function assessGmCompletionIntegrity(
  raw: string,
  transport?: GmCompletionTransportMeta
): GmCompletionIntegrityAssessment {
  const text = raw.trim();
  if (!text) {
    return { ok: false, status: "empty_output", error: "empty GM provider output" };
  }
  if (isGmAbnormalProviderFinishReason(transport?.finishReason)) {
    return {
      ok: false,
      status: "abnormal_finish_reason",
      error: `abnormal provider completion: ${transport!.finishReason}`,
    };
  }
  const parsed = parseTrpgGmStructuredJson(text);
  if (!isTrpgGmStructuredShape(parsed)) {
    return {
      ok: false,
      status: "missing_structured_output",
      error: "GM output missing required structured narration/delta JSON",
    };
  }
  if (!parsed.narration.trim()) {
    return {
      ok: false,
      status: "empty_narration",
      error: "GM narration is empty",
    };
  }
  return { ok: true, status: "healthy" };
}

export function assertGmCompletionCanCommit(
  raw: string,
  transport?: GmCompletionTransportMeta,
  precomputed?: GmCompletionIntegrityAssessment
): void {
  const assessment = precomputed ?? assessGmCompletionIntegrity(raw, transport);
  if (assessment.ok) return;
  throw attachTrpgCallFailureMeta(new Error(`[TRPG] ${assessment.error}`), {
    stage: assessment.status === "abnormal_finish_reason" ? "provider_call" : "gm_output_parse",
    reasoningTokens: "unavailable",
  });
}

export function completionIntegrityStatusLabel(
  assessment: GmCompletionIntegrityAssessment
): string {
  switch (assessment.status) {
    case "healthy":
      return "HEALTHY";
    case "abnormal_finish_reason":
      return assessment.error?.includes("length") ? "ABNORMAL_FINISH_LENGTH" : "ABNORMAL_FINISH";
    case "missing_structured_output":
      return "MALFORMED_STRUCTURED_OUTPUT";
    case "empty_narration":
      return "EMPTY_NARRATION";
    case "empty_output":
      return "EMPTY_OUTPUT";
    default: {
      const _exhaustive: never = assessment.status;
      return _exhaustive;
    }
  }
}
