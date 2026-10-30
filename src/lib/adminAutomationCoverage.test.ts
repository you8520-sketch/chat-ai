import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  GithubAutomationProjection,
  GithubScheduledAutomationGroup,
  GithubScheduledAutomationRun,
} from "@/lib/adminAutomationReports";
import {
  buildAutomationCoverage,
  listRegisteredScheduleWorkflowPaths,
} from "@/lib/adminAutomationCoverage";
import type { ScheduledWorkflowDefinition } from "@/lib/codeHealth/automationHealth";

const WEEKLY: ScheduledWorkflowDefinition = {
  name: "Weekly Code Health audit",
  path: ".github/workflows/code-health-weekly-audit.yml",
  crons: ["17 4 * * 1"],
};
const RADAR: ScheduledWorkflowDefinition = {
  name: "Weekly Decision Model Radar",
  path: ".github/workflows/decision-model-radar-weekly.yml",
  crons: ["37 4 * * 3"],
};
const SSL: ScheduledWorkflowDefinition = {
  name: "Domain SSL monitor",
  path: ".github/workflows/domain-ssl-monitor.yml",
  crons: ["47 5,17 * * *"],
};
const DEFINITIONS = [WEEKLY, RADAR, SSL];

let nextId = 1;
function run(
  def: { name: string; path: string },
  createdAt: string,
  conclusion: string | null,
  status = "completed"
): GithubScheduledAutomationRun {
  const id = nextId++;
  return {
    id,
    name: def.name,
    path: def.path,
    status,
    conclusion,
    runNumber: id,
    createdAt,
    updatedAt: createdAt,
    htmlUrl: `https://github.test/actions/runs/${id}`,
  };
}

function group(
  def: { name: string; path: string },
  history: GithubScheduledAutomationRun[]
): GithubScheduledAutomationGroup {
  return {
    key: `${def.name}::${def.path}`,
    name: def.name,
    path: def.path,
    latest: history[0]!,
    history,
  };
}

function ok(groups: GithubScheduledAutomationGroup[]): GithubAutomationProjection {
  return { status: "OK", error: null, groups };
}

const NOW = new Date("2026-10-12T09:20:00Z");

