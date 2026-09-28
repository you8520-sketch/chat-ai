import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { renderWeeklyMarkdown, runWeeklyCodeHealthAudit } from "@/lib/codeHealth/audit";
import { classifyCandidate } from "@/lib/codeHealth/classify";
import { isFrameworkEntry, isKeepPath, isSchedulerOnlyEntry } from "@/lib/codeHealth/keep";
import { buildImportGraph, scanUnusedFiles, walkSourceFiles } from "@/lib/codeHealth/scan";
import type { CodeHealthCandidate } from "@/lib/codeHealth/types";
import { CODE_HEALTH_AUDIT_MUTATES_PRODUCTION, formatTrend } from "@/lib/codeHealth/types";

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
}

function unusedFileCandidate(overrides: Partial<CodeHealthCandidate> = {}): CodeHealthCandidate {
  return {
    id: "unused_file:src/lib/orphan.ts:",
    kind: "unused_file",
    classification: "UNCONFIRMED",
    path: "src/lib/orphan.ts",
    symbol: null,
    summary: "orphan",
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
    ...overrides,
  };
}

describe("code health keep / false-positive fixtures", () => {
  it("keeps Next.js, scheduler, script, and test entries", () => {
    assert.equal(isFrameworkEntry("src/app/page.tsx"), true);
    assert.equal(isFrameworkEntry("src/app/api/chat/route.ts"), true);
    assert.equal(isSchedulerOnlyEntry("src/cron/financeScheduler.ts"), true);
    assert.equal(isKeepPath("scripts/code-health-audit.ts"), true);
    assert.equal(isKeepPath("src/lib/chatModels.test.ts"), true);
    assert.equal(isKeepPath("src/lib/orphan.ts"), false);
  });

  it("does not treat a dynamically imported module as an unused file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-health-dyn-"));
    writeTree(root, {
      "src/lib/host.ts": `export async function load() { return import("./lazy"); }\n`,
      "src/lib/lazy.ts": `export const lazyValue = 1;\n`,
    });
    const graph = buildImportGraph(walkSourceFiles(root));
    const unused = scanUnusedFiles(graph).map((c) => c.path);
    assert.equal(unused.includes("src/lib/lazy.ts"), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps framework/scheduler files out of unused-file candidates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-health-keep-"));
    writeTree(root, {
      "src/app/page.tsx": `export default function Page() { return null; }\n`,
      "src/cron/job.ts": `export function start() {}\n`,
      "scripts/only-script.ts": `export const cli = 1;\n`,
    });
    const unused = scanUnusedFiles(buildImportGraph(walkSourceFiles(root)));
    assert.deepEqual(unused.map((c) => c.path), []);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("code health classification", () => {
  it("promotes a fully evidenced unused file to SAFE_TO_DELETE", () => {
    const classified = classifyCandidate(unusedFileCandidate());
    assert.equal(classified.classification, "SAFE_TO_DELETE");
  });

  it("does not promote UNCONFIRMED when a reader or dynamic reference exists", () => {
    const classified = classifyCandidate(
      unusedFileCandidate({
        evidence: {
          writerPresent: false,
          readerPresent: true,
          staticReferences: 0,
          dynamicOrRuntimeReferences: 1,
          productionExecutionPath: false,
          dbExistingDataImpact: false,
          rollbackOrCompatibilityImpact: false,
        },
      })
    );
    assert.notEqual(classified.classification, "SAFE_TO_DELETE");
    assert.ok(classified.stopReasons.includes("static_analyzer_false_positive_unresolved"));
  });

  it("marks critical findings as REQUIRED_CLEANUP / BUGFIX and never as auto-patch", () => {
    const classified = classifyCandidate(
      unusedFileCandidate({
        id: "critical_bugfix:src/lib/leak.ts:",
        kind: "critical_bugfix",
        path: "src/lib/leak.ts",
        bugfix: true,
      })
    );
    assert.equal(classified.classification, "REQUIRED_CLEANUP");
    assert.equal(classified.bugfix, true);
  });
});

describe("weekly read-only audit", () => {
  it("never claims production mutation and writes no source files", () => {
    assert.equal(CODE_HEALTH_AUDIT_MUTATES_PRODUCTION, false);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-health-week-"));
    writeTree(root, {
      "package.json": JSON.stringify({
        dependencies: { next: "15.0.0", leftover: "1.0.0" },
        devDependencies: { typescript: "5.0.0" },
      }),
      ".env.example": "USED_FLAG=1\nORPHAN_FLAG_ENABLED=1\n",
      "src/lib/used.ts": `export const used = process.env.USED_FLAG;\n`,
      "src/lib/orphan.ts": `export const orphan = 1;\n`,
      "src/app/page.tsx": `import { used } from "@/lib/used";\nexport default function Page() { return used; }\n`,
    });
    const before = fs.readdirSync(path.join(root, "src/lib")).sort();
    const report = runWeeklyCodeHealthAudit({
      repoRoot: root,
      mainSha: "abc123",
      now: new Date("2026-09-28T00:00:00.000Z"),
    });
    const after = fs.readdirSync(path.join(root, "src/lib")).sort();
    assert.deepEqual(after, before);
    assert.equal(report.productionMutated, false);
    assert.equal(report.kind, "weekly");
    assert.ok(report.candidates.some((c) => c.path === "src/lib/orphan.ts"));
    assert.ok(report.candidates.some((c) => c.symbol === "ORPHAN_FLAG_ENABLED"));
    assert.ok(report.candidates.some((c) => c.symbol === "leftover"));
    assert.match(renderWeeklyMarkdown(report), /Weekly Code Health/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("computes quality trend as previous → current, not an absolute score", () => {
    assert.equal(formatTrend({ previous: 31, current: 22 }), "31 → 22");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-health-empty-"));
    const first = runWeeklyCodeHealthAudit({
      repoRoot: root,
      mainSha: "1",
    });
    assert.equal(first.delta?.unusedCandidates.previous, null);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
