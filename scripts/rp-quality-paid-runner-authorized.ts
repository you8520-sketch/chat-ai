/**
 * Explicit operator entrypoint for authorized execution.
 * This PR evaluates gates only. Live transport is not shipped, so POST stays 0
 * even when every authorization field is present.
 */
import {
  MAIN_RP_MODEL_IDS,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  RP_QUALITY_PRECALL_PLANNED_CALLS,
} from "@/lib/rpQualityPrecall";
import {
  RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV,
  createLivePaidRunnerTransport,
  evaluatePaidRunnerAuthorization,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerPublicManifest,
} from "@/lib/rpQualityPaidRunner";

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

const manifest = loadManifest();
const authorization: PaidRunnerAuthorizationInput = {
  userCostApproved: process.argv.includes("--user-cost-approved"),
  approvedManifestFingerprint: readArg("--approved-manifest-fingerprint") ?? "",
  expectedProductionSha: readArg("--expected-production-sha") ?? "",
  expectedIdentityHash: readArg("--expected-identity-hash") ?? "",
  experimentSecret: process.env[RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV] ?? null,
  allowlist: [...MAIN_RP_MODEL_IDS] as SelectedAI[],
  plannedCalls: RP_QUALITY_PRECALL_PLANNED_CALLS,
};

let liveTransportError: string | null = null;
try {
  createLivePaidRunnerTransport();
} catch (error) {
  liveTransportError = error instanceof Error ? error.message : String(error);
}

const gate = manifest
  ? evaluatePaidRunnerAuthorization(manifest, authorization, "AUTHORIZED")
  : { authorized: false as const, reason: "MANIFEST_FINGERPRINT_MISMATCH" as const, providerPosts: 0 as const };

process.stdout.write(
  `${JSON.stringify(
    {
      ok: false,
      mode: "AUTHORIZED",
      authorized: gate.authorized,
      denialReason: gate.authorized ? liveTransportError : gate.reason,
      providerPosts: 0,
      networkAttempts: 0,
      dbWrites: 0,
      liveTransport: liveTransportError,
    },
    null,
    2
  )}\n`
);
