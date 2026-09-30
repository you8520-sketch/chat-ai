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
  fetchImpl: typeof fetch = fetch
): Promise<GithubAutomationProjection> {
  try {
    const rawRuns: Array<Record<string, unknown>> = [];
    for (let page = 1; page <= 5; page += 1) {
      const response = await fetchImpl(
        `https://api.github.com/repos/${AUTOMATION_REPORTS_GITHUB_REPO}/actions/runs?event=schedule&per_page=100&page=${page}`,
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
