/**
 * Read-only dual-run canary comparison — legacy route basis vs candidate.
 */
import type { TurnBillableUsageResolution } from "@/lib/turnBillableUsage";
import type { UserBillableUsageCoverage } from "@/lib/billingUsage";

export type LegacyTurnUsageBasis = {
  routeTotalInput: number;
  routeChargeOutput: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  apiCompletionTotal: number;
  reasoningTotal: number;
};

export type TurnUsageCanaryComparison =
  | { status: "match" }
  | { status: "mismatch"; fields: string[] }
  | {
      status: "not_comparable";
      reason: string;
      candidateStatus: "resolved" | "unavailable";
      usageCoverage: UserBillableUsageCoverage;
    };

export function compareTurnBillableUsageWithLegacy(
  candidate: TurnBillableUsageResolution,
  legacy: LegacyTurnUsageBasis
): TurnUsageCanaryComparison {
  if (candidate.status !== "resolved") {
    return {
      status: "not_comparable",
      reason: candidate.reason,
      candidateStatus: "unavailable",
      usageCoverage: candidate.usageCoverage,
    };
  }
  if (candidate.usageCoverage !== "complete") {
    return {
      status: "not_comparable",
      reason: candidate.diagnostics.coverageReasons.join(",") || "partial_or_unknown_coverage",
      candidateStatus: "resolved",
      usageCoverage: candidate.usageCoverage,
    };
  }

  const u = candidate.usage;
  const d = candidate.diagnostics;
  const mismatches: string[] = [];
  if (u.promptTokens !== legacy.routeTotalInput) mismatches.push("prompt");
  if (u.cacheReadTokens !== legacy.cacheReadTokens) mismatches.push("cacheRead");
  if (u.cacheWriteTokens !== legacy.cacheWriteTokens) mismatches.push("cacheWrite");
  if (d.apiCompletionTokensForCost !== legacy.apiCompletionTotal) mismatches.push("completionBasis");
  if (u.reasoningTokens !== legacy.reasoningTotal) mismatches.push("reasoning");
  if (d.routeChargeOutputTokens !== legacy.routeChargeOutput) mismatches.push("routeChargeOutput");

  if (mismatches.length > 0) {
    return { status: "mismatch", fields: mismatches };
  }
  return { status: "match" };
}
