/**
 * Compare candidate turn usage against legacy route-computed values.
 * Pure read-only diagnostic — no billing side effects.
 */
import type { TurnBillableUsageResolution } from "@/lib/turnBillableUsage";

export type LegacyTurnUsageBasis = {
  totalInput: number;
  totalOutput: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  apiCompletionTotal: number;
  reasoningTotal: number;
};

export function compareTurnBillableUsageWithLegacy(
  candidate: TurnBillableUsageResolution,
  legacy: LegacyTurnUsageBasis
): string[] {
  if (candidate.status !== "resolved" || candidate.usageCoverage !== "complete") {
    return [];
  }
  const mismatches: string[] = [];
  const u = candidate.usage;
  const d = candidate.diagnostics;
  if (u.promptTokens !== legacy.totalInput) mismatches.push("prompt");
  if (u.cacheReadTokens !== legacy.cacheReadTokens) mismatches.push("cacheRead");
  if (u.cacheWriteTokens !== legacy.cacheWriteTokens) mismatches.push("cacheWrite");
  if (d.apiCompletionTotalTokens !== legacy.apiCompletionTotal) mismatches.push("completionBasis");
  if (u.reasoningTokens !== legacy.reasoningTotal) mismatches.push("reasoning");
  if (d.legacyChargeOutputTokens !== legacy.totalOutput) mismatches.push("legacyChargeOutput");
  return mismatches;
}
