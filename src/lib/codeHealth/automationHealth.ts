import fs from "node:fs";
import path from "node:path";

import type { GithubScheduledAutomationGroup } from "@/lib/adminAutomationReports";

export type ScheduledAutomationHealthState =
  | "HEALTHY"
  | "WARNING"
  | "FAILING"
  | "STALE"
  | "MISSING";

export type ScheduledWorkflowDefinition = {
  name: string;
  path: string;
  crons: string[];
};

export type ScheduledAutomationHealthRow = {
  name: string;
  path: string;
  crons: string[];
  state: ScheduledAutomationHealthState;
  latestTriggeredAt: string | null;
  latestCompletedConclusion: string | null;
  consecutiveFailures: number;
  observedGapHours: number | null;
  staleAfterHours: number;
  reasons: string[];
};

export type ScheduledAutomationHealthReport = {
  generatedAt: string;
  inventoryCount: number;
  healthyCount: number;
  warningCount: number;
  failingCount: number;
  staleCount: number;
  missingCount: number;
  rows: ScheduledAutomationHealthRow[];
  notes: string[];
};

function workflowName(text: string, fallback: string): string {
  const line = text
    .split(/\r?\n/)
    .find((row) => /^name:\s*/.test(row.trim()));
  if (!line) return fallback;
  return line.trim().replace(/^name:\s*/, "").replace(/^["']|["']$/g, "").trim() || fallback;
}

function cronValues(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-?\s*cron:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
    if (!match) continue;
    const cron = match[1]!.trim();
    if (cron && !out.includes(cron)) out.push(cron);
  }
  return out;
}

export function scanScheduledWorkflowDefinitions(
  repoRoot: string
): ScheduledWorkflowDefinition[] {
  const dir = path.join(repoRoot, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];

  const rows: ScheduledWorkflowDefinition[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const abs = path.join(dir, name);
    let text = "";
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const crons = cronValues(text);
    if (crons.length === 0) continue;
    const rel = path.posix.join(".github", "workflows", name);
    rows.push({
      name: workflowName(text, name),
      path: rel,
      crons,
    });
  }
  return rows;
}

function completedRuns(group: GithubScheduledAutomationGroup): GithubScheduledAutomationGroup["history"] {
  return group.history.filter((run) => run.status === "completed");
}

function consecutiveFailures(group: GithubScheduledAutomationGroup): number {
  let count = 0;
  for (const run of completedRuns(group)) {
    const conclusion = (run.conclusion ?? "").toLowerCase();
    if (conclusion === "success" || conclusion === "skipped") break;
    count += 1;
  }
  return count;
}

function observedGapStats(
  group: GithubScheduledAutomationGroup
): { latestGapHours: number | null; medianGapHours: number | null } {
  const times = group.history
    .map((run) => Date.parse(run.createdAt))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
  if (times.length < 2) return { latestGapHours: null, medianGapHours: null };

  const gaps: number[] = [];
  for (let i = 0; i < times.length - 1; i += 1) {
    const gap = (times[i]! - times[i + 1]!) / 3_600_000;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return { latestGapHours: null, medianGapHours: null };
  const sorted = [...gaps].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!;
  return {
    latestGapHours: gaps[0] ?? null,
    medianGapHours: median,
  };
}

function cronFallbackHours(crons: readonly string[]): number {
  if (crons.length === 0) return 24 * 40;

  const perCron = crons.map((cron) => {
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) return 24 * 40;
    const [, , dayOfMonth, month, dayOfWeek] = fields;
    if (month !== "*") return 24 * 40;
    if (dayOfMonth === "*" && dayOfWeek === "*") return 72;
    if (dayOfMonth === "*" && dayOfWeek !== "*") return 24 * 10;
    if (dayOfMonth !== "*" && dayOfWeek === "*") return 24 * 40;
    return 24 * 40;
  });

  // Multiple monthly slots (for example day 1 + day 15) should not wait
  // a full 40 days before being considered stale.
  if (crons.length > 1 && perCron.every((hours) => hours >= 24 * 40)) {
    return 24 * 25;
  }
  return Math.min(...perCron);
}

function staleThresholdHours(
  definition: ScheduledWorkflowDefinition,
  group: GithubScheduledAutomationGroup | null
): { observedGapHours: number | null; staleAfterHours: number } {
  const fallback = cronFallbackHours(definition.crons);
  const stats = group
    ? observedGapStats(group)
    : { latestGapHours: null, medianGapHours: null };
  if (stats.medianGapHours != null) {
    return {
      observedGapHours: stats.latestGapHours,
      staleAfterHours: Math.min(
        fallback,
        Math.max(48, Math.ceil(stats.medianGapHours * 1.5))
      ),
    };
  }
  return {
    observedGapHours: stats.latestGapHours,
    staleAfterHours: fallback,
  };
}

function latestCompletedConclusion(
  group: GithubScheduledAutomationGroup
): string | null {
  return completedRuns(group)[0]?.conclusion ?? null;
}

export function buildScheduledAutomationHealthReport(params: {
  definitions: readonly ScheduledWorkflowDefinition[];
  groups: readonly GithubScheduledAutomationGroup[];
  now?: Date;
  projectionAvailable?: boolean;
}): ScheduledAutomationHealthReport {
  const now = params.now ?? new Date();
  const byPath = new Map(params.groups.map((group) => [group.path, group]));
  const projectionAvailable = params.projectionAvailable !== false;

  const rows: ScheduledAutomationHealthRow[] = params.definitions.map((definition) => {
    const group = byPath.get(definition.path) ?? null;
    const threshold = staleThresholdHours(definition, group);
    if (!projectionAvailable) {
      return {
        name: definition.name,
        path: definition.path,
        crons: definition.crons,
        state: "WARNING",
        latestTriggeredAt: null,
        latestCompletedConclusion: null,
        consecutiveFailures: 0,
        observedGapHours: threshold.observedGapHours,
        staleAfterHours: threshold.staleAfterHours,
        reasons: ["GitHub scheduled-run projection unavailable; health cannot be proven."],
      };
    }
    if (!group) {
      return {
        name: definition.name,
        path: definition.path,
        crons: definition.crons,
        state: "MISSING",
        latestTriggeredAt: null,
        latestCompletedConclusion: null,
        consecutiveFailures: 0,
        observedGapHours: threshold.observedGapHours,
        staleAfterHours: threshold.staleAfterHours,
        reasons: ["Workflow has a schedule in current main but no scheduled run is visible in fetched history."],
      };
    }

    const latestTriggeredAt = group.latest.createdAt || null;
    const latestMs = latestTriggeredAt ? Date.parse(latestTriggeredAt) : Number.NaN;
    const ageHours = Number.isFinite(latestMs)
      ? Math.max(0, (now.getTime() - latestMs) / 3_600_000)
      : Number.POSITIVE_INFINITY;
    const failures = consecutiveFailures(group);
    const completedConclusion = latestCompletedConclusion(group);
    const reasons: string[] = [];

    if (failures >= 2) {
      reasons.push(`${failures} consecutive completed scheduled runs failed/non-success.`);
    } else if (failures === 1) {
      reasons.push("Latest completed scheduled run is non-success.");
    }
    const gapMissed =
      threshold.observedGapHours != null &&
      threshold.observedGapHours > threshold.staleAfterHours;
    if (ageHours > threshold.staleAfterHours) {
      reasons.push(
        `No scheduled trigger for ${Math.floor(ageHours)}h; stale threshold is ${threshold.staleAfterHours}h.`
      );
    }
    if (gapMissed) {
      reasons.push(
        `Observed scheduled-run gap ${Math.floor(threshold.observedGapHours!)}h exceeded the ${threshold.staleAfterHours}h cadence threshold.`
      );
    }

    let state: ScheduledAutomationHealthState = "HEALTHY";
    if (failures >= 2) state = "FAILING";
    else if (ageHours > threshold.staleAfterHours || gapMissed) state = "STALE";
    else if (failures === 1) state = "WARNING";

    return {
      name: definition.name,
      path: definition.path,
      crons: definition.crons,
      state,
      latestTriggeredAt,
      latestCompletedConclusion: completedConclusion,
      consecutiveFailures: failures,
      observedGapHours: threshold.observedGapHours,
      staleAfterHours: threshold.staleAfterHours,
      reasons,
    };
  });

  const count = (state: ScheduledAutomationHealthState) =>
    rows.filter((row) => row.state === state).length;

  return {
    generatedAt: now.toISOString(),
    inventoryCount: rows.length,
    healthyCount: count("HEALTHY"),
    warningCount: count("WARNING"),
    failingCount: count("FAILING"),
    staleCount: count("STALE"),
    missingCount: count("MISSING"),
    rows,
    notes: [
      "Automation Health is read-only evidence inside Weekly Code Health; it does not rerun, patch, disable, or merge workflows.",
      "Staleness checks the latest scheduled-run gap against an observed-median/conservative cadence threshold, so an old recovered miss does not create a permanent alert.",
    ],
  };
}

export function automationHealthHasProblem(
  report: ScheduledAutomationHealthReport
): boolean {
  return (
    report.warningCount +
      report.failingCount +
      report.staleCount +
      report.missingCount >
    0
  );
}

export function renderScheduledAutomationHealthMarkdown(
  report: ScheduledAutomationHealthReport
): string {
  const lines = [
    "## Scheduled Automation Health",
    "",
    `- inventory: ${report.inventoryCount}`,
    `- healthy: ${report.healthyCount}`,
    `- warning: ${report.warningCount}`,
    `- failing: ${report.failingCount}`,
    `- stale: ${report.staleCount}`,
    `- missing: ${report.missingCount}`,
    "",
    "| state | workflow | latest scheduled trigger | failure streak | stale after | reason |",
    "|---|---|---|---:|---:|---|",
    ...report.rows.map((row) =>
      `| ${row.state} | ${row.name} | ${row.latestTriggeredAt ?? "-"} | ${row.consecutiveFailures} | ${row.staleAfterHours}h | ${row.reasons.join(" / ").replace(/\|/g, "/") || "-"} |`
    ),
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ];
  return lines.join("\n");
}
