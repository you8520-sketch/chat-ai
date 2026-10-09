/**
 * Isolated operator entrypoint for live paid-runner execution.
 * This process does NOT import the PRECALL egress guard.
 * Default path never grants cost approval and never calls runPaidRunner.
 * Sealed bodies are assembled in-process from canonical production rows after
 * grants + an independently observed RAILWAY_GIT_COMMIT_SHA. There is no
 * --sealed-pack-file path.
 */
import "./lib/rpQualityPaidRunnerAssemblyIsolation";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { RP_QUALITY_PRECALL_PLANNED_CALLS } from "@/lib/rpQualityPrecall";
import {
  RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerPublicManifest,
  type PaidRunnerSealedCall,
} from "@/lib/rpQualityPaidRunner";
import {
  livePaidRunnerUsesCanonicalModels,
  paidRunnerLiveExecuteEnabled,
  readPaidRunnerLiveInferenceKeys,
} from "@/lib/rpQualityPaidRunnerLiveTransport";
import { paidRunnerOriginalDataDir } from "./lib/rpQualityPaidRunnerAssemblyIsolation";
import {
  loadInProcessPaidRunnerPack,
  observePaidRunnerRuntimeSha,
} from "./lib/rpQualityPaidRunnerInProcessPack";
import { dispatchPaidRunnerLive } from "./lib/rpQualityPaidRunnerLiveDispatch";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function loadPublicManifest(): PaidRunnerPublicManifest | null {
  const raw = readArg("--manifest-json");
  if (!raw) return null;
  return JSON.parse(raw) as PaidRunnerPublicManifest;
}

async function main(): Promise<void> {
  const acceptPaidExecution = process.argv.includes("--accept-paid-execution");
  const liveExecuteEnabled = paidRunnerLiveExecuteEnabled();
  const authorization: PaidRunnerAuthorizationInput = {
    userCostApproved: process.argv.includes("--user-cost-approved"),
    approvedManifestFingerprint: readArg("--approved-manifest-fingerprint") ?? "",
    expectedProductionSha: readArg("--expected-production-sha") ?? "",
    expectedIdentityHash: readArg("--expected-identity-hash") ?? "",
    experimentSecret: process.env[RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV] ?? null,
    allowlist: [...MAIN_RP_MODEL_IDS],
    plannedCalls: RP_QUALITY_PRECALL_PLANNED_CALLS,
  };
  const actualRuntimeSha = observePaidRunnerRuntimeSha();
  let manifest = loadPublicManifest();
  let sealedCalls: PaidRunnerSealedCall[] | null = null;

  if (
    acceptPaidExecution &&
    liveExecuteEnabled &&
    authorization.userCostApproved &&
    actualRuntimeSha &&
    actualRuntimeSha === authorization.expectedProductionSha.trim().toLowerCase()
  ) {
    const loaded = loadInProcessPaidRunnerPack({
      runtimeSha: actualRuntimeSha,
      expectedProductionSha: authorization.expectedProductionSha,
      originalDataDir: paidRunnerOriginalDataDir,
      env: process.env,
    });
    if (loaded.ok) {
      manifest = loaded.pack.manifest;
      sealedCalls = loaded.pack.sealedCalls;
    }
  }

  const report = await dispatchPaidRunnerLive({
    acceptPaidExecution,
    liveExecuteEnabled,
    modelsCanonical: livePaidRunnerUsesCanonicalModels(MAIN_RP_MODEL_IDS),
    authorization,
    manifest,
    sealedCalls,
    keys: readPaidRunnerLiveInferenceKeys(),
    journalDir: readArg("--journal-dir"),
    artifactDir: readArg("--artifact-dir"),
    allowCreateLiveTransport: true,
    actualRuntimeSha,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 2;
}

void main();
