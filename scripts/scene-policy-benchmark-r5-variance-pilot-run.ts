/**
 * R5 × V2 repeated boundary variance pilot (small budget).
 *
 *   node --conditions=react-server --import tsx scripts/scene-policy-benchmark-r5-variance-pilot-run.ts
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  estimateR5VariancePilotCost,
  invokeBenchmarkProviderCall,
  R5_VARIANCE_DEFAULT_REPEAT,
  runR5VariancePilot,
} from "../src/lib/scenePolicyBenchmarkPilotRunner";
import { resolveBenchmarkCheaperInferenceApiKey } from "./lib/benchmarkCheaperInferenceCredential";

loadEnvLocal();

const OUT_DIR = path.join(process.cwd(), "data/scene-policy-pilot");
const PILOT_BASELINE_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const MAIN_SYNC_SHA = execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();

async function main() {
  const benchmarkKey = resolveBenchmarkCheaperInferenceApiKey();
  if (!benchmarkKey) {
    console.log("PILOT_STATUS=NOT_RUN — missing CHEAPER_INFERENCE_BENCHMARK_API_KEY");
    console.log("provider calls=0");
    process.exit(0);
  }

  const costPlan = estimateR5VariancePilotCost(R5_VARIANCE_DEFAULT_REPEAT);
  console.log("R5 variance cost plan", costPlan);
  console.log("PILOT_BASELINE_SHA", PILOT_BASELINE_SHA);

  const result = await runR5VariancePilot({
    pilotBaselineSha: PILOT_BASELINE_SHA,
    mainSyncSha: MAIN_SYNC_SHA,
    repeatCount: R5_VARIANCE_DEFAULT_REPEAT,
    invokeProvider: (input) =>
      invokeBenchmarkProviderCall({ ...input, cheaperInferenceApiKey: benchmarkKey }),
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "r5-variance-pilot-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );

  const summary = result.suspicionSummary ?? result.violationSummary;
  const report = [
    "# R5 boundary variance pilot",
    "",
    `Status: ${result.status}`,
    `Planned: ${result.accounting.plannedLogicalSamples}`,
    `Successful: ${result.accounting.successfulProviderCalls}`,
    `Estimated plan USD: ${costPlan.estimatedUpstreamUsd}`,
    `Actual upstream USD est.: ${result.totalUpstreamUsdEstimate?.toFixed(4) ?? "n/a"}`,
    "",
    summary
      ? [
          "## Lexical suspicion signals (triage only — not semantic scoring)",
          "",
          `- Samples: ${summary.totalSamples}`,
          `- Any suspicion signal: ${summary.samplesWithAnySuspicionSignal}`,
          `- physical_revisit: ${summary.suspicionSignalCounts.physical_revisit}`,
          `- remote_contact: ${summary.suspicionSignalCounts.remote_contact}`,
          `- gift_drop_off: ${summary.suspicionSignalCounts.gift_drop_off}`,
          `- future_meeting_request: ${summary.suspicionSignalCounts.future_meeting_request}`,
          `- boundary_clarification: ${summary.suspicionSignalCounts.boundary_clarification}`,
          `- relationship_closure_demand: ${summary.suspicionSignalCounts.relationship_closure_demand}`,
          "",
        ].join("\n")
      : "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "r5-variance-pilot-report.md"), report, "utf8");

  console.log("status", result.status);
  console.log("accounting", result.accounting);
  if (summary) console.log("suspicionSignals", summary);

  if (result.status !== "R5_VARIANCE_PILOT_COMPLETE") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
