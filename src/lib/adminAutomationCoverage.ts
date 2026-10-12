import type {
  GithubAutomationProjection,
  GithubScheduledAutomationGroup,
} from "@/lib/adminAutomationReports";
import {
  buildScheduledAutomationHealthReport,
  type ScheduledAutomationHealthState,
  type ScheduledWorkflowDefinition,
} from "@/lib/codeHealth/automationHealth";

/**
 * Registered-vs-displayed projection for the admin GitHub schedule list.
 * Registry = workflows with a cron on current main. Displayed = scheduled runs
 * GitHub returned. State math stays in `automationHealth`; this only joins and
 * labels it. Read-only: never reruns, enables, or disables a workflow.
 */
export type AutomationCoverageState =
  | "OK"
  | "FAILED"
  | "STALE"
  | "NOT_RUN"
  | "UNAVAILABLE";

export type AutomationCoverageRow = {
  name: string;
  path: string;
  crons: string[];
  state: AutomationCoverageState;
  needsAction: boolean;
  reason: string | null;
  staleAfterHours: number;
  consecutiveFailures: number;
  group: GithubScheduledAutomationGroup | null;
};

export type AutomationCoverageUnregistered = {
  group: GithubScheduledAutomationGroup;
  needsAction: boolean;
};

export type AutomationCoverageView = {
  status: "OK" | "UNAVAILABLE";
  error: string | null;
  rows: AutomationCoverageRow[];
  unregistered: AutomationCoverageUnregistered[];
  attentionCount: number;
};

const STATE_FROM_HEALTH: Record<ScheduledAutomationHealthState, AutomationCoverageState> = {
  HEALTHY: "OK",
  WARNING: "FAILED",
  FAILING: "FAILED",
  STALE: "STALE",
  MISSING: "NOT_RUN",
};

const STATE_RANK: Record<AutomationCoverageState, number> = {
  FAILED: 0,
  STALE: 1,
  NOT_RUN: 2,
  UNAVAILABLE: 3,
  OK: 4,
};

function latestMs(group: GithubScheduledAutomationGroup | null): number {
  const parsed = group ? Date.parse(group.latest.createdAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestRunFailed(group: GithubScheduledAutomationGroup): boolean {
  if (group.latest.status !== "completed") return false;
  const conclusion = (group.latest.conclusion ?? "").toLowerCase();
  return conclusion !== "" && conclusion !== "success" && conclusion !== "skipped";
}

export function buildAutomationCoverage(params: {
  definitions: readonly ScheduledWorkflowDefinition[];
  github: GithubAutomationProjection;
  now?: Date;
}): AutomationCoverageView {
  if (params.github.status !== "OK") {
    return {
      status: "UNAVAILABLE",
      error: params.github.error ?? "GitHub scheduled-run projection unavailable",
      rows: [],
      unregistered: [],
      attentionCount: 0,
    };
  }
  if (params.definitions.length === 0) {
    return {
      status: "UNAVAILABLE",
      error: "등록된 schedule workflow 목록(.github/workflows)을 읽지 못했습니다.",
      rows: [],
      unregistered: [],
      attentionCount: 0,
    };
  }

  const groupsByPath = new Map(params.github.groups.map((group) => [group.path, group]));
  const health = buildScheduledAutomationHealthReport({
    definitions: params.definitions,
    groups: params.github.groups,
    now: params.now,
  });

  const rows: AutomationCoverageRow[] = health.rows.map((row) => {
    const state = STATE_FROM_HEALTH[row.state];
    return {
      name: row.name,
      path: row.path,
      crons: row.crons,
      state,
      needsAction: state !== "OK",
      reason: row.reasons.join(" / ") || null,
      staleAfterHours: row.staleAfterHours,
      consecutiveFailures: row.consecutiveFailures,
      group: groupsByPath.get(row.path) ?? null,
    };
  });
  rows.sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      latestMs(b.group) - latestMs(a.group) ||
      a.path.localeCompare(b.path)
  );

  const registeredPaths = new Set(params.definitions.map((definition) => definition.path));
  const unregistered = params.github.groups
    .filter((group) => !registeredPaths.has(group.path))
    .map((group) => ({ group, needsAction: latestRunFailed(group) }));

  return {
    status: "OK",
    error: null,
    rows,
    unregistered,
    attentionCount:
      rows.filter((row) => row.needsAction).length +
      unregistered.filter((row) => row.needsAction).length,
  };
}
