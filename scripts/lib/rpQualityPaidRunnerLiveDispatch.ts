/**
 * Operator wiring for the existing live CLI. Execution owner stays
 * runPaidRunner. This module never posts unless every grant is present and
 * a transport is either injected (tests) or explicitly created after those
 * grants. Public JSON never includes sealed request bodies.
 */
import {
  createFilePaidRunnerJournalStore,
  evaluatePaidRunnerAuthorization,
  experimentSecretUsesProductionKey,
  runPaidRunner,
  type PaidRunnerAuthorizationInput,
  type PaidRunnerDenialReason,
  type PaidRunnerJournalStore,
  type PaidRunnerPublicManifest,
  type PaidRunnerSealedCall,
  type PaidRunnerTransport,
} from "@/lib/rpQualityPaidRunner";
import { createFilePaidRunnerArtifactStore, type PaidRunnerArtifactStore } from "@/lib/rpQualityPaidRunnerArtifacts";
import {
  RP_QUALITY_PAID_LIVE_EXECUTE_ENV,
  assertPaidRunnerExperimentInferenceKeys,
  createIsolatedPaidRunnerLiveTransport,
} from "@/lib/rpQualityPaidRunnerLiveTransport";
import type { PaidRunnerReconcileKeys } from "@/lib/rpQualityPaidRunnerReconciliation";

export const PAID_RUNNER_LIVE_EXECUTION_OWNER = "runPaidRunner" as const;

export type PaidRunnerLiveDispatchReport = {
  ok: boolean;
  mode: "LIVE";
  authorized: boolean;
  denialReason: PaidRunnerDenialReason | null;
  providerPosts: number;
  transportPosts: number;
  networkTransmitted: number;
  dbWrites: 0;
  approvalStatus: "NOT_APPROVED";
  liveExecuteEnv: typeof RP_QUALITY_PAID_LIVE_EXECUTE_ENV;
  liveExecuteEnabled: boolean;
  acceptPaidExecution: boolean;
  modelsCanonical: boolean;
  sealedCallsPresent: boolean;
  sealedBodiesExported: false;
  unknownSingleCallCost: true;
  historicalPlanningNotBudget: true;
  productionKeyFallbackForbidden: true;
  executionOwner: typeof PAID_RUNNER_LIVE_EXECUTION_OWNER;
  providerInternalRetry: {
    clientPostRetry: 0;
    cheaperInference: string;
    openrouter: string;
  };
};

export type PaidRunnerLiveDispatchInput = {
  acceptPaidExecution?: boolean;
  liveExecuteEnabled: boolean;
  modelsCanonical: boolean;
  authorization: PaidRunnerAuthorizationInput;
  manifest: PaidRunnerPublicManifest | null;
  sealedCalls?: readonly PaidRunnerSealedCall[] | null;
  keys: { openRouterKey: string; cheaperInferenceKey: string };
  journalDir?: string;
  artifactDir?: string;
  journalStore?: PaidRunnerJournalStore;
  artifactStore?: PaidRunnerArtifactStore;
  transport?: PaidRunnerTransport;
  reconcile?: {
    fetchImpl: typeof fetch;
    keys: PaidRunnerReconcileKeys;
  };
  allowCreateLiveTransport?: boolean;
};

const PROVIDER_INTERNAL_RETRY = {
  clientPostRetry: 0 as const,
  cheaperInference:
    "provider may internally retry or fail over; 12 client POSTs do not guarantee 12 identical upstream inferences",
  openrouter: "served model is confirmed via generation metadata; client POST retry is 0",
};

function closedReport(
  input: PaidRunnerLiveDispatchInput,
  denialReason: PaidRunnerDenialReason | null,
  extra?: Partial<Pick<PaidRunnerLiveDispatchReport, "providerPosts" | "transportPosts" | "networkTransmitted" | "authorized" | "ok">>
): PaidRunnerLiveDispatchReport {
  return {
    ok: extra?.ok === true,
    mode: "LIVE",
    authorized: extra?.authorized === true,
    denialReason,
    providerPosts: extra?.providerPosts ?? 0,
    transportPosts: extra?.transportPosts ?? 0,
    networkTransmitted: extra?.networkTransmitted ?? 0,
    dbWrites: 0,
    approvalStatus: "NOT_APPROVED",
    liveExecuteEnv: RP_QUALITY_PAID_LIVE_EXECUTE_ENV,
    liveExecuteEnabled: input.liveExecuteEnabled,
    acceptPaidExecution: input.acceptPaidExecution === true,
    modelsCanonical: input.modelsCanonical,
    sealedCallsPresent: Boolean(input.sealedCalls && input.sealedCalls.length > 0),
    sealedBodiesExported: false,
    unknownSingleCallCost: true,
    historicalPlanningNotBudget: true,
    productionKeyFallbackForbidden: true,
    executionOwner: PAID_RUNNER_LIVE_EXECUTION_OWNER,
    providerInternalRetry: PROVIDER_INTERNAL_RETRY,
  };
}

