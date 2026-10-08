/**
 * Isolated operator entrypoint for live paid-runner execution.
 * This process does NOT import the PRECALL egress guard.
 * This PR never grants cost approval and never sets RP_QUALITY_PAID_LIVE_EXECUTE,
 * so it evaluates gates and stops before any provider POST.
 */
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { RP_QUALITY_PRECALL_PLANNED_CALLS } from "@/lib/rpQualityPrecall";
import {
  RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV,
  evaluatePaidRunnerAuthorization,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerPublicManifest,
} from "@/lib/rpQualityPaidRunner";
import {
  RP_QUALITY_PAID_LIVE_EXECUTE_ENV,
  livePaidRunnerUsesCanonicalModels,
  paidRunnerLiveExecuteEnabled,
  readPaidRunnerLiveInferenceKeys,
} from "@/lib/rpQualityPaidRunnerLiveTransport";

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
const keys = readPaidRunnerLiveInferenceKeys();
const authorization: PaidRunnerAuthorizationInput = {
  userCostApproved: process.argv.includes("--user-cost-approved"),
  approvedManifestFingerprint: readArg("--approved-manifest-fingerprint") ?? "",
  expectedProductionSha: readArg("--expected-production-sha") ?? "",
  expectedIdentityHash: readArg("--expected-identity-hash") ?? "",
  experimentSecret: process.env[RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV] ?? null,
  allowlist: [...MAIN_RP_MODEL_IDS],
  plannedCalls: RP_QUALITY_PRECALL_PLANNED_CALLS,
};

const gate = manifest
  ? evaluatePaidRunnerAuthorization(manifest, authorization, "AUTHORIZED")
  : { authorized: false as const, reason: "MANIFEST_FINGERPRINT_MISMATCH" as const, providerPosts: 0 as const };

const executeEnabled = paidRunnerLiveExecuteEnabled();
const modelsCanonical = livePaidRunnerUsesCanonicalModels(MAIN_RP_MODEL_IDS);
const denialReason = !executeEnabled
  ? "LIVE_EXECUTE_NOT_APPROVED"
  : !gate.authorized
    ? gate.reason
    : !modelsCanonical
      ? "MODEL_ALLOWLIST_MISMATCH"
      : !keys.openRouterKey || !keys.cheaperInferenceKey
        ? "MISSING_INFERENCE_KEY"
        : "LIVE_EXECUTE_NOT_APPROVED";

process.stdout.write(
  `${JSON.stringify(
    {
      ok: false,
      mode: "LIVE",
      authorized: false,
      denialReason,
      providerPosts: 0,
      networkTransmitted: 0,
      dbWrites: 0,
      approvalStatus: "NOT_APPROVED",
      liveExecuteEnv: RP_QUALITY_PAID_LIVE_EXECUTE_ENV,
      liveExecuteEnabled: executeEnabled,
      modelsCanonical,
      unknownSingleCallCost: true,
      historicalPlanningNotBudget: true,
      providerInternalRetry: {
        clientPostRetry: 0,
        cheaperInference:
          "provider may internally retry or fail over; 12 client POSTs do not guarantee 12 identical upstream inferences",
        openrouter: "served model is confirmed via generation metadata; client POST retry is 0",
      },
    },
    null,
    2
  )}\n`
);
process.exitCode = 2;
