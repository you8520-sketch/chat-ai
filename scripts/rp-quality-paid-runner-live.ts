/**
 * Isolated operator entrypoint for live paid-runner execution.
 * This process does NOT import the PRECALL egress guard.
 * Default path never grants cost approval and never calls runPaidRunner.
 * Sealed request bodies stay in-process via --sealed-pack-file; public
 * --manifest-json alone cannot POST.
 */
import { readFileSync } from "node:fs";

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
import { dispatchPaidRunnerLive } from "./lib/rpQualityPaidRunnerLiveDispatch";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function loadManifest(): PaidRunnerPublicManifest | null {
  const raw = readArg("--manifest-json");
  if (!raw) return null;
  return JSON.parse(raw) as PaidRunnerPublicManifest;
}

function loadSealedPack(): {
  manifest: PaidRunnerPublicManifest;
  sealedCalls: PaidRunnerSealedCall[];
} | null {
  const file = readArg("--sealed-pack-file");
  if (!file) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    manifest?: PaidRunnerPublicManifest;
    sealedCalls?: PaidRunnerSealedCall[];
  };
  if (!parsed.manifest || !Array.isArray(parsed.sealedCalls)) return null;
  return { manifest: parsed.manifest, sealedCalls: parsed.sealedCalls };
}

async function main(): Promise<void> {
  const sealedPack = loadSealedPack();
  const authorization: PaidRunnerAuthorizationInput = {
    userCostApproved: process.argv.includes("--user-cost-approved"),
    approvedManifestFingerprint: readArg("--approved-manifest-fingerprint") ?? "",
    expectedProductionSha: readArg("--expected-production-sha") ?? "",
    expectedIdentityHash: readArg("--expected-identity-hash") ?? "",
    experimentSecret: process.env[RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV] ?? null,
    allowlist: [...MAIN_RP_MODEL_IDS],
    plannedCalls: RP_QUALITY_PRECALL_PLANNED_CALLS,
  };
  const report = await dispatchPaidRunnerLive({
    acceptPaidExecution: process.argv.includes("--accept-paid-execution"),
    liveExecuteEnabled: paidRunnerLiveExecuteEnabled(),
    modelsCanonical: livePaidRunnerUsesCanonicalModels(MAIN_RP_MODEL_IDS),
    authorization,
    manifest: sealedPack?.manifest ?? loadManifest(),
    sealedCalls: sealedPack?.sealedCalls ?? null,
    keys: readPaidRunnerLiveInferenceKeys(),
    journalDir: readArg("--journal-dir"),
    artifactDir: readArg("--artifact-dir"),
    allowCreateLiveTransport: true,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 2;
}

void main();
