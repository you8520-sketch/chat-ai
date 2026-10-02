import {
  githubReportGetJson,
  type GithubReportGetOpts,
} from "@/lib/githubReportClient";
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
import {
  DOMAIN_SSL_WORKFLOW_PATH,
  parseDomainSslEvidence,
  projectDomainSslMonitor,
  type DomainSslEvidence,
  type DomainSslMonitorView,
  type ParsedDomainSslRun,
} from "@/lib/domainSslMonitor";

export const AUTOMATION_REPORTS_GITHUB_REPO = "you8520-sketch/chat-ai";
export const GITHUB_SCHEDULED_RUNS_DEFAULT_MAX_PAGES = 1;
export const GITHUB_SUPPLY_DRAFT_DEFAULT_MAX_PAGES = 1;
export const POST_DEPLOY_ANNOTATION_RUN_LIMIT = 2;
export const DOMAIN_SSL_ANNOTATION_RUN_LIMIT = 1;

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
  const rawPulls: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= GITHUB_SUPPLY_DRAFT_DEFAULT_MAX_PAGES; page += 1) {
    const result = await githubReportGetJson<Array<Record<string, unknown>>>(
      `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/pulls?state=open&per_page=100&page=${page}`,
      fetchImpl,
      { label: "GitHub Pull Requests API" }
    );
    if (!result.ok) {
      return {
        status: "UNAVAILABLE",
        error: result.error,
        drafts: [],
      };
    }
    const pagePulls = Array.isArray(result.json) ? result.json : [];
    rawPulls.push(...pagePulls);
    if (pagePulls.length < 100) break;
  }
  return {
    status: "OK",
    error: null,
    drafts: projectGithubSupplyAutoDrafts(rawPulls),
  };
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
  const rawRuns: Array<Record<string, unknown>> = [];
  const maxPages = Math.max(
    1,
    Math.min(10, opts?.maxPages ?? GITHUB_SCHEDULED_RUNS_DEFAULT_MAX_PAGES)
  );
  const requestOpts: GithubReportGetOpts = {
    label: "GitHub Actions API",
    token: opts?.token,
  };
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await githubReportGetJson<{
      workflow_runs?: Array<Record<string, unknown>>;
    }>(
      `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/actions/runs?event=schedule&per_page=100&page=${page}`,
      fetchImpl,
      requestOpts
    );
    if (!result.ok) {
      return {
        status: "UNAVAILABLE",
        error: result.error,
        groups: [],
      };
    }
    const pageRuns = result.json?.workflow_runs ?? [];
    rawRuns.push(...pageRuns);
    if (pageRuns.length < 100) break;
  }
  return {
    status: "OK",
    error: null,
    groups: groupGithubScheduledAutomationRuns(rawRuns),
  };
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
  const runsResult = await githubReportGetJson<{
    workflow_runs?: Array<Record<string, unknown>>;
  }>(
    `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/actions/runs?event=deployment_status&per_page=20`,
    fetchImpl,
    { label: "GitHub Actions API" }
  );
  if (!runsResult.ok) {
    return projectPostDeployVerification({
      runs: [],
      latestSuccess: null,
      readError: runsResult.error,
    });
  }
  const runs = (runsResult.json?.workflow_runs ?? [])
    .filter((run) => asString(run.path).endsWith(POST_DEPLOY_WORKFLOW_PATH))
    .filter((run) => asString(run.status) === "completed")
    .slice(0, POST_DEPLOY_ANNOTATION_RUN_LIMIT);
  const parsed: ParsedPostDeployRun[] = [];
  for (const run of runs) {
    const jobsResult = await githubReportGetJson<{ jobs?: Array<Record<string, unknown>> }>(
      asString(run.jobs_url),
      fetchImpl,
      { label: "GitHub Actions jobs API" }
    );
    if (!jobsResult.ok) {
      return projectPostDeployVerification({
        runs: [],
        latestSuccess: null,
        readError: jobsResult.error,
      });
    }
    const checkUrl = asString(jobsResult.json?.jobs?.[0]?.check_run_url);
    let evidence: PostDeployEvidence | null = null;
    let publicSmoke: PublicSmokeEvidence | null = null;
    if (checkUrl) {
      const notesResult = await githubReportGetJson<unknown>(
        `${checkUrl}/annotations`,
        fetchImpl,
        { label: "GitHub check annotations API" }
      );
      if (!notesResult.ok) {
        return projectPostDeployVerification({
          runs: [],
          latestSuccess: null,
          readError: notesResult.error,
        });
      }
      for (const message of annotationMessages(notesResult.json)) {
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

  const deploymentsResult = await githubReportGetJson<Array<Record<string, unknown>>>(
    `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/deployments?per_page=5`,
    fetchImpl,
    { label: "GitHub Deployments API" }
  );
  if (!deploymentsResult.ok) {
    return projectPostDeployVerification({
      runs: parsed,
      latestSuccess: null,
      readError: deploymentsResult.error,
    });
  }
  const deployments = Array.isArray(deploymentsResult.json) ? deploymentsResult.json : [];
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
    const statusesResult = await githubReportGetJson<Array<Record<string, unknown>>>(
      statusesUrl,
      fetchImpl,
      { label: "GitHub deployment statuses API" }
    );
    if (!statusesResult.ok) {
      return projectPostDeployVerification({
        runs: parsed,
        latestSuccess: null,
        readError: statusesResult.error,
      });
    }
    const statuses = Array.isArray(statusesResult.json) ? statusesResult.json : [];
    if (statuses.some((status) => asString(status.state) === "success")) {
      const sha = normalizeDeploymentSha(deployment.sha);
      if (sha) {
        latestSuccess = { sha, createdAt: asString(deployment.created_at) };
        break;
      }
    }
  }
  return projectPostDeployVerification({ runs: parsed, latestSuccess });
}

export async function fetchDomainSslMonitorProjection(
  fetchImpl: typeof fetch = fetch
): Promise<DomainSslMonitorView> {
  const runsResult = await githubReportGetJson<{
    workflow_runs?: Array<Record<string, unknown>>;
  }>(
    `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/actions/workflows/domain-ssl-monitor.yml/runs?per_page=10`,
    fetchImpl,
    { label: "GitHub Actions API" }
  );
  if (!runsResult.ok) {
    if (runsResult.kind === "NOT_FOUND") {
      return projectDomainSslMonitor({ runs: [] });
    }
    return projectDomainSslMonitor({
      runs: [],
      readError: runsResult.error,
    });
  }
  const runs = (runsResult.json?.workflow_runs ?? [])
    .filter((run) => asString(run.path).endsWith(DOMAIN_SSL_WORKFLOW_PATH) || !asString(run.path))
    .filter((run) => asString(run.status) === "completed")
    .slice(0, DOMAIN_SSL_ANNOTATION_RUN_LIMIT);
  const parsed: ParsedDomainSslRun[] = [];
  for (const run of runs) {
    const jobsResult = await githubReportGetJson<{ jobs?: Array<Record<string, unknown>> }>(
      asString(run.jobs_url),
      fetchImpl,
      { label: "GitHub Actions jobs API" }
    );
    if (!jobsResult.ok) {
      return projectDomainSslMonitor({
        runs: [],
        readError: jobsResult.error,
      });
    }
    const checkUrl = asString(jobsResult.json?.jobs?.[0]?.check_run_url);
    let evidence: DomainSslEvidence | null = null;
    if (checkUrl) {
      const notesResult = await githubReportGetJson<unknown>(
        `${checkUrl}/annotations`,
        fetchImpl,
        { label: "GitHub check annotations API" }
      );
      if (!notesResult.ok) {
        return projectDomainSslMonitor({
          runs: [],
          readError: notesResult.error,
        });
      }
      for (const message of annotationMessages(notesResult.json)) {
        const parsedEvidence = parseDomainSslEvidence(message);
        if (parsedEvidence) evidence = parsedEvidence;
      }
    }
    parsed.push({
      runId: asNumber(run.id),
      htmlUrl: asString(run.html_url),
      createdAt: asString(run.created_at),
      conclusion: asNullableString(run.conclusion),
      evidence,
    });
  }
  return projectDomainSslMonitor({ runs: parsed });
}
