import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

it("implementation Draft PR workflow is connected end-to-end to CLI commands", () => {
  const cli = readFileSync("scripts/memory-research-cycle.ts", "utf8");
  const workflow = readFileSync(".github/workflows/memory-research-cycle.yml", "utf8");

  assert.match(cli, /command === "implementation-prs"/);
  assert.match(cli, /implementationPrs\(\)/);
  assert.match(cli, /command === "apply-implementation-results"/);
  assert.match(cli, /applyImplementationResults\(\)/);

  assert.match(workflow, /scripts\/memory-research-cycle\.ts implementation-prs/);
  assert.match(workflow, /scripts\/memory-research-cycle\.ts apply-implementation-results/);
  assert.match(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /gh pr merge|--auto\b|enable-auto-merge|auto_merge/);
});

it("implementation CLI source contains no escaped-newline import corruption", () => {
  const cli = readFileSync("scripts/memory-research-cycle.ts", "utf8");
  assert.doesNotMatch(cli, /import \{\\n/);
  assert.doesNotMatch(cli, /;\\nimport /);
});
