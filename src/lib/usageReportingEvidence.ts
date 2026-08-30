/**
 * Canonical reporting-presence / validity evidence for billable usage fields.
 * Numeric token values remain owned by existing parsers; this module owns
 * whether a field was unreported, validly reported, or invalidly reported.
 */
import type { TokenUsage } from "@/lib/ai";

export type UsageFieldReportingStatus =
  | "unreported"
  | "reported_valid"
  | "reported_invalid";

export type UsageReportingEvidence = {
  cacheRead: UsageFieldReportingStatus;
  cacheWrite: UsageFieldReportingStatus;
  reasoning: UsageFieldReportingStatus;
};

export function isValidReportedTokenValue(raw: unknown): boolean {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 && Number.isInteger(raw);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return false;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 && Number.isInteger(n);
  }
  return false;
}

export function isInvalidReportedTokenValue(raw: unknown): boolean {
  return !isValidReportedTokenValue(raw);
}

/** Merge field evidence across partial stages (recovery/continuation). Invalid dominates. */
export function mergeFieldReportingStatus(
  a: UsageFieldReportingStatus,
  b: UsageFieldReportingStatus
): UsageFieldReportingStatus {
  if (a === "reported_invalid" || b === "reported_invalid") return "reported_invalid";
  if (a === "reported_valid" || b === "reported_valid") return "reported_valid";
  return "unreported";
}

export function mergeUsageReportingEvidence(
  a?: UsageReportingEvidence,
  b?: UsageReportingEvidence
): UsageReportingEvidence | undefined {
  if (!a && !b) return undefined;
  return {
    cacheRead: mergeFieldReportingStatus(
      a?.cacheRead ?? "unreported",
      b?.cacheRead ?? "unreported"
    ),
    cacheWrite: mergeFieldReportingStatus(
      a?.cacheWrite ?? "unreported",
      b?.cacheWrite ?? "unreported"
    ),
    reasoning: mergeFieldReportingStatus(
      a?.reasoning ?? "unreported",
      b?.reasoning ?? "unreported"
    ),
  };
}

/** Single TokenUsage → StageUsage evidence spread (production writers). */
export function stageUsageReportingEvidenceFromTokenUsage(
  usage: Pick<TokenUsage, "usageReportingEvidence">
): { usageReportingEvidence?: UsageReportingEvidence } {
  return usage.usageReportingEvidence
    ? { usageReportingEvidence: usage.usageReportingEvidence }
    : {};
}

export function unreportedUsageReportingEvidence(): UsageReportingEvidence {
  return {
    cacheRead: "unreported",
    cacheWrite: "unreported",
    reasoning: "unreported",
  };
}

/** Runtime-only evidence — strip before persisting usage.stages JSON. */
export function stripUsageReportingEvidenceFromStage<T extends { usageReportingEvidence?: UsageReportingEvidence }>(
  stage: T
): Omit<T, "usageReportingEvidence"> {
  const { usageReportingEvidence: _evidence, ...rest } = stage;
  return rest;
}
