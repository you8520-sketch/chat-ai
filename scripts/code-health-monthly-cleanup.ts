/**
 * Monthly Code Health cleanup CLI — GitHub Actions entry. Never started by server.js.
 * Never auto-merges. Creates a Draft PR only when every gate passes and --create-pr is set.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runWeeklyCodeHealthAudit } from "@/lib/codeHealth/audit";
import { renderMonthlyMarkdown, runMonthlyCleanup } from "@/lib/codeHealth/cleanup";
import {
  latestMonthly,
  parseCodeHealthLedger,
  prependMonthly,
  weekliesSincePreviousMonthly,
} from "@/lib/codeHealth/ledger";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function writeOutput(key: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function main(): Promise<void> {
  const repoRoot = arg("repo-root") ?? process.cwd();
  const outDir = arg("out") ?? process.env.CODE_HEALTH_CLEANUP_OUT_DIR ?? "artifacts/code-health-monthly";
  const ledgerPath = arg("ledger") ?? join(outDir, "ledger.json");
  const mainSha = arg("main-sha") ?? process.env.GITHUB_SHA ?? "unknown";
  const createPr = hasFlag("create-pr") || process.env.CODE_HEALTH_CREATE_CLEANUP_PR === "1";
  const githubRunUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  mkdirSync(outDir, { recursive: true });
  const ledger = parseCodeHealthLedger(existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : null);
  const current = runWeeklyCodeHealthAudit({
    repoRoot,
    mainSha,
    previous: ledger.weekly[0] ?? null,
    allowSafeDelete: true,
  });
  const weeklies = weekliesSincePreviousMonthly(prependableCurrent(ledger, current));
  const report = runMonthlyCleanup({
    weeklies: weeklies.length > 0 ? weeklies : [current],
    currentCandidates: current.candidates,
    mainSha,
    previous: latestMonthly(ledger),
    createPr,
    githubRunUrl,
  });
  const nextLedger = prependMonthly(
    { ...ledger, weekly: [current, ...ledger.weekly].slice(0, 12) },
    report
  );

  writeFileSync(join(outDir, "monthly.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "eligible.json"), JSON.stringify(report.eligibleIds, null, 2));
  writeFileSync(join(outDir, "ledger.json"), JSON.stringify(nextLedger, null, 2));
  writeFileSync(join(outDir, "REPORT.md"), renderMonthlyMarkdown(report));
  writeFileSync(join(outDir, "latest-monthly.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    runStatus: report.status,
    productionMutated: report.productionMutated,
    autoMerged: report.autoMerged,
    draftPrCreated: report.draftPr.created,
    eligible: report.eligibleIds.length,
  }));
  writeOutput("run_status", report.status);
  writeOutput("draft_pr_created", String(report.draftPr.created));
  writeOutput("eligible_count", String(report.eligibleIds.length));
  writeOutput("auto_merged", String(report.autoMerged));
}

function prependableCurrent(
  ledger: ReturnType<typeof parseCodeHealthLedger>,
  current: ReturnType<typeof runWeeklyCodeHealthAudit>
) {
  return { ...ledger, weekly: [current, ...ledger.weekly] };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
