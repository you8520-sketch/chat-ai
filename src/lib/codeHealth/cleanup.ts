import fs from "node:fs";
import path from "node:path";

import { classifyAll, computeDelta, countCandidates, decideRunStatus } from "@/lib/codeHealth/classify";
import type {
  CleanupStopReason,
  CodeHealthCandidate,
  MonthlyCleanupDraftPr,
  MonthlyCleanupReport,
  WeeklyCodeHealthReport,
} from "@/lib/codeHealth/types";
import {
  CODE_HEALTH_CLEANUP_AUTO_MERGE,
  CODE_HEALTH_CLEANUP_MAX_ITEMS,
  CODE_HEALTH_AUDIT_VERSION,
  formatTrend,
} from "@/lib/codeHealth/types";
import { weeklyReportKey } from "@/lib/codeHealth/audit";

export function mergeWeeklyCandidates(
  weeklies: readonly WeeklyCodeHealthReport[]
): CodeHealthCandidate[] {
  const byId = new Map<string, CodeHealthCandidate>();
  for (const weekly of weeklies) {
    for (const candidate of weekly.candidates) {
      byId.set(candidate.id, candidate);
    }
  }
  return classifyAll([...byId.values()]);
}

export function revalidateOnCurrentMain(
  candidate: CodeHealthCandidate,
  current: readonly CodeHealthCandidate[]
): boolean {
  return current.some((row) => row.id === candidate.id);
}

export function isEligibleCleanupCandidate(
  candidate: CodeHealthCandidate,
  current: readonly CodeHealthCandidate[]
): { ok: true } | { ok: false; reason: CleanupStopReason | "not_safe_to_delete" } {
  if (candidate.classification !== "SAFE_TO_DELETE") {
    return { ok: false, reason: "not_safe_to_delete" };
  }
  if (!revalidateOnCurrentMain(candidate, current)) {
    return { ok: false, reason: "unconfirmed_production_usage" };
  }
  if (candidate.stopReasons.length > 0) {
    return { ok: false, reason: candidate.stopReasons[0]! };
  }
  if (candidate.evidence.productionExecutionPath !== false) {
    return { ok: false, reason: "unconfirmed_production_usage" };
  }
  if (candidate.evidence.dbExistingDataImpact !== false) {
    return { ok: false, reason: "destructive_migration" };
  }
  if (candidate.kind !== "unused_file") {
    return { ok: false, reason: "unrelated_large_refactor" };
  }
  return { ok: true };
}

