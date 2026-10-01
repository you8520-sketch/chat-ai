/**
 * Current-main autonomy coverage lock.
 * Reads workflow files, scheduler definitions, and the audit document.
 * Does not rerun GitHub jobs, write ledgers, or change production owners.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { scanScheduledWorkflowDefinitions } from "@/lib/codeHealth/automationHealth";
import { SCHEDULER_DEFINITIONS } from "@/lib/schedulerDefinitions";

const ROOT = path.resolve(__dirname, "../../..");
const AUDIT = path.join(ROOT, "docs/audit/current-main-autonomy-map.md");

const FINDING_STATUS = new Set([
  "STILL_TRUE",
  "SUPERSEDED",
  "FIXED",
  "OBSOLETE",
  "UNKNOWN",
]);

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function inventoryBlock(markdown: string, name: string): string[] {
  const pattern = new RegExp(
    `<!-- autonomy-inventory:${name} -->\\r?\\n([\\s\\S]*?)\\r?\\n<!-- /autonomy-inventory:${name} -->`
  );
  const match = markdown.match(pattern);
  assert.ok(match, `missing inventory block ${name}`);
  return match[1]!
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

test("scheduled workflow inventory matches current main and has no actions:write", () => {
  const markdown = fs.readFileSync(AUDIT, "utf8");
  const documented = inventoryBlock(markdown, "scheduled-workflows");
  const scanned = scanScheduledWorkflowDefinitions(ROOT)
    .map((row) => row.path)
    .sort();
  assert.deepEqual(documented, scanned);

  for (const rel of scanned) {
    const text = read(rel);
    assert.equal(/^\s*actions:\s*write\s*$/m.test(text), false, rel);
    assert.match(text, /schedule:/);
  }
});

test("in-process scheduler retry flags match the audit inventory", () => {
  const markdown = fs.readFileSync(AUDIT, "utf8");
  const documented = inventoryBlock(markdown, "schedulers");
  const live = (Object.keys(SCHEDULER_DEFINITIONS) as Array<keyof typeof SCHEDULER_DEFINITIONS>)
    .sort()
    .map((name) => {
      const definition = SCHEDULER_DEFINITIONS[name];
      return `${name} safeFailedRetry=${definition.safeFailedRetry} safeStaleReclaim=${definition.safeStaleReclaim}`;
    });
  assert.deepEqual(documented, live);
});

test("GitHub failed-job rerun stays unproven and unimplemented", () => {
  const markdown = fs.readFileSync(AUDIT, "utf8");
  const rows = Object.fromEntries(
    inventoryBlock(markdown, "github-rerun").map((line) => {
      const split = line.indexOf("=");
      assert.ok(split > 0, line);
      return [line.slice(0, split), line.slice(split + 1)];
    })
  );
  assert.equal(rows.authority, "ACTUATE");
  assert.equal(rows.permission, "actions:write");
  assert.equal(rows.retrySafety, "REVIEW_REQUIRED");
  assert.equal(rows.humanGate, "YES");
  assert.equal(rows.implemented, "NO");
  assert.equal(read("src/lib/codeHealth/automationHealth.ts").includes("does not rerun"), true);
  assert.match(read("src/lib/adminOpsInbox.ts"), /자동 재실행은 하지 않으며/);
});

test("PR 1002 dispositions stay inside the allowed vocabulary", () => {
  const markdown = fs.readFileSync(AUDIT, "utf8");
  const rows = inventoryBlock(markdown, "pr-1002");
  const seen = new Map<string, string>();
  for (const line of rows) {
    const [key, status] = line.split(/\s+/);
    assert.ok(key && status, line);
    assert.equal(FINDING_STATUS.has(status!), true, line);
    seen.set(key!, status!);
  }
  assert.equal(seen.get("ops_inbox"), "FIXED");
  assert.equal(seen.get("scheduler_run_registry"), "FIXED");
  assert.equal(seen.get("payout_transfer_before_claim"), "FIXED");
  assert.equal(seen.get("subscription_demo_grant"), "FIXED");
  assert.equal(seen.get("shallow_health"), "STILL_TRUE");
  assert.equal(seen.get("github_failed_job_rerun"), "UNKNOWN");
  assert.match(markdown, /SUPERSEDED_BY_CURRENT_MAIN/);
  assert.match(markdown, /AUTONOMY_COVERAGE_AUDIT_COMPLETE/);
});

test("current execution owners still exist on the paths the audit names", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "src/app/admin/ops/page.tsx")), true);
  assert.equal(fs.existsSync(path.join(ROOT, "src/app/admin/automation-reports/page.tsx")), true);
  assert.equal(fs.existsSync(path.join(ROOT, "src/lib/schedulerRunRegistry.ts")), true);

  const subscription = read("src/app/api/cron/subscription-renew/route.ts");
  assert.equal(subscription.includes("processDueRenewals"), false);
  assert.match(subscription, /status: 503/);

  const payout = read("src/lib/payoutExecution.ts");
  const claimAt = payout.indexOf("markAttemptDispatched");
  const transferAt = payout.indexOf("provider.transfer(");
  assert.ok(claimAt > 0 && transferAt > claimAt);
  assert.match(payout, /never call transfer\(\) again automatically/);

  const server = read("server.js");
  for (const owner of [
    "startPayoutScheduler",
    "startFinanceScheduler",
    "startTrainingScheduler",
    "startMainRpCacheTtlAuditScheduler",
    "startWebPushSchedulers",
    "startAdminSupplyDraftNotificationScheduler",
  ]) {
    assert.match(server, new RegExp(owner));
  }

  const health = read("src/lib/codeHealth/automationHealth.ts");
  const inbox = read("src/lib/adminOpsInbox.ts");
  assert.equal(health.includes("adminOpsInbox"), false);
  assert.equal(inbox.includes("automationHealth"), false);
});