function inferenceKeyDenial(
  keys: PaidRunnerLiveDispatchInput["keys"]
): PaidRunnerDenialReason | null {
  if (!keys.openRouterKey || !keys.cheaperInferenceKey) {
    return "MISSING_INFERENCE_KEY";
  }
  if (
    experimentSecretUsesProductionKey(keys.openRouterKey) ||
    experimentSecretUsesProductionKey(keys.cheaperInferenceKey)
  ) {
    return "PRODUCTION_KEY_FALLBACK_FORBIDDEN";
  }
  try {
    assertPaidRunnerExperimentInferenceKeys(keys);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "MISSING_INFERENCE_KEY" || message === "PRODUCTION_KEY_FALLBACK_FORBIDDEN") {
      return message;
    }
    return "MISSING_INFERENCE_KEY";
  }
  return null;
}

export async function dispatchPaidRunnerLive(
  input: PaidRunnerLiveDispatchInput
): Promise<PaidRunnerLiveDispatchReport> {
  if (experimentSecretUsesProductionKey(input.authorization.experimentSecret)) {
    return closedReport(input, "PRODUCTION_KEY_FALLBACK_FORBIDDEN");
  }
  if (!input.liveExecuteEnabled) {
    return closedReport(input, "LIVE_EXECUTE_NOT_APPROVED");
  }

  const gate = input.manifest
    ? evaluatePaidRunnerAuthorization(input.manifest, input.authorization, "AUTHORIZED")
    : { authorized: false as const, reason: "MANIFEST_FINGERPRINT_MISMATCH" as const, providerPosts: 0 as const };
  if (!gate.authorized) {
    return closedReport(input, gate.reason);
  }
  if (!input.modelsCanonical) {
    return closedReport(input, "MODEL_ALLOWLIST_MISMATCH");
  }

  const keyDenial = inferenceKeyDenial(input.keys);
  if (keyDenial) {
    return closedReport(input, keyDenial);
  }
  if (input.acceptPaidExecution !== true) {
    return closedReport(input, "LIVE_EXECUTE_NOT_APPROVED");
  }
  if (!input.manifest || !input.sealedCalls || input.sealedCalls.length === 0) {
    return closedReport(input, "SEAL_VALIDATION_FAILED");
  }

  let transport = input.transport;
  let liveExecuteApproved = false;
  if (!transport) {
    if (input.allowCreateLiveTransport !== true) {
      return closedReport(input, "LIVE_EXECUTE_NOT_APPROVED");
    }
    try {
      transport = createIsolatedPaidRunnerLiveTransport({
        openRouterKey: input.keys.openRouterKey,
        cheaperInferenceKey: input.keys.cheaperInferenceKey,
        liveExecuteApproved: true,
      });
      liveExecuteApproved = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "LIVE_EXECUTE_NOT_APPROVED" || message === "MISSING_INFERENCE_KEY" || message === "PRODUCTION_KEY_FALLBACK_FORBIDDEN") {
        return closedReport(input, message);
      }
      return closedReport(input, "LIVE_TRANSPORT_NOT_SHIPPED");
    }
  } else if (transport.kind === "live" && transport.simulation !== true) {
    liveExecuteApproved = true;
  }

  const journalStore =
    input.journalStore ??
    (input.journalDir ? createFilePaidRunnerJournalStore(input.journalDir) : undefined);
  const artifactStore =
    input.artifactStore ??
    (input.artifactDir ? createFilePaidRunnerArtifactStore(input.artifactDir) : undefined);
  const reconcile =
    input.reconcile ??
    (transport.kind === "live"
      ? { fetchImpl: fetch, keys: input.keys }
      : undefined);

  const result = await runPaidRunner({
    mode: "AUTHORIZED",
    manifest: input.manifest,
    sealedCalls: input.sealedCalls,
    authorization: input.authorization,
    transport,
    journalStore,
    artifactStore,
    liveExecuteApproved,
    reconcile,
  });

  const completed = result.authorized && result.denialReason === null;
  return closedReport(input, result.denialReason, {
    ok: completed,
    authorized: result.authorized,
    providerPosts: result.providerPosts,
    transportPosts: result.transportPosts,
    networkTransmitted: result.providerPosts,
  });
}
