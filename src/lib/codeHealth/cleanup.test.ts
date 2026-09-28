import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runWeeklyCodeHealthAudit } from "@/lib/codeHealth/audit";
import {
  applyEligibleUnusedFileDeletes,
  isEligibleCleanupCandidate,
  planCleanupDraftPr,
  runMonthlyCleanup,
  selectCleanupBatch,
} from "@/lib/codeHealth/cleanup";
import type { CodeHealthCandidate, WeeklyCodeHealthReport } from "@/lib/codeHealth/types";
import { CODE_HEALTH_CLEANUP_AUTO_MERGE, CODE_HEALTH_CLEANUP_MAX_ITEMS } from "@/lib/codeHealth/types";

function candidate(partial: Partial<CodeHealthCandidate> & Pick<CodeHealthCandidate, "id" | "path">): CodeHealthCandidate {
  return {
    kind: "unused_file",
    classification: "SAFE_TO_DELETE",
    symbol: null,
    summary: "safe",
    evidence: {
      writerPresent: false,
      readerPresent: false,
      staticReferences: 0,
      dynamicOrRuntimeReferences: 0,
      productionExecutionPath: false,
      dbExistingDataImpact: false,
      rollbackOrCompatibilityImpact: false,
    },
    stopReasons: [],
    bugfix: false,
    knipEquivalent: true,
    ...partial,
  };
}

describe("monthly cleanup gates", () => {
  it("rejects UNCONFIRMED, migrations, auth/adult, and pricing candidates", () => {
    const current = [
      candidate({ id: "unused_file:a.ts:", path: "a.ts", classification: "UNCONFIRMED" }),
      candidate({
        id: "db_field_writer_reader_gap:src/lib/db.ts:gone",
        path: "src/lib/db.ts",
        kind: "db_field_writer_reader_gap",
        classification: "SAFE_TO_DELETE",
        stopReasons: ["destructive_migration"],
      }),
      candidate({
        id: "unused_file:src/lib/adult.ts:",
        path: "src/lib/adult.ts",
        stopReasons: ["security_auth_adult_boundary"],
      }),
      candidate({
        id: "unused_file:src/lib/modelPricingPolicy.ts:",
        path: "src/lib/modelPricingPolicy.ts",
        stopReasons: ["provider_cost_pricing_routing"],
      }),
    ];
    for (const row of current) {
      assert.equal(isEligibleCleanupCandidate(row, current).ok, false);
    }
  });

  it("caps a cleanup batch and never enables auto-merge", () => {
    assert.equal(CODE_HEALTH_CLEANUP_AUTO_MERGE, false);
    const many = Array.from({ length: 8 }, (_, i) =>
      candidate({ id: `unused_file:f${i}.ts:`, path: `f${i}.ts` })
    );
    const { eligible } = selectCleanupBatch(many, many);
    assert.equal(eligible.length, CODE_HEALTH_CLEANUP_MAX_ITEMS);
    const plan = planCleanupDraftPr({ eligible, createPr: false });
    assert.equal(plan.created, false);
    assert.deepEqual(plan.selectedIds.length, CODE_HEALTH_CLEANUP_MAX_ITEMS);
  });

  it("revalidates against the current main candidate set before a Draft PR", () => {
    const stale = candidate({ id: "unused_file:gone.ts:", path: "gone.ts" });
    assert.equal(isEligibleCleanupCandidate(stale, []).ok, false);
    assert.equal(isEligibleCleanupCandidate(stale, [stale]).ok, true);
  });

  it("deletes only eligible unused files inside a fixture root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-health-del-"));
    fs.writeFileSync(path.join(root, "keep.ts"), "export const keep = 1;\n");
    fs.writeFileSync(path.join(root, "gone.ts"), "export const gone = 1;\n");
    const deleted = applyEligibleUnusedFileDeletes(root, [
      candidate({ id: "unused_file:gone.ts:", path: "gone.ts" }),
      candidate({
        id: "unused_file:keep.ts:",
        path: "keep.ts",
        classification: "UNCONFIRMED",
      }),
    ]);
    assert.deepEqual(deleted, ["gone.ts"]);
    assert.equal(fs.existsSync(path.join(root, "keep.ts")), true);
    assert.equal(fs.existsSync(path.join(root, "gone.ts")), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("builds a monthly report without mutating production or auto-merging", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-health-month-"));
    fs.writeFileSync(path.join(root, "package.json"), "{\"dependencies\":{}}");
    const weekly = runWeeklyCodeHealthAudit({ repoRoot: root, mainSha: "sha" });
    const weeklies: WeeklyCodeHealthReport[] = [weekly];
    const report = runMonthlyCleanup({
      weeklies,
      currentCandidates: weekly.candidates,
      mainSha: "sha",
      createPr: false,
    });
    assert.equal(report.kind, "monthly");
    assert.equal(report.productionMutated, false);
    assert.equal(report.autoMerged, false);
    assert.equal(report.draftPr.created, false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