describe("admin automation coverage (registered vs displayed)", () => {
  it("reports a healthy fleet with nothing to act on", () => {
    const view = buildAutomationCoverage({
      definitions: DEFINITIONS,
      github: ok([
        group(WEEKLY, [run(WEEKLY, "2026-10-05T11:27:12Z", "success")]),
        group(RADAR, [run(RADAR, "2026-10-07T11:16:58Z", "success")]),
        group(SSL, [
          run(SSL, "2026-10-12T04:04:00Z", "success"),
          run(SSL, "2026-10-11T21:04:09Z", "success"),
          run(SSL, "2026-10-11T11:36:48Z", "success"),
        ]),
      ]),
      now: NOW,
    });
    assert.equal(view.status, "OK");
    assert.deepEqual(view.rows.map((row) => row.state), ["OK", "OK", "OK"]);
    assert.equal(view.attentionCount, 0);
    assert.deepEqual(view.unregistered, []);
  });

  it("does not raise a missed-run alarm while a weekly slot is only hours late", () => {
    // Monday 04:17Z slot, checked 09:20Z: last run was the previous Monday.
    const view = buildAutomationCoverage({
      definitions: [WEEKLY],
      github: ok([group(WEEKLY, [run(WEEKLY, "2026-10-05T11:27:12Z", "success")])]),
      now: NOW,
    });
    assert.equal(view.rows[0]!.state, "OK");
    assert.equal(view.rows[0]!.needsAction, false);
    assert.equal(view.attentionCount, 0);
  });

  it("flags a registered workflow with no visible scheduled run as NOT_RUN", () => {
    const view = buildAutomationCoverage({
      definitions: DEFINITIONS,
      github: ok([
        group(RADAR, [run(RADAR, "2026-10-07T11:16:58Z", "success")]),
        group(SSL, [run(SSL, "2026-10-12T04:04:00Z", "success")]),
      ]),
      now: NOW,
    });
    const weekly = view.rows.find((row) => row.path === WEEKLY.path)!;
    assert.equal(weekly.state, "NOT_RUN");
    assert.equal(weekly.needsAction, true);
    assert.equal(weekly.group, null);
    assert.equal(view.attentionCount, 1);
    assert.equal(view.failedCount, 0);
    assert.equal(view.unverifiedCount, 1);
    assert.equal(view.rows[0]!.path, WEEKLY.path);
  });

  it("flags an old last result as STALE instead of showing it as current success", () => {
    const view = buildAutomationCoverage({
      definitions: [WEEKLY],
      github: ok([group(WEEKLY, [run(WEEKLY, "2026-09-20T11:27:12Z", "success")])]),
      now: NOW,
    });
    assert.equal(view.rows[0]!.state, "STALE");
    assert.equal(view.rows[0]!.needsAction, true);
    assert.equal(view.rows[0]!.staleAfterHours, 240);
    assert.equal(view.attentionCount, 1);
  });

  it("flags a failed latest scheduled run once, with its streak", () => {
    const view = buildAutomationCoverage({
      definitions: [RADAR],
      github: ok([
        group(RADAR, [
          run(RADAR, "2026-10-07T11:16:58Z", "failure"),
          run(RADAR, "2026-09-30T10:40:52Z", "failure"),
        ]),
      ]),
      now: NOW,
    });
    assert.equal(view.rows[0]!.state, "FAILED");
    assert.equal(view.rows[0]!.consecutiveFailures, 2);
    assert.equal(view.attentionCount, 1);
    assert.deepEqual(view.unregistered, []);
  });

  it("does not turn a GitHub lookup failure into healthy or per-workflow failures", () => {
    const view = buildAutomationCoverage({
      definitions: DEFINITIONS,
      github: { status: "UNAVAILABLE", error: "GitHub Actions API 403", groups: [] },
      now: NOW,
    });
    assert.equal(view.status, "UNAVAILABLE");
    assert.equal(view.error, "GitHub Actions API 403");
    assert.deepEqual(view.rows, []);
    assert.equal(view.attentionCount, 0);
  });

  it("treats an unreadable registry as unavailable, not as zero workflows", () => {
    const view = buildAutomationCoverage({
      definitions: [],
      github: ok([group(SSL, [run(SSL, "2026-10-12T04:04:00Z", "success")])]),
      now: NOW,
    });
    assert.equal(view.status, "UNAVAILABLE");
    assert.equal(view.attentionCount, 0);
  });

  it("lists runs from workflows no longer scheduled without double counting registered ones", () => {
    const retired = { name: "Retired audit", path: ".github/workflows/retired.yml" };
    const view = buildAutomationCoverage({
      definitions: [RADAR],
      github: ok([
        group(RADAR, [run(RADAR, "2026-10-07T11:16:58Z", "failure")]),
        group(retired, [run(retired, "2026-10-03T00:00:00Z", "failure")]),
      ]),
      now: NOW,
    });
    assert.equal(view.rows.length, 1);
    assert.equal(view.unregistered.length, 1);
    assert.equal(view.unregistered[0]!.group.path, retired.path);
    assert.equal(view.unregistered[0]!.latestRunFailed, true);
    assert.equal(view.failedCount, 1);
    assert.equal(view.attentionCount, 1);

    const healthyRetired = buildAutomationCoverage({
      definitions: [RADAR],
      github: ok([
        group(RADAR, [run(RADAR, "2026-10-07T11:16:58Z", "success")]),
        group(retired, [run(retired, "2026-10-03T00:00:00Z", "success")]),
      ]),
      now: NOW,
    });
    assert.equal(healthyRetired.unregistered[0]!.latestRunFailed, false);
    assert.equal(healthyRetired.attentionCount, 0);
  });

  it("lists only the registered schedule workflow paths", () => {
    const paths = listRegisteredScheduleWorkflowPaths(process.cwd());
    assert.ok(paths.has(".github/workflows/code-health-weekly-audit.yml"));
    assert.ok(!paths.has(".github/workflows/not-a-workflow.yml"));
  });

  it("orders rows that need action before healthy ones", () => {
    const view = buildAutomationCoverage({
      definitions: DEFINITIONS,
      github: ok([
        group(WEEKLY, [run(WEEKLY, "2026-10-05T11:27:12Z", "success")]),
        group(RADAR, [run(RADAR, "2026-10-07T11:16:58Z", "failure")]),
        group(SSL, [run(SSL, "2026-10-12T04:04:00Z", "success")]),
      ]),
      now: NOW,
    });
    assert.deepEqual(
      view.rows.map((row) => row.state),
      ["FAILED", "OK", "OK"]
    );
  });
});
