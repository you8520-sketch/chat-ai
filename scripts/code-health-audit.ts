/**
 * Weekly Code Health CLI — GitHub Actions entry. Never started by server.js.
 *
 *   node --conditions=react-server --import tsx scripts/code-health-audit.ts
 *
 * Read-only against the repo. Writes report files under --out only.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  AUTOMATION_REPORTS_GITHUB_REPO,
  fetchGithubScheduledAutomationProjection,
} from "@/lib/adminAutomationReports";
import { fetchRecentFailedGithubRuns, renderWeeklyMarkdown, runWeeklyCodeHealthAudit } from "@/lib/codeHealth/audit";
import { latestWeekly, parseCodeHealthLedger, prependWeekly } from "@/lib/codeHealth/ledger";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function writeOutput(key: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function main(): Promise<void> {
  const repoRoot = arg("repo-root") ?? process.cwd();
  const outDir = arg("out") ?? process.env.CODE_HEALTH_AUDIT_OUT_DIR ?? "artifacts/code-health-weekly";
  const ledgerPath = arg("ledger") ?? join(outDir, "ledger.json");
  const mainSha = arg("main-sha") ?? process.env.GITHUB_SHA ?? "unknown";
  const githubRunUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  mkdirSync(outDir, { recursive: true });
  const previousLedger = parseCodeHealthLedger(existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : null);
  const ciRuns = await fetchRecentFailedGithubRuns(fetch, AUTOMATION_REPORTS_GITHUB_REPO);
  const scheduledProjection = await fetchGithubScheduledAutomationProjection(fetch);
  const report = runWeeklyCodeHealthAudit({
    repoRoot,
    mainSha,
    previous: latestWeekly(previousLedger),
    ciRuns,
    githubRunUrl,
    allowSafeDelete: true,
    scheduledAutomationGroups: scheduledProjection.groups,
    scheduledProjectionAvailable: scheduledProjection.status === "OK",
    notes:
      scheduledProjection.status === "OK"
        ? []
        : [`Scheduled workflow projection unavailable: ${scheduledProjection.error ?? "unknown error"}`],
  });
  const nextLedger = prependWeekly(previousLedger, report);

  writeFileSync(join(outDir, "weekly.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "ledger.json"), JSON.stringify(nextLedger, null, 2));
  writeFileSync(join(outDir, "REPORT.md"), renderWeeklyMarkdown(report));
  writeFileSync(join(outDir, "latest-weekly.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    runStatus: report.status,
    productionMutated: report.productionMutated,
    newFindings: report.counts.newFindings,
    safeToDelete: report.counts.safeToDelete,
  }));
  writeOutput("run_status", report.status);
  writeOutput("production_mutated", String(report.productionMutated));
  writeOutput("safe_to_delete", String(report.counts.safeToDelete));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
