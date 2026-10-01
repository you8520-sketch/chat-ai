import {
  isProductionEnvironmentName,
  normalizeDeploymentSha,
  parsePostDeployEvidence,
  parsePublicSmokeEvidence,
  POST_DEPLOY_WORKFLOW_PATH,
  projectPostDeployVerification,
  type DeploymentSuccessRef,
  type ParsedPostDeployRun,
  type PostDeployEvidence,
  type PostDeployVerificationView,
  type PublicSmokeEvidence,
} from "@/lib/postDeployVerification";

export const AUTOMATION_REPORTS_GITHUB_REPO = "you8520-sketch/chat-ai";

export type GithubScheduledAutomationRun = {
  id: number;
  name: string;
  path: string;
  status: string;
  conclusion: string | null;
  runNumber: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
};

export type GithubScheduledAutomationGroup = {
  key: string;
  name: string;
  path: string;
  latest: GithubScheduledAutomationRun;
  history: GithubScheduledAutomationRun[];
};

export type GithubAutomationProjection = {
  status: "OK" | "UNAVAILABLE";
  error: string | null;
  groups: GithubScheduledAutomationGroup[];
};

export type GithubSupplyAutoDraft = {
  number: number;
  title: string;
  htmlUrl: string;
  state: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  modelId: string;
  candidateProviderSlug: string;
};

export type GithubSupplyAutoDraftProjection = {
  status: "OK" | "UNAVAILABLE";
  error: string | null;
  drafts: GithubSupplyAutoDraft[];
};

const SUPPLY_AUTO_DRAFT_MARKER =
  /<!--\s*main-rp-supply-auto:([^:>]+):([^>\s]+)\s*-->/;

export function projectGithubSupplyAutoDrafts(
  rawPulls: readonly Record<string, unknown>[]
): GithubSupplyAutoDraft[] {
  const drafts: GithubSupplyAutoDraft[] = [];
  for (const raw of rawPulls) {
    const body = asString(raw.body);
    const marker = SUPPLY_AUTO_DRAFT_MARKER.exec(body);
    if (!marker) continue;
    drafts.push({
      number: asNumber(raw.number),
      title: asString(raw.title) || "Automated Main RP supplier promotion",
      htmlUrl: asString(raw.html_url),
      state: asString(raw.state) || "open",
      draft: raw.draft === true,
      createdAt: asString(raw.created_at),
      updatedAt: asString(raw.updated_at),
      modelId: marker[1]!.trim(),
      candidateProviderSlug: marker[2]!.trim(),
    });
  }
  return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function fetchGithubSupplyAutoDraftProjection(
  fetchImpl: typeof fetch = fetch
): Promise<GithubSupplyAutoDraftProjection> {
  try {
    const rawPulls: Array<Record<string, unknown>> = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await fetchImpl(
        `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/pulls?state=open&per_page=100&page=${page}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "chat-ai-admin-automation-reports",
          },
          cache: "no-store",
        }
      );
      if (!response.ok) {
        return {
          status: "UNAVAILABLE",
          error: `GitHub Pull Requests API ${response.status}`,
          drafts: [],
        };
      }
      const pagePulls = (await response.json()) as Array<Record<string, unknown>>;
      rawPulls.push(...pagePulls);
      if (pagePulls.length < 100) break;
    }
    return {
      status: "OK",
      error: null,
      drafts: projectGithubSupplyAutoDrafts(rawPulls),
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      error: error instanceof Error ? error.message : "GitHub Pull Requests API unavailable",
      drafts: [],
    };
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function groupGithubScheduledAutomationRuns(
  rawRuns: readonly Record<string, unknown>[]
): GithubScheduledAutomationGroup[] {
  const groups = new Map<string, GithubScheduledAutomationRun[]>();
  for (const raw of rawRuns) {
    const name = asString(raw.name) || "(unnamed workflow)";
    const path = asString(raw.path) || "(unknown path)";
    const run: GithubScheduledAutomationRun = {
      id: asNumber(raw.id),
      name,
      path,
      status: asString(raw.status) || "unknown",
      conclusion: asNullableString(raw.conclusion),
      runNumber: asNumber(raw.run_number),
      createdAt: asString(raw.created_at),
      updatedAt: asString(raw.updated_at),
      htmlUrl: asString(raw.html_url),
    };
    const key = `${name}::${path}`;
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([key, runs]) => {
      const history = [...runs]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12);
      return {
        key,
        name: history[0]!.name,
        path: history[0]!.path,
        latest: history[0]!,
        history,
      };
    })
    .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

export async function fetchGithubScheduledAutomationProjection(
  fetchImpl: typeof fetch = fetch,
  opts?: { token?: string; maxPages?: number }
): Promise<GithubAutomationProjection> {
  try {
    const rawRuns: Array<Record<string, unknown>> = [];
    const maxPages = Math.max(1, Math.min(10, opts?.maxPages ?? 5));
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await fetchImpl(
        `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/actions/runs?event=schedule&per_page=100&page=${page}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "chat-ai-admin-automation-reports",
            ...(opts?.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          },
          cache: "no-store",
        }
      );
      if (!response.ok) {
        return {
          status: "UNAVAILABLE",
          error: `GitHub Actions API ${response.status}`,
          groups: [],
        };
      }
      const body = (await response.json()) as {
        workflow_runs?: Array<Record<string, unknown>>;
      };
      const pageRuns = body.workflow_runs ?? [];
      rawRuns.push(...pageRuns);
      if (pageRuns.length < 100) break;
    }
    return {
      status: "OK",
      error: null,
      groups: groupGithubScheduledAutomationRuns(rawRuns),
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      error: error instanceof Error ? error.message : "GitHub Actions API unavailable",
      groups: [],
    };
  }
}

