import {
  AUTOMATION_REPORTS_GITHUB_REPO,
  type GithubScheduledAutomationGroup,
} from "@/lib/adminAutomationReports";
import { githubReportGetContent } from "@/lib/githubReportClient";
import { latestMonthly, latestWeekly, parseCodeHealthLedger } from "@/lib/codeHealth/ledger";
import type {
  CodeHealthCounts,
  CodeHealthDelta,
  CodeHealthRunStatus,
  MonthlyCleanupReport,
  WeeklyCodeHealthReport,
} from "@/lib/codeHealth/types";
import {
  CODE_HEALTH_LEDGER_BRANCH,
  CODE_HEALTH_MONTHLY_WORKFLOW_PATH,
  CODE_HEALTH_WEEKLY_WORKFLOW_PATH,
  formatTrend,
} from "@/lib/codeHealth/types";

export type CodeHealthAdminCard = {
  title: string;
  kind: "weekly" | "monthly";
  status: CodeHealthRunStatus | "EMPTY" | "UNAVAILABLE";
  ranAt: string | null;
  counts: CodeHealthCounts | null;
  delta: CodeHealthDelta | null;
  githubRunUrl: string | null;
  reportUrl: string | null;
  notes: string[];
  draftPrCreated?: boolean;
  eligibleCount?: number;
};

export type CodeHealthAdminProjection = {
  status: "OK" | "UNAVAILABLE" | "EMPTY";
  error: string | null;
  weekly: CodeHealthAdminCard;
  monthly: CodeHealthAdminCard;
};

function emptyCard(kind: "weekly" | "monthly", title: string): CodeHealthAdminCard {
  return {
    title,
    kind,
    status: "EMPTY",
    ranAt: null,
    counts: null,
    delta: null,
    githubRunUrl: null,
    reportUrl: null,
    notes: ["아직 실행 기록이 없습니다. 첫 scheduled run 이후 여기에 누적됩니다."],
  };
}

function weeklyCard(report: WeeklyCodeHealthReport, runUrl: string | null): CodeHealthAdminCard {
  return {
    title: "Weekly Code Health",
    kind: "weekly",
    status: report.status,
    ranAt: report.ranAt,
    counts: report.counts,
    delta: report.delta,
    githubRunUrl: report.githubRunUrl ?? runUrl,
    reportUrl: report.githubRunUrl ?? runUrl,
    notes: report.notes.slice(0, 3),
  };
}

function monthlyCard(report: MonthlyCleanupReport, runUrl: string | null): CodeHealthAdminCard {
  return {
    title: "Monthly Cleanup",
    kind: "monthly",
    status: report.status,
    ranAt: report.ranAt,
    counts: report.counts,
    delta: report.delta,
    githubRunUrl: report.githubRunUrl ?? runUrl,
    reportUrl: report.draftPr.url ?? report.githubRunUrl ?? runUrl,
    notes: report.notes.slice(0, 3),
    draftPrCreated: report.draftPr.created,
    eligibleCount: report.eligibleIds.length,
  };
}

export async function fetchCodeHealthLedgerRaw(
  fetchImpl: typeof fetch = fetch,
  repo = AUTOMATION_REPORTS_GITHUB_REPO
): Promise<{ status: "OK" | "EMPTY" | "UNAVAILABLE"; error: string | null; raw: string | null }> {
  return githubReportGetContent(
    `https://api.github.com/repos/${repo}/contents/ledger.json?ref=${CODE_HEALTH_LEDGER_BRANCH}`,
    fetchImpl
  );
}

export function projectCodeHealthAdmin(
  ledgerRaw: string | null,
  githubGroups: readonly GithubScheduledAutomationGroup[],
  fetchStatus: "OK" | "EMPTY" | "UNAVAILABLE",
  error: string | null
): CodeHealthAdminProjection {
  const weeklyGroup = githubGroups.find((g) => g.path === CODE_HEALTH_WEEKLY_WORKFLOW_PATH) ?? null;
  const monthlyGroup = githubGroups.find((g) => g.path === CODE_HEALTH_MONTHLY_WORKFLOW_PATH) ?? null;
  const weeklyRunUrl = weeklyGroup?.latest.htmlUrl ?? null;
  const monthlyRunUrl = monthlyGroup?.latest.htmlUrl ?? null;

  if (fetchStatus === "UNAVAILABLE") {
    return {
      status: "UNAVAILABLE",
      error,
      weekly: {
        ...emptyCard("weekly", "Weekly Code Health"),
        status: "UNAVAILABLE",
        githubRunUrl: weeklyRunUrl,
        notes: [error ?? "ledger unavailable"],
      },
      monthly: {
        ...emptyCard("monthly", "Monthly Cleanup"),
        status: "UNAVAILABLE",
        githubRunUrl: monthlyRunUrl,
        notes: [error ?? "ledger unavailable"],
      },
    };
  }

  const ledger = parseCodeHealthLedger(ledgerRaw);
  const weekly = latestWeekly(ledger);
  const monthly = latestMonthly(ledger);
  return {
    status: weekly || monthly ? "OK" : "EMPTY",
    error: null,
    weekly: weekly ? weeklyCard(weekly, weeklyRunUrl) : { ...emptyCard("weekly", "Weekly Code Health"), githubRunUrl: weeklyRunUrl },
    monthly: monthly
      ? monthlyCard(monthly, monthlyRunUrl)
      : { ...emptyCard("monthly", "Monthly Cleanup"), githubRunUrl: monthlyRunUrl },
  };
}

export async function fetchCodeHealthAdminProjection(
  githubGroups: readonly GithubScheduledAutomationGroup[],
  fetchImpl: typeof fetch = fetch
): Promise<CodeHealthAdminProjection> {
  const fetched = await fetchCodeHealthLedgerRaw(fetchImpl);
  return projectCodeHealthAdmin(fetched.raw, githubGroups, fetched.status, fetched.error);
}

export function formatCodeHealthDeltaLines(delta: CodeHealthDelta | null): string[] {
  if (!delta) return ["이전 실행 대비 delta 없음"];
  return [
    `unused candidates ${formatTrend(delta.unusedCandidates)}`,
    `duplicate owner ${formatTrend(delta.duplicateOwners)}`,
    `obsolete env ${formatTrend(delta.obsoleteEnvs)}`,
    `flaky CI candidate ${formatTrend(delta.flakyCiCandidates)}`,
  ];
}
