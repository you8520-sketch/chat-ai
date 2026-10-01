import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildScheduledAutomationHealthReport,
  renderScheduledAutomationHealthMarkdown,
  scanScheduledWorkflowDefinitions,
} from "@/lib/codeHealth/automationHealth";
import { runWeeklyCodeHealthAudit } from "@/lib/codeHealth/audit";
import type {
  GithubScheduledAutomationGroup,
  GithubScheduledAutomationRun,
} from "@/lib/adminAutomationReports";

function write(root: string, rel: string, text: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function run(
  id: number,
  pathValue: string,
  createdAt: string,
  conclusion: string | null,
  status = "completed"
): GithubScheduledAutomationRun {
  return {
    id,
    name: pathValue.includes("weekly") ? "Weekly Test" : "Daily Test",
    path: pathValue,
    status,
    conclusion,
    runNumber: id,
    createdAt,
    updatedAt: createdAt,
    htmlUrl: `https://github.test/actions/runs/${id}`,
  };
}

function group(
  pathValue: string,
  history: GithubScheduledAutomationRun[]
): GithubScheduledAutomationGroup {
  return {
    key: `fixture::${pathValue}`,
    name: history[0]?.name ?? "fixture",
    path: pathValue,
    latest: history[0]!,
    history,
  };
}

describe("scheduled automation workflow inventory", () => {
  it("reads only workflow files that actually define cron schedules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "automation-health-"));
    write(
      root,
      ".github/workflows/weekly.yml",
      'name: Weekly Test\non:\n  schedule:\n    - cron: "17 4 * * 1"\n  workflow_dispatch:\n'
    );
    write(
      root,
      ".github/workflows/manual.yml",
      "name: Manual Only\non:\n  workflow_dispatch:\n"
    );
    write(
      root,
      ".github/workflows/twice.yml",
      "name: Twice Monthly\non:\n  schedule:\n    - cron: '47 3 1 * *'\n    - cron: '47 3 15 * *'\n"
    );

    assert.deepEqual(scanScheduledWorkflowDefinitions(root), [
      {
        name: "Twice Monthly",
        path: ".github/workflows/twice.yml",
        crons: ["47 3 1 * *", "47 3 15 * *"],
      },
      {
        name: "Weekly Test",
        path: ".github/workflows/weekly.yml",
        crons: ["17 4 * * 1"],
      },
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("scheduled automation health", () => {
  const definitions = [
    {
      name: "Weekly Test",
      path: ".github/workflows/weekly.yml",
      crons: ["17 4 * * 1"],
    },
    {
      name: "Daily Test",
      path: ".github/workflows/daily.yml",
      crons: ["0 2 * * *"],
    },
    {
      name: "Missing Test",
      path: ".github/workflows/missing.yml",
      crons: ["0 3 * * 2"],
    },
  ];

  it("distinguishes repeated failure, one-off warning, and missing schedules", () => {
    const report = buildScheduledAutomationHealthReport({
      definitions,
      now: new Date("2026-09-30T12:00:00.000Z"),
      groups: [
        group(".github/workflows/weekly.yml", [
          run(5, ".github/workflows/weekly.yml", "2026-09-29T04:17:00.000Z", "failure"),
          run(4, ".github/workflows/weekly.yml", "2026-09-22T04:17:00.000Z", "failure"),
          run(3, ".github/workflows/weekly.yml", "2026-09-15T04:17:00.000Z", "success"),
        ]),
        group(".github/workflows/daily.yml", [
          run(10, ".github/workflows/daily.yml", "2026-09-30T02:00:00.000Z", "failure"),
          run(9, ".github/workflows/daily.yml", "2026-09-29T02:00:00.000Z", "success"),
        ]),
      ],
    });

    assert.equal(
      report.rows.find((row) => row.path.endsWith("weekly.yml"))?.state,
      "FAILING"
    );
    assert.equal(
      report.rows.find((row) => row.path.endsWith("weekly.yml"))?.consecutiveFailures,
      2
    );
    assert.equal(
      report.rows.find((row) => row.path.endsWith("daily.yml"))?.state,
      "WARNING"
    );
    assert.equal(
      report.rows.find((row) => row.path.endsWith("missing.yml"))?.state,
      "MISSING"
    );
    assert.equal(report.failingCount, 1);
    assert.equal(report.warningCount, 1);
    assert.equal(report.missingCount, 1);
  });

  it("marks an overdue schedule stale from observed cadence", () => {
    const report = buildScheduledAutomationHealthReport({
      definitions: [definitions[0]!],
      now: new Date("2026-09-30T12:00:00.000Z"),
      groups: [
        group(".github/workflows/weekly.yml", [
          run(3, ".github/workflows/weekly.yml", "2026-09-01T04:17:00.000Z", "success"),
          run(2, ".github/workflows/weekly.yml", "2026-08-25T04:17:00.000Z", "success"),
          run(1, ".github/workflows/weekly.yml", "2026-08-18T04:17:00.000Z", "success"),
        ]),
      ],
    });
    const row = report.rows[0]!;
    assert.equal(row.observedGapHours, 168);
    assert.equal(row.staleAfterHours, 240);
    assert.equal(row.state, "STALE");
    assert.match(row.reasons.join(" "), /No scheduled trigger/);
  });

  it("detects a skipped weekly slot even when the current run just triggered", () => {
    const report = buildScheduledAutomationHealthReport({
      definitions: [definitions[0]!],
      now: new Date("2026-09-30T12:00:00.000Z"),
      groups: [
        group(".github/workflows/weekly.yml", [
          run(4, ".github/workflows/weekly.yml", "2026-09-30T04:17:00.000Z", null, "in_progress"),
          run(3, ".github/workflows/weekly.yml", "2026-09-16T04:17:00.000Z", "success"),
          run(2, ".github/workflows/weekly.yml", "2026-09-09T04:17:00.000Z", "success"),
          run(1, ".github/workflows/weekly.yml", "2026-09-02T04:17:00.000Z", "success"),
        ]),
      ],
    });
    const row = report.rows[0]!;
    assert.equal(row.observedGapHours, 336);
    assert.equal(row.staleAfterHours, 240);
    assert.equal(row.state, "STALE");
    assert.match(row.reasons.join(" "), /Observed scheduled-run gap/);
  });

  it("does not keep a recovered workflow stale because of an older historical gap", () => {
    const report = buildScheduledAutomationHealthReport({
      definitions: [definitions[0]!],
      now: new Date("2026-09-30T12:00:00.000Z"),
      groups: [
        group(".github/workflows/weekly.yml", [
          run(5, ".github/workflows/weekly.yml", "2026-09-30T04:17:00.000Z", "success"),
          run(4, ".github/workflows/weekly.yml", "2026-09-23T04:17:00.000Z", "success"),
          run(3, ".github/workflows/weekly.yml", "2026-09-09T04:17:00.000Z", "success"),
          run(2, ".github/workflows/weekly.yml", "2026-09-02T04:17:00.000Z", "success"),
          run(1, ".github/workflows/weekly.yml", "2026-08-26T04:17:00.000Z", "success"),
        ]),
      ],
    });
    const row = report.rows[0]!;
    assert.equal(row.observedGapHours, 168);
    assert.equal(row.staleAfterHours, 240);
    assert.equal(row.state, "HEALTHY");
  });

  it("fails closed as warning when GitHub scheduled-run projection is unavailable", () => {
    const report = buildScheduledAutomationHealthReport({
      definitions: [definitions[0]!],
      groups: [],
      projectionAvailable: false,
      now: new Date("2026-09-30T12:00:00.000Z"),
    });
    assert.equal(report.rows[0]?.state, "WARNING");
    assert.match(report.rows[0]?.reasons[0] ?? "", /unavailable/i);
  });

  it("renders evidence without suggesting automatic rerun or patch", () => {
    const report = buildScheduledAutomationHealthReport({
      definitions: [definitions[2]!],
      groups: [],
      now: new Date("2026-09-30T12:00:00.000Z"),
    });
    const markdown = renderScheduledAutomationHealthMarkdown(report);
    assert.match(markdown, /Scheduled Automation Health/);
    assert.match(markdown, /MISSING/);
    assert.match(markdown, /does not rerun, patch, disable, or merge/i);
  });
});

describe("weekly code health integration", () => {
  it("turns automation-health problems into WARNING while remaining read-only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-health-automation-"));
    write(
      root,
      ".github/workflows/missing.yml",
      'name: Missing Test\non:\n  schedule:\n    - cron: "0 3 * * 2"\n'
    );
    write(root, "package.json", JSON.stringify({ dependencies: {}, devDependencies: {} }));

    const report = runWeeklyCodeHealthAudit({
      repoRoot: root,
      mainSha: "fixture",
      now: new Date("2026-09-30T12:00:00.000Z"),
      scheduledAutomationGroups: [],
      scheduledProjectionAvailable: true,
      allowSafeDelete: true,
    });

    assert.equal(report.status, "WARNING");
    assert.equal(report.productionMutated, false);
    assert.equal(report.automationHealth?.missingCount, 1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