export function selectCleanupBatch(
  candidates: readonly CodeHealthCandidate[],
  current: readonly CodeHealthCandidate[],
  maxItems = CODE_HEALTH_CLEANUP_MAX_ITEMS
): {
  eligible: CodeHealthCandidate[];
  rejected: Array<{ reason: CleanupStopReason | "not_safe_to_delete"; count: number }>;
} {
  const rejectedMap = new Map<CleanupStopReason | "not_safe_to_delete", number>();
  const eligible: CodeHealthCandidate[] = [];
  for (const candidate of candidates) {
    const gate = isEligibleCleanupCandidate(candidate, current);
    if (!gate.ok) {
      rejectedMap.set(gate.reason, (rejectedMap.get(gate.reason) ?? 0) + 1);
      continue;
    }
    if (eligible.length < maxItems) eligible.push(candidate);
  }
  return {
    eligible,
    rejected: [...rejectedMap.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

export function planCleanupDraftPr(params: {
  eligible: readonly CodeHealthCandidate[];
  createPr: boolean;
  url?: string | null;
}): MonthlyCleanupDraftPr {
  if (CODE_HEALTH_CLEANUP_AUTO_MERGE) {
    throw new Error("cleanup auto-merge is forbidden");
  }
  if (params.eligible.length === 0) {
    return {
      created: false,
      url: null,
      reason: "no SAFE_TO_DELETE candidates passed every monthly gate",
      selectedIds: [],
    };
  }
  if (!params.createPr) {
    return {
      created: false,
      url: null,
      reason: "eligible set exists but Draft PR creation was not enabled for this run",
      selectedIds: params.eligible.map((c) => c.id),
    };
  }
  return {
    created: true,
    url: params.url ?? null,
    reason: "bounded unused-file Draft PR — never auto-merged",
    selectedIds: params.eligible.map((c) => c.id),
  };
}

export function runMonthlyCleanup(params: {
  weeklies: readonly WeeklyCodeHealthReport[];
  currentCandidates: readonly CodeHealthCandidate[];
  mainSha: string;
  now?: Date;
  previous?: MonthlyCleanupReport | null;
  createPr?: boolean;
  draftPrUrl?: string | null;
  githubRunUrl?: string | null;
  notes?: string[];
}): MonthlyCleanupReport {
  const merged = mergeWeeklyCandidates(params.weeklies);
  const { eligible, rejected } = selectCleanupBatch(merged, params.currentCandidates);
  const counts = countCandidates(merged, params.previous?.candidates ?? null);
  const draftPr = planCleanupDraftPr({
    eligible,
    createPr: params.createPr === true,
    url: params.draftPrUrl ?? null,
  });

  return {
    kind: "monthly",
    version: CODE_HEALTH_AUDIT_VERSION,
    ranAt: (params.now ?? new Date()).toISOString(),
    mainSha: params.mainSha,
    status: decideRunStatus(merged),
    counts,
    previousCounts: params.previous?.counts ?? null,
    delta: computeDelta(counts, params.previous?.counts ?? null),
    mergedWeeklyKeys: params.weeklies.map(weeklyReportKey),
    candidates: merged,
    eligibleIds: eligible.map((c) => c.id),
    rejectedByGate: rejected,
    draftPr,
    changeBudget: { maxItems: CODE_HEALTH_CLEANUP_MAX_ITEMS, selected: eligible.length },
    productionMutated: false,
    autoMerged: false,
    githubRunUrl: params.githubRunUrl ?? null,
    notes: [
      ...(params.notes ?? []),
      "Monthly cleanup never auto-merges and never applies destructive migrations.",
      "UNCONFIRMED candidates are not modified.",
    ],
  };
}

export function applyEligibleUnusedFileDeletes(
  repoRoot: string,
  eligible: readonly CodeHealthCandidate[]
): string[] {
  const deleted: string[] = [];
  for (const candidate of eligible) {
    if (candidate.classification !== "SAFE_TO_DELETE" || candidate.kind !== "unused_file") {
      continue;
    }
    const abs = path.join(repoRoot, candidate.path);
    if (!fs.existsSync(abs)) continue;
    fs.unlinkSync(abs);
    deleted.push(candidate.path);
  }
  return deleted;
}

export function renderMonthlyMarkdown(report: MonthlyCleanupReport): string {
  const d = report.delta;
  return [
    "# Monthly Cleanup",
    "",
    `- ranAt: \`${report.ranAt}\``,
    `- main: \`${report.mainSha}\``,
    `- status: **${report.status}**`,
    `- draft PR created: \`${String(report.draftPr.created)}\``,
    `- autoMerged: \`${String(report.autoMerged)}\``,
    `- change budget: ${report.changeBudget.selected} / ${report.changeBudget.maxItems}`,
    "",
    "## Trend",
    "",
    d
      ? [
          `- unused candidates ${formatTrend(d.unusedCandidates)}`,
          `- duplicate owner ${formatTrend(d.duplicateOwners)}`,
          `- obsolete env ${formatTrend(d.obsoleteEnvs)}`,
          `- flaky CI candidate ${formatTrend(d.flakyCiCandidates)}`,
        ].join("\n")
      : "- no previous run",
    "",
    "## Eligible SAFE_TO_DELETE",
    "",
    ...(report.eligibleIds.length > 0 ? report.eligibleIds.map((id) => `- ${id}`) : ["- (none)"]),
    "",
    "## Rejected by gate",
    "",
    ...(report.rejectedByGate.length > 0
      ? report.rejectedByGate.map((row) => `- ${row.reason}: ${row.count}`)
      : ["- (none)"]),
    "",
    `Draft PR: ${report.draftPr.reason}`,
    report.draftPr.url ? `Link: ${report.draftPr.url}` : "",
    "",
  ].join("\n");
}
