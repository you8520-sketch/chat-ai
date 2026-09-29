import {
  AUTOMATION_REPORTS_GITHUB_REPO,
  type GithubScheduledAutomationGroup,
} from "@/lib/adminAutomationReports";
import {
  DECISION_RADAR_LEDGER_BRANCH,
  DECISION_RADAR_WORKFLOW_PATH,
  type DecisionRadarRun,
} from "@/lib/decisionModelRadar";

export type DecisionRadarAdminProjection = {
  status: "OK" | "EMPTY" | "UNAVAILABLE";
  error: string | null;
  run: DecisionRadarRun | null;
  githubRunUrl: string | null;
};

function decodeGithubContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const content =
    "content" in body && typeof body.content === "string" ? body.content : "";
  if (!content) return null;
  try {
    return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

export async function fetchDecisionRadarLatestRaw(
  fetchImpl: typeof fetch = fetch,
  repo = AUTOMATION_REPORTS_GITHUB_REPO
): Promise<{
  status: "OK" | "EMPTY" | "UNAVAILABLE";
  error: string | null;
  raw: string | null;
}> {
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repo}/contents/latest.json?ref=${DECISION_RADAR_LEDGER_BRANCH}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "chat-ai-admin-automation-reports",
        },
        cache: "no-store",
      }
    );
    if (response.status === 404) {
      return { status: "EMPTY", error: null, raw: null };
    }
    if (!response.ok) {
      return {
        status: "UNAVAILABLE",
        error: `GitHub Contents API ${response.status}`,
        raw: null,
      };
    }
    const raw = decodeGithubContent(await response.json());
    return raw
      ? { status: "OK", error: null, raw }
      : { status: "EMPTY", error: null, raw: null };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      error:
        error instanceof Error
          ? error.message
          : "Decision radar ledger unavailable",
      raw: null,
    };
  }
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
