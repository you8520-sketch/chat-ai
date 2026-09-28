import { classifyAll, computeDelta, countCandidates, decideRunStatus } from "@/lib/codeHealth/classify";
import { KNIP_REVIEW_REASON } from "@/lib/codeHealth/ownerMap";
import {
  allScanCandidates,
  buildImportGraph,
  type GithubFailedRun,
  walkSourceFiles,
} from "@/lib/codeHealth/scan";
import type {
  CodeHealthCandidate,
  WeeklyCodeHealthReport,
} from "@/lib/codeHealth/types";
import {
  CODE_HEALTH_AUDIT_MUTATES_PRODUCTION,
  CODE_HEALTH_AUDIT_VERSION,
  formatTrend,
} from "@/lib/codeHealth/types";

export const KNIP_REVIEW = {
  considered: true as const,
  adoptedAsOwner: false as const,
  adoptedAsDeletionProof: false as const,
  reason: KNIP_REVIEW_REASON,
};

export async function fetchRecentFailedGithubRuns(
  fetchImpl: typeof fetch,
  repo: string
): Promise<GithubFailedRun[]> {
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repo}/actions/runs?per_page=50&status=completed`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "chat-ai-code-health-audit",
        },
        cache: "no-store",
      }
    );
    if (!response.ok) return [];
    const body = (await response.json()) as {
      workflow_runs?: Array<Record<string, unknown>>;
    };
    return (body.workflow_runs ?? [])
      .filter((run) => {
        const conclusion = typeof run.conclusion === "string" ? run.conclusion : "";
        return conclusion !== "" && conclusion !== "success" && conclusion !== "skipped";
      })
      .map((run) => ({
        name: typeof run.name === "string" ? run.name : "(unnamed)",
        path: typeof run.path === "string" ? run.path : "",
        conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
        createdAt: typeof run.created_at === "string" ? run.created_at : "",
        htmlUrl: typeof run.html_url === "string" ? run.html_url : "",
      }));
  } catch {
    return [];
  }
}

export function runWeeklyCodeHealthAudit(params: {
  repoRoot: string;
  mainSha: string;
  now?: Date;
  previous?: WeeklyCodeHealthReport | null;
  ciRuns?: GithubFailedRun[];
  githubRunUrl?: string | null;
  allowSafeDelete?: boolean;
  notes?: string[];
}): WeeklyCodeHealthReport {
  if (CODE_HEALTH_AUDIT_MUTATES_PRODUCTION) {
    throw new Error("weekly audit must never mutate production");
  }

  const files = walkSourceFiles(params.repoRoot);
  const graph = buildImportGraph(files);
  const raw = allScanCandidates({
    repoRoot: params.repoRoot,
    files,
    graph,
    ciRuns: params.ciRuns ?? [],
  });
  const candidates = classifyAll(raw, { allowSafeDelete: params.allowSafeDelete });
  const counts = countCandidates(candidates, params.previous?.candidates ?? null);
  const previousCounts = params.previous?.counts ?? null;
  const criticalBugfixCandidates = candidates.filter((c) => c.bugfix);
  const notes = [
    ...(params.notes ?? []),
    "Weekly audit is read-only. It does not patch source, schema, flags, or routing.",
    KNIP_REVIEW_REASON,
  ];

  return {
    kind: "weekly",
    version: CODE_HEALTH_AUDIT_VERSION,
    ranAt: (params.now ?? new Date()).toISOString(),
    mainSha: params.mainSha,
    status: decideRunStatus(candidates),
    counts,
    previousCounts,
    delta: computeDelta(counts, previousCounts),
    candidates,
    criticalBugfixCandidates,
    knipReview: KNIP_REVIEW,
    productionMutated: false,
    githubRunUrl: params.githubRunUrl ?? null,
    notes,
  };
}

export function renderWeeklyMarkdown(report: WeeklyCodeHealthReport): string {
  const d = report.delta;
  const lines = [
    "# Weekly Code Health",
    "",
    `- ranAt: \`${report.ranAt}\``,
    `- main: \`${report.mainSha}\``,
    `- status: **${report.status}**`,
    `- productionMutated: \`${String(report.productionMutated)}\``,
    "",
    "## Counts",
    "",
    `| new | resolved | SAFE_TO_DELETE | REQUIRED_CLEANUP | FOLLOW_UP | KEEP | UNCONFIRMED |`,
    `|---|---|---|---|---|---|---|`,
    `| ${report.counts.newFindings} | ${report.counts.resolved} | ${report.counts.safeToDelete} | ${report.counts.requiredCleanup} | ${report.counts.followUp} | ${report.counts.keep} | ${report.counts.unconfirmed} |`,
    "",
    "## Trend (delta vs previous run)",
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
    "## Critical / security BUGFIX candidates (not patched by this job)",
    "",
    ...(report.criticalBugfixCandidates.length > 0
      ? report.criticalBugfixCandidates.map((c) => `- ${c.path}: ${c.summary}`)
      : ["- (none)"]),
    "",
    "## Candidates",
    "",
    "| classification | kind | path | symbol |",
    "|---|---|---|---|",
    ...report.candidates
      .slice(0, 200)
      .map((c) => `| ${c.classification} | ${c.kind} | ${c.path} | ${c.symbol ?? ""} |`),
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ];
  return lines.join("\n");
}

export function weeklyReportKey(report: WeeklyCodeHealthReport): string {
  return `${report.ranAt.slice(0, 10)}:${report.mainSha.slice(0, 12)}`;
}

export function assertWeeklyDoesNotMutate(report: WeeklyCodeHealthReport): void {
  if (report.productionMutated !== false) {
    throw new Error("weekly report claimed a production mutation");
  }
}

export type { CodeHealthCandidate };
