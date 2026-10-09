/**
 * Operator wiring for the existing live CLI. Execution owner stays
 * runPaidRunner. This module never posts unless every grant is present and
 * a transport is either injected (tests) or explicitly created after those
 * grants. Public JSON never includes sealed request bodies.
 */
import { isFullGitSha } from "@/lib/rpQualityPrecall";
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
import {
  comparePaidRunnerPublicSeal,
  compareToPublished1466Seal,
  paidRunnerPublicSealFromManifest,
  type Published1466ComparableSeal,
} from "./rpQualityPaidRunnerPublished1466Seal";

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
  runtimeShaObserved: boolean;
  sealCompareVerdict: ReturnType<typeof compareToPublished1466Seal>["verdict"] | null;
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
  fetchImpl?: typeof fetch;
  actualRuntimeSha?: string | null;
  sealBaseline?: Published1466ComparableSeal;
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
  extra?: Partial<
    Pick<
      PaidRunnerLiveDispatchReport,
      "providerPosts" | "transportPosts" | "networkTransmitted" | "authorized" | "ok" | "sealCompareVerdict"
    >
  >
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
    runtimeShaObserved: isFullGitSha(input.actualRuntimeSha ?? ""),
    sealCompareVerdict: extra?.sealCompareVerdict ?? null,
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

function runtimeShaDenial(
  input: PaidRunnerLiveDispatchInput
): PaidRunnerDenialReason | null {
  const runtimeSha = input.actualRuntimeSha?.trim().toLowerCase() ?? "";
  if (!isFullGitSha(runtimeSha)) {
    return "RUNTIME_SHA_UNAVAILABLE";
  }
  const expected = input.authorization.expectedProductionSha.trim().toLowerCase();
  if (!isFullGitSha(expected) || expected !== runtimeSha) {
    return "RUNTIME_SHA_MISMATCH";
  }
  if (input.manifest && input.manifest.productionDeploySha.toLowerCase() !== runtimeSha) {
    return "RUNTIME_SHA_MISMATCH";
  }
  return null;
}

function fileStoreOrDenial(
  input: PaidRunnerLiveDispatchInput
):
  | { ok: true; journalStore?: PaidRunnerJournalStore; artifactStore?: PaidRunnerArtifactStore }
  | { ok: false; reason: PaidRunnerDenialReason } {
  try {
    const journalStore =
      input.journalStore ??
      (input.journalDir ? createFilePaidRunnerJournalStore(input.journalDir) : undefined);
    const artifactStore =
      input.artifactStore ??
      (input.artifactDir ? createFilePaidRunnerArtifactStore(input.artifactDir) : undefined);
    return { ok: true, journalStore, artifactStore };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ARTIFACT_STORE_UNAVAILABLE") {
      return { ok: false, reason: "ARTIFACT_STORE_UNAVAILABLE" };
    }
    return { ok: false, reason: "JOURNAL_STORE_UNAVAILABLE" };
  }
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
  if (input.authorization.userCostApproved !== true) {
    return closedReport(input, "MISSING_USER_COST_APPROVAL");
  }

  const shaDenial = runtimeShaDenial(input);
  if (shaDenial) {
    return closedReport(input, shaDenial);
  }

  const gate = input.manifest
    ? evaluatePaidRunnerAuthorization(input.manifest, input.authorization, "AUTHORIZED")
    : { authorized: false as const, reason: "MANIFEST_FINGERPRINT_MISMATCH" as const, providerPosts: 0 as const };
  if (!gate.authorized) {
    return closedReport(input, gate.reason);
  }
  if (!input.manifest || !input.sealedCalls || input.sealedCalls.length === 0) {
    return closedReport(input, "SEAL_VALIDATION_FAILED");
  }

  const currentSeal = paidRunnerPublicSealFromManifest(input.manifest);
  const compare = input.sealBaseline
    ? comparePaidRunnerPublicSeal(currentSeal, input.sealBaseline)
    : compareToPublished1466Seal(currentSeal);
  switch (compare.verdict) {
    case "MATCH":
    case "EXPECTED_DEPLOY_SHA_ROTATION":
      break;
    case "BODY_DRIFT":
      return closedReport(input, "BODY_DRIFT", { sealCompareVerdict: compare.verdict });
    case "UNEXPECTED_FINGERPRINT_ROTATION":
      return closedReport(input, "SEAL_VALIDATION_FAILED", { sealCompareVerdict: compare.verdict });
    default: {
      const _never: never = compare.verdict;
      return closedReport(input, "SEAL_VALIDATION_FAILED", { sealCompareVerdict: _never });
    }
  }

  const stores = fileStoreOrDenial(input);
  if (!stores.ok) {
    return closedReport(input, stores.reason, { sealCompareVerdict: compare.verdict });
  }

  let transport = input.transport;
  let liveExecuteApproved = false;
  if (!transport) {
    if (input.allowCreateLiveTransport !== true) {
      return closedReport(input, "LIVE_EXECUTE_NOT_APPROVED", { sealCompareVerdict: compare.verdict });
    }
    if (stores.journalStore?.kind !== "file") {
      return closedReport(input, "JOURNAL_STORE_UNAVAILABLE", { sealCompareVerdict: compare.verdict });
    }
    if (stores.artifactStore?.kind !== "file") {
      return closedReport(input, "ARTIFACT_STORE_UNAVAILABLE", { sealCompareVerdict: compare.verdict });
    }
    try {
      transport = createIsolatedPaidRunnerLiveTransport({
        openRouterKey: input.keys.openRouterKey,
        cheaperInferenceKey: input.keys.cheaperInferenceKey,
        liveExecuteApproved: true,
        fetchImpl: input.fetchImpl,
      });
      liveExecuteApproved = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "LIVE_EXECUTE_NOT_APPROVED" || message === "MISSING_INFERENCE_KEY" || message === "PRODUCTION_KEY_FALLBACK_FORBIDDEN") {
        return closedReport(input, message, { sealCompareVerdict: compare.verdict });
      }
      return closedReport(input, "LIVE_TRANSPORT_NOT_SHIPPED", { sealCompareVerdict: compare.verdict });
    }
  } else if (transport.kind === "live" && transport.simulation !== true) {
    liveExecuteApproved = true;
  }

  const reconcile =
    input.reconcile ??
    (transport.kind === "live"
      ? { fetchImpl: input.fetchImpl ?? fetch, keys: input.keys }
      : undefined);

  const result = await runPaidRunner({
    mode: "AUTHORIZED",
    manifest: input.manifest,
    sealedCalls: input.sealedCalls,
    authorization: input.authorization,
    transport,
    journalStore: stores.journalStore,
    artifactStore: stores.artifactStore,
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
    sealCompareVerdict: compare.verdict,
  });
}