function annotationMessages(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body
    .map((row) => (row && typeof row === "object" ? (row as { message?: unknown }).message : null))
    .filter((message): message is string => typeof message === "string");
}

export async function fetchPostDeployVerificationProjection(
  fetchImpl: typeof fetch = fetch
): Promise<PostDeployVerificationView> {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "chat-ai-admin-automation-reports",
  };
  try {
    const runsResponse = await fetchImpl(
      `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/actions/runs?event=deployment_status&per_page=20`,
      { headers, cache: "no-store" }
    );
    if (!runsResponse.ok) {
      return projectPostDeployVerification({
        runs: [],
        latestSuccess: null,
        readError: `GitHub Actions API ${runsResponse.status}`,
      });
    }
    const runsBody = (await runsResponse.json()) as {
      workflow_runs?: Array<Record<string, unknown>>;
    };
    const runs = (runsBody.workflow_runs ?? [])
      .filter((run) => asString(run.path).endsWith(POST_DEPLOY_WORKFLOW_PATH))
      .filter((run) => asString(run.status) === "completed")
      .slice(0, 5);
    const parsed: ParsedPostDeployRun[] = [];
    for (const run of runs) {
      const jobsResponse = await fetchImpl(asString(run.jobs_url), { headers, cache: "no-store" });
      if (!jobsResponse.ok) {
        return projectPostDeployVerification({
          runs: [],
          latestSuccess: null,
          readError: `GitHub Actions jobs API ${jobsResponse.status}`,
        });
      }
      const jobsBody = (await jobsResponse.json()) as { jobs?: Array<Record<string, unknown>> };
      const checkUrl = asString(jobsBody.jobs?.[0]?.check_run_url);
      let evidence: PostDeployEvidence | null = null;
      let publicSmoke: PublicSmokeEvidence | null = null;
      if (checkUrl) {
        const notesResponse = await fetchImpl(`${checkUrl}/annotations`, {
          headers,
          cache: "no-store",
        });
        if (!notesResponse.ok) {
          return projectPostDeployVerification({
            runs: [],
            latestSuccess: null,
            readError: `GitHub check annotations API ${notesResponse.status}`,
          });
        }
        for (const message of annotationMessages(await notesResponse.json())) {
          const parsedEvidence = parsePostDeployEvidence(message);
          const parsedSmoke = parsePublicSmokeEvidence(message);
          if (parsedEvidence && (!evidence || (parsedSmoke && !publicSmoke))) {
            evidence = parsedEvidence;
            publicSmoke = parsedSmoke;
          }
        }
      }
      parsed.push({
        runId: asNumber(run.id),
        htmlUrl: asString(run.html_url),
        createdAt: asString(run.created_at),
        evidence,
        publicSmoke,
      });
    }

    const deploymentsResponse = await fetchImpl(
      `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/deployments?per_page=5`,
      { headers, cache: "no-store" }
    );
    if (!deploymentsResponse.ok) {
      return projectPostDeployVerification({
        runs: parsed,
        latestSuccess: null,
        readError: `GitHub Deployments API ${deploymentsResponse.status}`,
      });
    }
    const deployments = (await deploymentsResponse.json()) as Array<Record<string, unknown>>;
    const productionDeploys = deployments
      .filter(
        (deployment) =>
          isProductionEnvironmentName(asString(deployment.environment)) &&
          asString(deployment.task).toLowerCase() === "deploy"
      )
      .slice(0, 3);
    let latestSuccess: DeploymentSuccessRef | null = null;
    for (const deployment of productionDeploys) {
      const statusesUrl = asString(deployment.statuses_url);
      if (!statusesUrl) continue;
      const statusesResponse = await fetchImpl(statusesUrl, { headers, cache: "no-store" });
      if (!statusesResponse.ok) {
        return projectPostDeployVerification({
          runs: parsed,
          latestSuccess: null,
          readError: `GitHub deployment statuses API ${statusesResponse.status}`,
        });
      }
      const statuses = (await statusesResponse.json()) as Array<Record<string, unknown>>;
      if (statuses.some((status) => asString(status.state) === "success")) {
        const sha = normalizeDeploymentSha(deployment.sha);
        if (sha) {
          latestSuccess = { sha, createdAt: asString(deployment.created_at) };
          break;
        }
      }
    }
    return projectPostDeployVerification({ runs: parsed, latestSuccess });
  } catch (error) {
    return projectPostDeployVerification({
      runs: [],
      latestSuccess: null,
      readError:
        error instanceof Error ? error.message : "GitHub deployment verification API unavailable",
    });
  }
}
