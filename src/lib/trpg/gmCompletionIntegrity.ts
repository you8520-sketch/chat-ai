import { attachTrpgCallFailureMeta } from "./startFailure";

export const GM_NARRATION_OPEN = "<<<NARRATION>>>";
export const GM_DELTA_OPEN = "<<<DELTA>>>";

/** Provider terminal reasons that must not commit as a healthy GM round. */
export const GM_ABNORMAL_PROVIDER_FINISH_REASONS = ["length", "content_filter"] as const;

export type GmCompletionIntegrityStatus =
  | "healthy"
  | "abnormal_finish_reason"
  | "missing_delta_envelope"
  | "malformed_delta_json"
  | "empty_output";

export type GmCompletionTransportMeta = {
  finishReason?: string | null;
  semanticDone?: boolean;
};

export type GmCompletionIntegrityAssessment = {
  ok: boolean;
  status: GmCompletionIntegrityStatus;
  error?: string;
};

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseDeltaJson(raw: string): Record<string, unknown> | null {
  const trimmed = stripFences(raw.trim());
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

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
  const narAt = text.indexOf(GM_NARRATION_OPEN);
  const deltaAt = text.indexOf(GM_DELTA_OPEN);
  if (deltaAt < 0 || narAt < 0 || deltaAt <= narAt) {
    return {
      ok: false,
      status: "missing_delta_envelope",
      error: "GM output missing required NARRATION/DELTA envelope",
    };
  }
  const deltaJson = parseDeltaJson(text.slice(deltaAt + GM_DELTA_OPEN.length));
  if (!deltaJson) {
    return {
      ok: false,
      status: "malformed_delta_json",
      error: "GM DELTA section is not parseable JSON",
    };
  }
  return { ok: true, status: "healthy" };
}

export function assertGmCompletionCanCommit(raw: string, transport?: GmCompletionTransportMeta): void {
  const assessment = assessGmCompletionIntegrity(raw, transport);
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
    case "missing_delta_envelope":
      return "MALFORMED_ENVELOPE";
    case "malformed_delta_json":
      return "MALFORMED_DELTA";
    case "empty_output":
      return "EMPTY_OUTPUT";
    default: {
      const _exhaustive: never = assessment.status;
      return _exhaustive;
    }
  }
}
