/**
 * Targeted 14-call R1/R5 pilot: fixed V2 + Living only.
 * V1 baseline is reused from data/scene-policy-pilot/pilot-result.json.
 *
 *   node --conditions=react-server --import tsx scripts/scene-policy-benchmark-targeted-pilot-run.ts
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  buildGptEvaluationArtifact,
  deriveTargetedReconvergencePilotSamples,
  invokeBenchmarkProviderCall,
  runTargetedReconvergencePilot,
  type PilotCaptureRecord,
} from "../src/lib/scenePolicyBenchmarkPilotRunner";
import { resolveBenchmarkCheaperInferenceApiKey } from "./lib/benchmarkCheaperInferenceCredential";

loadEnvLocal();

const OUT_DIR = path.join(process.cwd(), "data/scene-policy-pilot");
const BASELINE_PATH = path.join(OUT_DIR, "pilot-result.json");
const PILOT_BASELINE_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const MAIN_SYNC_SHA = execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();

async function main() {
  const benchmarkKey = resolveBenchmarkCheaperInferenceApiKey();
  if (!benchmarkKey) {
    console.log("PILOT_STATUS=NOT_RUN — missing CHEAPER_INFERENCE_BENCHMARK_API_KEY");
    console.log("provider calls=0");
    process.exit(0);
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`missing baseline pilot at ${BASELINE_PATH}`);
  }

  const samples = deriveTargetedReconvergencePilotSamples();
  console.log("PILOT_BASELINE_SHA", PILOT_BASELINE_SHA);
  console.log("MAIN_SYNC_SHA", MAIN_SYNC_SHA);
  console.log("targeted samples", samples.length);

  const result = await runTargetedReconvergencePilot({
    pilotBaselineSha: PILOT_BASELINE_SHA,
    mainSyncSha: MAIN_SYNC_SHA,
    invokeProvider: (input) =>
      invokeBenchmarkProviderCall({ ...input, cheaperInferenceApiKey: benchmarkKey }),
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "targeted-pilot-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as {
    captures: PilotCaptureRecord[];
  };
  const v1Baseline = baseline.captures.filter(
    (c) =>
      (c.trajectory_id === "R1" || c.trajectory_id === "R5") && c.arm_id === "v1"
  );
  const artifact = buildGptEvaluationArtifact({
    v1BaselineCaptures: v1Baseline,
    targetedCaptures: result.captures,
  });
  fs.writeFileSync(
    path.join(OUT_DIR, "gpt-evaluation-artifact.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );

  const report = [
    "# Targeted reconvergence pilot",
    "",
    `Status: ${result.status}`,
    `Planned: ${result.accounting.plannedLogicalSamples}`,
    `Successful: ${result.accounting.successfulProviderCalls}`,
    `Failed: ${result.accounting.failedProviderCalls}`,
    `Fallback: ${result.accounting.fallbackCalls}`,
    `Retry: ${result.accounting.retryCalls}`,
    `Auxiliary: ${result.accounting.auxiliaryCalls}`,
    `Upstream USD est.: ${result.totalUpstreamUsdEstimate?.toFixed(4) ?? "n/a"}`,
    "",
    "V1 baseline reused from pilot-result.json; V2/Living from targeted-pilot-result.json.",
    "GPT artifact: data/scene-policy-pilot/gpt-evaluation-artifact.json",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "targeted-pilot-execution-report.md"), report, "utf8");

  console.log("status", result.status);
  console.log("accounting", result.accounting);
  console.log("totalUpstreamUsd", result.totalUpstreamUsdEstimate);
  if (result.failureReason) console.log("failure", result.failureReason);

  if (result.status !== "TARGETED_PILOT_READY_FOR_GPT_EVALUATION") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
