/**
 * Isolated operator entrypoint for live paid-runner execution.
 * This process does NOT import the PRECALL egress guard.
 * Default path never grants cost approval, never loads the assembler, and
 * never calls runPaidRunner. Sealed bodies are assembled in-process from
 * canonical production rows only after grants + an independently observed
 * RAILWAY_GIT_COMMIT_SHA. There is no --sealed-pack-file path.
 */
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
import { resolveCanonicalProductionDbPath } from "./lib/rpQualityPaidRunnerCanonicalDb";
import { observePaidRunnerRuntimeSha } from "./lib/rpQualityPaidRunnerRuntimeSha";
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

async function loadCanonicalSealedPack(input: {
  runtimeSha: string;
  expectedProductionSha: string;
}): Promise<{
  manifest: PaidRunnerPublicManifest;
  sealedCalls: PaidRunnerSealedCall[];
} | null> {
  const originalDataDir = process.env.DATA_DIR ?? "";
  if (!resolveCanonicalProductionDbPath(originalDataDir)) {
    return null;
  }
  // Deferred on purpose: assembler/getDb must not load (or write stdout) until
  // grants exist and the canonical DB path is real. Isolation has to evaluate
  // before the pack loader.
  await import("./lib/rpQualityPaidRunnerAssemblyIsolation");
  const { loadInProcessPaidRunnerPack } = await import("./lib/rpQualityPaidRunnerInProcessPack");
  const loaded = loadInProcessPaidRunnerPack({
    runtimeSha: input.runtimeSha,
    expectedProductionSha: input.expectedProductionSha,
    originalDataDir,
    env: process.env,
  });
  if (!loaded.ok) return null;
  return { manifest: loaded.pack.manifest, sealedCalls: loaded.pack.sealedCalls };
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
    const loaded = await loadCanonicalSealedPack({
      runtimeSha: actualRuntimeSha,
      expectedProductionSha: authorization.expectedProductionSha,
    });
    if (loaded) {
      manifest = loaded.manifest;
      sealedCalls = loaded.sealedCalls;
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
