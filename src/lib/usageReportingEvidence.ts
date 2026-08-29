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
  if (typeof raw !== "number" && typeof raw !== "string") return false;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n);
}

export function isInvalidReportedTokenValue(raw: unknown): boolean {
  return !isValidReportedTokenValue(raw);
}

/** Merge field evidence across partial stages (recovery/continuation). */
export function mergeFieldReportingStatus(
  a: UsageFieldReportingStatus,
  b: UsageFieldReportingStatus
): UsageFieldReportingStatus {
  if (a === "reported_valid" || b === "reported_valid") return "reported_valid";
  if (a === "reported_invalid" || b === "reported_invalid") return "reported_invalid";
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
