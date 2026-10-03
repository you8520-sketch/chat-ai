import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, it } from "node:test";

const WORKFLOW_LOADER = [
  "--conditions=react-server",
  "--import",
  "tsx",
  "--import",
  "./src/lib/test/regularTestEgressPolicy.ts",
] as const;

const PROVIDER_FREE_ENV = {
  REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
  DECISION_MODEL_RADAR_LIVE: "0",
  OPENROUTER_API_KEY: "",
  OPENROUTER_JEV_BENCHMARK_API_KEY: "",
  CHEAPER_INFERENCE_API_KEY: "",
  OPENAI_API_KEY: "",
};

function runWithWorkflowLoader(args: string[]) {
  return spawnSync(process.execPath, [...WORKFLOW_LOADER, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...PROVIDER_FREE_ENV },
  });
}

describe("decision model radar isolation", () => {
  it("keeps the production JEV pin and Railway scheduler outside radar ownership", () => {
    const jev = fs.readFileSync("src/lib/jevDecisions.ts", "utf8");
    const workflow = fs.readFileSync(
      ".github/workflows/decision-model-radar-weekly.yml",
      "utf8"
    );
    const scheduler = fs.readFileSync("src/lib/schedulerDefinitions.ts", "utf8");

    assert.match(jev, /JEV_DECISIONS_MODEL\s*=\s*"typesafe\/jev-1\.13"/);
    assert.doesNotMatch(workflow, /schedulerDefinitions\.ts|src\/cron\/|mcp__Railway__|merge_pull_request/);
    assert.doesNotMatch(scheduler, /decision[_-]model[_-]radar/i);
    assert.match(workflow, /decision-model-radar-ledger/);
    assert.match(workflow, /git diff --exit-code -- \. ':!artifacts'/);
  });

  it("requires explicit benchmark opt-in and never auto-switches models", () => {
    const runner = fs.readFileSync("scripts/decision-model-radar.ts", "utf8");
    assert.match(runner, /REGULAR_TEST_REAL_PROVIDER_CALLS/);
    assert.match(runner, /DECISION_MODEL_RADAR_LIVE/);
    assert.match(runner, /runtimeModelPinChanged:\s*false/);
    assert.match(runner, /autoSwitchEnabled:\s*false/);
    assert.doesNotMatch(runner, /JEV_DECISIONS_MODEL\s*=/);
  });

  it("keeps the comparison credential import in the same scripts/lib directory", () => {
    const comparison = fs.readFileSync("scripts/lib/decisionModelComparison.ts", "utf8");
    assert.match(comparison, /from "\.\/authorialHabitJevBenchmarkCredential"/);
    assert.doesNotMatch(comparison, /from "\.\/lib\/authorialHabitJevBenchmarkCredential"/);
    assert.ok(fs.existsSync("scripts/lib/authorialHabitJevBenchmarkCredential.ts"));
    assert.equal(fs.existsSync("scripts/lib/lib/authorialHabitJevBenchmarkCredential.ts"), false);
  });

  it("loads decisionModelComparison with the weekly radar Node/tsx loader", () => {
    const result = runWithWorkflowLoader([
      "--eval",
      "import('./scripts/lib/decisionModelComparison.ts').then((mod) => { const baseline = mod.DECISION_BASELINE_MODEL ?? mod.default?.DECISION_BASELINE_MODEL; if (baseline !== 'typesafe/jev-1.13') throw new Error('unexpected baseline'); console.log('LOAD_OK'); })",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /LOAD_OK/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /MODULE_NOT_FOUND/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /openrouter\.ai/i);
  });

  it("fail-closes the weekly entrypoint when the benchmark credential is absent", () => {
    const result = runWithWorkflowLoader(["scripts/decision-model-radar.ts"]);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /OPENROUTER_JEV_BENCHMARK_API_KEY is required/
    );
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /MODULE_NOT_FOUND/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /openrouter\.ai\/api/i);
  });
});
