import {
  AUTOMATION_REPORTS_GITHUB_REPO,
  type GithubScheduledAutomationGroup,
} from "@/lib/adminAutomationReports";
import {
  DECISION_RADAR_LEDGER_BRANCH,
  DECISION_RADAR_WORKFLOW_PATH,
  type DecisionRadarRun,
} from "@/lib/decisionModelRadar";
import { githubReportGetContent } from "@/lib/githubReportClient";

export type DecisionRadarAdminProjection = {
  status: "OK" | "EMPTY" | "UNAVAILABLE";
  error: string | null;
  run: DecisionRadarRun | null;
  githubRunUrl: string | null;
};

export async function fetchDecisionRadarLatestRaw(
  fetchImpl: typeof fetch = fetch,
  repo = AUTOMATION_REPORTS_GITHUB_REPO
): Promise<{
  status: "OK" | "EMPTY" | "UNAVAILABLE";
  error: string | null;
  raw: string | null;
}> {
  return githubReportGetContent(
    `https://api.github.com/repos/${repo}/contents/latest.json?ref=${DECISION_RADAR_LEDGER_BRANCH}`,
    fetchImpl
  );
}

function parseRun(raw: string | null): DecisionRadarRun | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DecisionRadarRun;
    return parsed && typeof parsed === "object" && typeof parsed.ranAt === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function fetchDecisionRadarAdminProjection(
  githubGroups: readonly GithubScheduledAutomationGroup[],
  fetchImpl: typeof fetch = fetch
): Promise<DecisionRadarAdminProjection> {
  const group =
    githubGroups.find((item) => item.path === DECISION_RADAR_WORKFLOW_PATH) ??
    null;
  const fetched = await fetchDecisionRadarLatestRaw(fetchImpl);
  return {
    status: fetched.status,
    error: fetched.error,
    run: parseRun(fetched.raw),
    githubRunUrl: group?.latest.htmlUrl ?? null,
  };
}
