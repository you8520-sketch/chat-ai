/**
 * Execute MINIMAL 26-call scene policy provider pilot.
 * Requires CHEAPER_INFERENCE_API_KEY. No billing, DB, retry, or fallback.
 *
 *   node --conditions=react-server --import tsx scripts/scene-policy-benchmark-pilot-run.ts
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  assertMinimalPlanExpected,
  buildPilotBlindArtifacts,
  deriveMinimalPilotSamples,
  runMinimalScenePolicyPilot,
} from "../src/lib/scenePolicyBenchmarkPilotRunner";

loadEnvLocal();

const OUT_DIR = path.join(process.cwd(), "data/scene-policy-pilot");
const PILOT_BASELINE_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const MAIN_SYNC_SHA = execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();

async function main() {
  const plan = assertMinimalPlanExpected();
  const samples = deriveMinimalPilotSamples();
  console.log("PILOT_BASELINE_SHA", PILOT_BASELINE_SHA);
  console.log("MAIN_SYNC_SHA", MAIN_SYNC_SHA);
  console.log("plan", plan);
  console.log("samples", samples.length);

  const result = await runMinimalScenePolicyPilot({
    pilotBaselineSha: PILOT_BASELINE_SHA,
    mainSyncSha: MAIN_SYNC_SHA,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "pilot-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );

  if (result.status === "PILOT_COMPLETE_READY_FOR_BLIND_EVALUATION") {
    const { blindSamples, answerKey } = buildPilotBlindArtifacts({
      captures: result.captures,
    });
    fs.writeFileSync(
      path.join(OUT_DIR, "blind-samples.json"),
      `${JSON.stringify(blindSamples, null, 2)}\n`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(OUT_DIR, "answer-key.json"),
      `${JSON.stringify(answerKey, null, 2)}\n`,
      "utf8"
    );
  }

  console.log("status", result.status);
  console.log("accounting", result.accounting);
  console.log("totalUpstreamUsd", result.totalUpstreamUsdEstimate);
  if (result.failureReason) console.log("failure", result.failureReason);

  if (result.status !== "PILOT_COMPLETE_READY_FOR_BLIND_EVALUATION") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
