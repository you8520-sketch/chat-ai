import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const EXPECTED_PRIMARY_PROMPT_SHA256 = "4245452eb05dc13608927efd0fafd8ceac80678d80daee4d14fe2f85d6ce1269";
const NODE_ARGS = ["--conditions=react-server", "--import", "tsx", "scripts/wolfgang-rep-model-ab.ts"];

function harnessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, NODE_TEST_CONTEXT: "1" };
  delete env.OPENAI_API_KEY;
  return env;
}

function runHarness(args: string[], outDir?: string): { status: number | null; stdout: string; stderr: string } {
  const argv = [...NODE_ARGS, ...args];
  if (outDir) argv.push("--out", outDir);
  const result = spawnSync(process.execPath, argv, {
    cwd: process.cwd(),
    env: harnessEnv(),
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("wolfgang-rep-model-ab harness", () => {
  it("rejects unknown reference keys before provider work", () => {
    const result = runHarness(["preflight", "--refs", "99"], fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-ab-bad-ref-")));
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /unknown reference key: 99/);
  });

  it("rejects unknown --arm models", () => {
    const bad = runHarness(["preflight", "--arm", "gpt-image-1"], fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-ab-bad-arm-")));
    assert.notEqual(bad.status, 0);
    assert.match(`${bad.stderr}${bad.stdout}`, /unknown --arm model/);
  });

  it("preflight keeps canonical SHA for default A/B and 07+04 single-arm runs", () => {
    const outDefault = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-ab-default-"));
    const outPilot = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-ab-pilot-"));
    const defaultRun = runHarness(["preflight"], outDefault);
    assert.equal(defaultRun.status, 0, defaultRun.stderr);
    const pilotRun = runHarness(["preflight", "--arm", "gpt-image-2", "--refs", "07,04"], outPilot);
    assert.equal(pilotRun.status, 0, pilotRun.stderr);

    const defaultEvidence = JSON.parse(fs.readFileSync(path.join(outDefault, "preflight.json"), "utf8")) as {
      primaryPromptSha256: string;
      models: { model: string }[];
      references: { referenceKey: string | null }[];
    };
    const pilotEvidence = JSON.parse(fs.readFileSync(path.join(outPilot, "preflight.json"), "utf8")) as {
      primaryPromptSha256: string;
      models: { model: string }[];
      referenceKeys: string[];
      references: { referenceKey: string | null }[];
    };

    assert.equal(defaultEvidence.primaryPromptSha256, EXPECTED_PRIMARY_PROMPT_SHA256);
    assert.equal(pilotEvidence.primaryPromptSha256, EXPECTED_PRIMARY_PROMPT_SHA256);
    assert.equal(defaultEvidence.models.length, 2);
    assert.equal(pilotEvidence.models.length, 1);
    assert.equal(pilotEvidence.models[0]!.model, "gpt-image-2");
    assert.deepEqual(pilotEvidence.referenceKeys, ["07", "04"]);
    assert.deepEqual(
      pilotEvidence.references.map((item) => item.referenceKey),
      ["07", "04"]
    );
    assert.deepEqual(
      defaultEvidence.references.map((item) => item.referenceKey),
      ["07", "04", "08"]
    );
  });

  it("post refuses duplicate ledger without provider calls", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-ab-ledger-"));
    fs.writeFileSync(path.join(out, "ledger.json"), "{}\n");
    const env = harnessEnv();
    env.WOLFGANG_REP_AB_LIVE = "1";
    env.OPENAI_API_KEY = "sk-test";
    const result = spawnSync(process.execPath, [...NODE_ARGS, "post", "--out", out], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /ledger exists/);
  });
});
