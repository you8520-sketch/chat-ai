/**
 * Isolation contract: code-health audit/cleanup never become a Railway
 * production scheduler or a chat/billing/adult runtime owner.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { RAILWAY_SCHEDULER_JOBS_UNCHANGED } from "@/lib/codeHealth/ownerMap";
import { SCHEDULER_DEFINITIONS } from "@/lib/schedulerDefinitions";
import { CODE_HEALTH_AUDIT_MUTATES_PRODUCTION, CODE_HEALTH_CLEANUP_AUTO_MERGE } from "@/lib/codeHealth/types";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".next")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

describe("code health isolation", () => {
  it("is not registered on the Railway durable scheduler", () => {
    assert.deepEqual(Object.keys(SCHEDULER_DEFINITIONS).sort(), [...RAILWAY_SCHEDULER_JOBS_UNCHANGED]);
    assert.doesNotMatch(readFileSync("server.js", "utf8"), /codeHealth|code-health/);
    assert.doesNotMatch(readFileSync("src/lib/schedulerDefinitions.ts", "utf8"), /codeHealth|code-health/);
  });

  it("serializes weekly/monthly writes to the shared ledger and audits production JSON too", () => {
    const weekly = readFileSync(".github/workflows/code-health-weekly-audit.yml", "utf8");
    const monthly = readFileSync(".github/workflows/code-health-monthly-cleanup.yml", "utf8");
    assert.match(weekly, /group:\s*code-health-ledger/);
    assert.match(monthly, /group:\s*code-health-ledger/);
    assert.doesNotMatch(weekly, /:\!\*\.json/);
    assert.doesNotMatch(monthly, /:\!\*\.json/);
    assert.match(weekly, /git diff --exit-code -- \. ':!artifacts'/);
    assert.match(monthly, /git diff --exit-code -- \. ':!artifacts'/);
  });

  it("weekly audit and monthly cleanup never mutate production or auto-merge", () => {
    assert.equal(CODE_HEALTH_AUDIT_MUTATES_PRODUCTION, false);
    assert.equal(CODE_HEALTH_CLEANUP_AUTO_MERGE, false);
    const audit = readFileSync("src/lib/codeHealth/audit.ts", "utf8");
    const weeklyCli = readFileSync("scripts/code-health-audit.ts", "utf8");
    assert.doesNotMatch(audit, /from "@\/lib\/db"/);
    assert.doesNotMatch(audit, /getDb\(/);
    assert.doesNotMatch(weeklyCli, /applyEligibleUnusedFileDeletes/);
    assert.doesNotMatch(weeklyCli, /from "@\/lib\/db"/);
  });

  it("production runtime modules do not import the auditor or cleanup applier", () => {
    const offenders = [...walk("src"), "server.js"].filter((p) => {
      if (p.startsWith(join("src", "lib", "codeHealth"))) return false;
      if (p.includes(".test.")) return false;
      const text = readFileSync(p, "utf8");
      return (
        /@\/lib\/codeHealth\/audit|@\/lib\/codeHealth\/cleanup|@\/lib\/codeHealth\/scan/.test(text)
      );
    });
    assert.deepEqual(offenders, []);
  });

  it("admin automation reports stay the display owner and remain admin-gated", () => {
    const page = readFileSync("src/app/admin/automation-reports/page.tsx", "utf8");
    assert.match(page, /requireAdminUser/);
    assert.match(page, /Weekly Code Health/);
    assert.match(page, /Monthly Cleanup/);
    assert.match(page, /fetchCodeHealthAdminProjection/);
    assert.doesNotMatch(page, /codeHealth\/audit|codeHealth\/cleanup|codeHealth\/scan/);
    const ops = readFileSync("src/app/admin/ops/page.tsx", "utf8");
    assert.doesNotMatch(ops, /codeHealth|Weekly Code Health|Monthly Cleanup/);
  });

  it("only the workflow CLIs consume the auditor outside tests", () => {
    const consumers = walk("scripts").filter((p) => {
      const text = readFileSync(p, "utf8");
      return text.includes("@/lib/codeHealth/");
    });
    assert.deepEqual(consumers.sort(), [
      join("scripts", "code-health-audit.ts"),
      join("scripts", "code-health-monthly-cleanup.ts"),
    ]);
  });
});
