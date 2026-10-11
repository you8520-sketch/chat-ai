/**
 * Paid 12-call Main RP quality runner owner. Prepare/dry-run is the default.
 * This file never opens sockets, never reads production provider keys, and
 * never fills rubric scores. Isolated live transport lives in a separate
 * module and a separate operator process; this PR does not grant cost approval.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  MAIN_RP_MODEL_IDS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpPrimaryWireModelId,
} from "@/lib/openRouterConfig";
import { resolveOpenRouterMaxTokens } from "@/lib/openRouterClient";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import { readCompatibleCompletionProviderRequestId } from "@/lib/openRouterCompletion";
import {
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_HISTORICAL_ROW_POINTER,
  RP_QUALITY_PRECALL_MUTATION_POLICY,
  RP_QUALITY_PRECALL_PLANNED_CALLS,
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  computeRpQualityPrecallCostPlanning,
  rpQualityPrecallBenchmarkModels,
  type RpQualityPrecallCostPlanning,
  type RpQualityPrecallFixtureId,
  type RpQualityPrecallFxSnapshotRow,
  type RpQualityPrecallSizeRow,
} from "@/lib/rpQualityPrecall";
import {
  buildQualityOutputPacket,
  emptyRubricScores,
  type RpQualityOutputPacket,
} from "@/lib/rpQualityEvaluationPacket";
import { UNIFIED_TIER_AIM_CHARS } from "@/lib/responseLengthConstants";
import { DEFAULT_USER_AUTHORING_LEVEL } from "@/lib/userAuthoringPolicy";
import {
  createMemoryPaidRunnerArtifactStore,
  paidRunnerArtifactFingerprint,
  type PaidRunnerArtifactStore,
} from "@/lib/rpQualityPaidRunnerArtifacts";
import {
  reconcilePaidRunnerSettlement,
  reconcilePaidRunnerUnknownJournalEntry,
  type PaidRunnerReconcileKeys,
} from "@/lib/rpQualityPaidRunnerReconciliation";

export const RP_QUALITY_PAID_RUNNER_VERSION = 1;
export const RP_QUALITY_PAID_RUNNER_DEFAULT_MODE = "PREPARE" as const;
export const RP_QUALITY_PAID_EXPERIMENT_SECRET_ENV = "RP_QUALITY_PAID_EXPERIMENT_SECRET";
export const RP_QUALITY_PAID_EXPERIMENT_SECRET_RE = /^rpq-paid-[A-Za-z0-9_-]{24,}$/;
export const RP_QUALITY_PAID_PRODUCTION_KEY_ENVS = [
  "CHEAPER_INFERENCE_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "CHEAPER_INFERENCE_BENCHMARK_API_KEY",
] as const;

export type PaidRunnerMode = "PREPARE" | "AUTHORIZED";

export type PaidRunnerDenialReason =
  | "PREPARE_MODE_DOES_NOT_POST"
  | "MISSING_USER_COST_APPROVAL"
  | "MISSING_EXPERIMENT_SECRET"
  | "MALFORMED_EXPERIMENT_SECRET"
  | "PRODUCTION_KEY_FALLBACK_FORBIDDEN"
  | "MANIFEST_FINGERPRINT_MISMATCH"
  | "PRODUCTION_SHA_MISMATCH"
  | "IDENTITY_HASH_MISMATCH"
  | "MODEL_ALLOWLIST_MISMATCH"
  | "PROVIDER_MAPPING_MISMATCH"
  | "PLANNED_CALL_COUNT_MISMATCH"
  | "THIRTEENTH_CALL_FORBIDDEN"
  | "DUPLICATE_MANIFEST_EXECUTION"
  | "FIXTURE_MODEL_REPLAY"
  | "PRIOR_CALL_UNRESOLVED"
  | "COST_EVIDENCE_MISSING"
  | "LIVE_TRANSPORT_NOT_SHIPPED"
  | "APPROVAL_STATUS_NOT_APPROVED"
  | "JOURNAL_FINGERPRINT_MISMATCH"
  | "JOURNAL_STORE_UNAVAILABLE"
  | "CONCURRENT_LAUNCH"
  | "SEAL_VALIDATION_FAILED"
  | "ARTIFACT_STORE_UNAVAILABLE"
  | "RECONCILIATION_FAILED"
  | "LIVE_EXECUTE_NOT_APPROVED"
  | "CORRUPT_JOURNAL"
  | "MISSING_INFERENCE_KEY"
  | "RUNTIME_SHA_UNAVAILABLE"
  | "RUNTIME_SHA_MISMATCH"
  | "BODY_DRIFT";

export type PaidRunnerIdentityHashes = {
  greetingSha256: string;
  systemPromptSha256: string;
  worldSha256: string;
  settingChunksSha256: string;
  personaPublicSha256: string;
};

export type PaidRunnerPublicCall = {
  requestOrder: number;
  fixtureId: RpQualityPrecallFixtureId;
  canonicalId: SelectedAI;
  provider: "openrouter" | "cheaperinference";
  wireModel: string;
  endpointKind: "openrouter" | "cheaperinference";
  finalWireFingerprint: string;
  requestBodyFingerprint: string;
  effectiveCanonMode: string;
  authoringLevel: "NORMAL";
  contentMode: "SAFE";
  maxTokensPresent: false;
};

export type PaidRunnerPublicManifest = {
  version: typeof RP_QUALITY_PAID_RUNNER_VERSION;
  mode: PaidRunnerMode;
  mainSha: string;
  productionDeploySha: string;
  characterId: 18;
  personaName: "렌";
  identityHashes: PaidRunnerIdentityHashes;
  identityHash: string;
  calls: readonly PaidRunnerPublicCall[];
  approvalStatus: "NOT_APPROVED";
  providerPosts: 0;
  pricingSnapshotProvenance: "publishedModelPricing.getPublishedPricing";
  unknownSingleCallCost: true;
  manifestFingerprint: string;
};

export type PaidRunnerSealedCall = PaidRunnerPublicCall & {
  endpoint: string;
  requestBody: Record<string, unknown>;
};

export type PaidRunnerAuthorizationInput = {
  userCostApproved: boolean;
  approvedManifestFingerprint: string;
  expectedProductionSha: string;
  expectedIdentityHash: string;
  experimentSecret: string | null | undefined;
  allowlist: readonly SelectedAI[];
  plannedCalls: number;
};

export type PaidRunnerAuthorization =
  | { authorized: false; reason: PaidRunnerDenialReason; providerPosts: 0 }
  | { authorized: true; providerPosts: 0 };

export type PaidRunnerJournalStatus =
  | "PREPARED"
  | "SENT"
  | "SETTLED"
  | "UNKNOWN_UNRESOLVED"
  | "FAILED"
  | "BLOCKED";

export type PaidRunnerJournalEntry = {
  requestOrder: number;
  fixtureId: RpQualityPrecallFixtureId;
  canonicalId: SelectedAI;
  finalWireFingerprint: string;
  requestBodyFingerprint: string;
  status: PaidRunnerJournalStatus;
  providerRequestId: string | null;
  httpResult: number | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  billedUsd: number | null;
  settlementSource: "provider_exact" | "mock_exact" | "estimate_not_bill" | "missing" | "unsettled";
  visibleChars: number | null;
  elapsedMs: number | null;
  blockReason: PaidRunnerDenialReason | null;
  artifactFingerprint?: string | null;
  generationId?: string | null;
  outputAvailability?: "persisted" | "unavailable";
};

export type PaidRunnerJournal = {
  manifestFingerprint: string;
  identityHash?: string;
  experimentContinuityFingerprint?: string;
  entries: PaidRunnerJournalEntry[];
  executedManifestFingerprints: string[];
};

export type PaidRunnerJournalContinuity =
  | "exact_fingerprint"
  | "sha_only_rotation"
  | "body_or_identity_drift"
  | "unrelated";

export type PaidRunnerJournalDiscovery = {
  continuityFingerprint: string;
  identityHash: string;
  calls: readonly Pick<
    PaidRunnerPublicCall,
    | "requestOrder"
    | "fixtureId"
    | "canonicalId"
    | "requestBodyFingerprint"
    | "finalWireFingerprint"
  >[];
};

export type PaidRunnerUsageEvidence = {
  fixtureId: RpQualityPrecallFixtureId;
  canonicalId: SelectedAI;
  provider: "openrouter" | "cheaperinference";
  wireModel: string;
  providerRequestId: string | null;
  httpResult: number | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  billedUsd: number | null;
  settlementSource: PaidRunnerJournalEntry["settlementSource"];
  visibleChars: number | null;
  elapsedMs: number | null;
  finalWireFingerprint: string;
};

export type PaidRunnerTransportKind = "mock" | "live";

export type PaidRunnerTransportSuccess = {
  ok: true;
  httpStatus: number;
  text: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    billedUsd: number | null;
  };
  requestId: string;
  headers: Record<string, string>;
  body: unknown;
  generationId?: string | null;
  cheaperInference?: unknown;
  doneObserved?: boolean;
  streamCompleted?: boolean;
  contentType?: string;
};

export type PaidRunnerTransportFailure = {
  ok: false;
  kind: "timeout" | "malformed" | "partial_stream" | "http" | "throw" | "connection_reset";
  httpStatus: number | null;
  text: string;
  headers: Record<string, string>;
  body: unknown;
  contentType?: string;
};

export type PaidRunnerTransportResult = PaidRunnerTransportSuccess | PaidRunnerTransportFailure;

export type PaidRunnerTransport = {
  kind: PaidRunnerTransportKind;
  realNetwork?: boolean;
  /** Explicit test-only simulated live contract. Absence means live dispatch gates apply. */
  simulation?: boolean;
  post(input: {
    endpoint: string;
    body: Record<string, unknown>;
    canonicalId: SelectedAI;
    provider: "openrouter" | "cheaperinference";
  }): Promise<PaidRunnerTransportResult>;
};

export type PaidRunnerPublicResult = {
  requestOrder: number;
  fixtureId: RpQualityPrecallFixtureId;
  status: PaidRunnerJournalStatus;
  visibleChars: number | null;
  finishReason: string | null;
  finalWireFingerprint: string;
  scores: ReturnType<typeof emptyRubricScores>;
};

export type PaidRunnerPrivateResult = {
  requestOrder: number;
  reveal: { canonicalId: SelectedAI; provider: string; wireModel: string };
  packet: RpQualityOutputPacket;
  usage: PaidRunnerUsageEvidence;
};

export type PaidRunnerRunResult = {
  mode: PaidRunnerMode;
  authorized: boolean;
  denialReason: PaidRunnerDenialReason | null;
  providerPosts: number;
  transportPosts: number;
  networkAttempts: number;
  dbWrites: 0;
  journal: PaidRunnerJournal;
  publicResults: PaidRunnerPublicResult[];
  privateResults: PaidRunnerPrivateResult[];
  publicMetadataSafe: boolean;
};

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function deny(reason: PaidRunnerDenialReason): Extract<PaidRunnerAuthorization, { authorized: false }> {
  return { authorized: false, reason, providerPosts: 0 };
}

export function paidRunnerIdentityHash(hashes: PaidRunnerIdentityHashes): string {
  return sha256Json(hashes);
}

export function paidRunnerManifestFingerprint(
  manifest: Omit<PaidRunnerPublicManifest, "manifestFingerprint" | "providerPosts">
): string {
  return sha256Json({
    version: manifest.version,
    mainSha: manifest.mainSha,
    productionDeploySha: manifest.productionDeploySha,
    characterId: manifest.characterId,
    personaName: manifest.personaName,
    identityHash: manifest.identityHash,
    calls: manifest.calls.map((call) => ({
      requestOrder: call.requestOrder,
      fixtureId: call.fixtureId,
      canonicalId: call.canonicalId,
      provider: call.provider,
      wireModel: call.wireModel,
      finalWireFingerprint: call.finalWireFingerprint,
      requestBodyFingerprint: call.requestBodyFingerprint,
    })),
  });
}

export function paidRunnerExperimentContinuityFingerprint(
  manifest: Pick<PaidRunnerPublicManifest, "version" | "characterId" | "personaName" | "identityHash" | "calls">
): string {
  return sha256Json({
    version: manifest.version,
    characterId: manifest.characterId,
    personaName: manifest.personaName,
    identityHash: manifest.identityHash,
    calls: manifest.calls.map((call) => ({
      requestOrder: call.requestOrder,
      fixtureId: call.fixtureId,
      canonicalId: call.canonicalId,
      provider: call.provider,
      wireModel: call.wireModel,
      finalWireFingerprint: call.finalWireFingerprint,
      requestBodyFingerprint: call.requestBodyFingerprint,
    })),
  });
}

export function classifyPaidRunnerJournalContinuity(
  journal: PaidRunnerJournal,
  discovery: PaidRunnerJournalDiscovery,
  manifestFingerprint: string
): PaidRunnerJournalContinuity {
  if (journal.identityHash && journal.identityHash !== discovery.identityHash) {
    return "body_or_identity_drift";
  }
  if (
    journal.experimentContinuityFingerprint &&
    journal.experimentContinuityFingerprint !== discovery.continuityFingerprint
  ) {
    return "body_or_identity_drift";
  }
  const expected = new Map(
    discovery.calls.map((call) => [call.requestOrder, call] as const)
  );
  let compared = 0;
  for (const entry of journal.entries) {
    const call = expected.get(entry.requestOrder);
    if (!call) {
      return journal.manifestFingerprint === manifestFingerprint
        ? "body_or_identity_drift"
        : "unrelated";
    }
    if (entry.fixtureId !== call.fixtureId || entry.canonicalId !== call.canonicalId) {
      return journal.manifestFingerprint === manifestFingerprint
        ? "body_or_identity_drift"
        : "unrelated";
    }
    if (!entry.requestBodyFingerprint || !entry.finalWireFingerprint) {
      return "body_or_identity_drift";
    }
    if (
      entry.requestBodyFingerprint !== call.requestBodyFingerprint ||
      entry.finalWireFingerprint !== call.finalWireFingerprint
    ) {
      return "body_or_identity_drift";
    }
    compared += 1;
  }
  if (journal.manifestFingerprint === manifestFingerprint) return "exact_fingerprint";
  if (compared === 0) return "unrelated";
  if (
    journal.experimentContinuityFingerprint === discovery.continuityFingerprint ||
    compared === discovery.calls.length
  ) {
    return "sha_only_rotation";
  }
  return "unrelated";
}

export function paidRunnerRequestBodyFingerprint(body: Record<string, unknown>): string {
  return sha256Json(body);
}

export function paidRunnerManifestDraft(
  manifest: PaidRunnerPublicManifest
): Omit<PaidRunnerPublicManifest, "manifestFingerprint" | "providerPosts"> {
  const { manifestFingerprint: _fingerprint, providerPosts: _posts, ...draft } = manifest;
  return draft;
}

export function paidRunnerEndpointMatchesCanonicalOwner(
  provider: "openrouter" | "cheaperinference",
  endpoint: string
): boolean {
  switch (provider) {
    case "openrouter":
      return endpoint === OPENROUTER_CHAT_COMPLETIONS_URL;
    case "cheaperinference": {
      if (endpoint === CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL) return true;
      try {
        const actual = new URL(endpoint);
        const canonical = new URL(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
        if (actual.origin !== canonical.origin || actual.pathname !== canonical.pathname) {
          return false;
        }
        for (const key of actual.searchParams.keys()) {
          if (key !== "x-ci-prompt-cache-scope" && key !== "x-ci-prompt-cache-session") {
            return false;
          }
        }
        return true;
      } catch {
        return false;
      }
    }
    default: {
      const _never: never = provider;
      return _never;
    }
  }
}

export function verifyPaidRunnerDispatchSeal(input: {
  manifest: PaidRunnerPublicManifest;
  sealedCalls: readonly PaidRunnerSealedCall[];
}): { ok: true } | { ok: false; reason: PaidRunnerDenialReason } {
  const { manifest, sealedCalls } = input;
  if (paidRunnerIdentityHash(manifest.identityHashes) !== manifest.identityHash) {
    return { ok: false, reason: "IDENTITY_HASH_MISMATCH" };
  }
  if (paidRunnerManifestFingerprint(paidRunnerManifestDraft(manifest)) !== manifest.manifestFingerprint) {
    return { ok: false, reason: "MANIFEST_FINGERPRINT_MISMATCH" };
  }
  if (manifest.calls.length !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    return { ok: false, reason: "PLANNED_CALL_COUNT_MISMATCH" };
  }
  if (sealedCalls.length > RP_QUALITY_PRECALL_PLANNED_CALLS) {
    return { ok: false, reason: "THIRTEENTH_CALL_FORBIDDEN" };
  }
  if (sealedCalls.length !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
  }

  const expectedPairs: Array<{ fixtureId: RpQualityPrecallFixtureId; canonicalId: SelectedAI }> = [];
  for (const fixtureId of RP_QUALITY_PRECALL_FIXTURE_IDS) {
    for (const canonicalId of MAIN_RP_MODEL_IDS) {
      expectedPairs.push({ fixtureId, canonicalId });
    }
  }
  const seen = new Set<string>();
  for (let index = 0; index < RP_QUALITY_PRECALL_PLANNED_CALLS; index += 1) {
    const sealed = sealedCalls[index];
    const publicCall = manifest.calls[index];
    const expected = expectedPairs[index];
    if (!sealed || !publicCall || !expected) {
      return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
    }
    if (sealed.requestOrder !== index + 1 || publicCall.requestOrder !== index + 1) {
      return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
    }
    if (
      sealed.fixtureId !== expected.fixtureId ||
      publicCall.fixtureId !== expected.fixtureId ||
      sealed.canonicalId !== expected.canonicalId ||
      publicCall.canonicalId !== expected.canonicalId
    ) {
      return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
    }
    const pairKey = `${sealed.fixtureId}:${sealed.canonicalId}`;
    if (seen.has(pairKey)) return { ok: false, reason: "FIXTURE_MODEL_REPLAY" };
    seen.add(pairKey);
    let provider: "openrouter" | "cheaperinference";
    try {
      provider = expectedPaidRunnerProvider(sealed.canonicalId);
    } catch {
      return { ok: false, reason: "PROVIDER_MAPPING_MISMATCH" };
    }
    const wireModel = expectedPaidRunnerWireModel(sealed.canonicalId);
    if (
      sealed.provider !== provider ||
      publicCall.provider !== provider ||
      sealed.wireModel !== wireModel ||
      publicCall.wireModel !== wireModel ||
      sealed.endpointKind !== provider ||
      publicCall.endpointKind !== provider
    ) {
      return { ok: false, reason: "PROVIDER_MAPPING_MISMATCH" };
    }
    if (!paidRunnerEndpointMatchesCanonicalOwner(provider, sealed.endpoint)) {
      return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
    }
    if (
      "max_tokens" in sealed.requestBody ||
      "max_completion_tokens" in sealed.requestBody ||
      sealed.maxTokensPresent !== false ||
      publicCall.maxTokensPresent !== false
    ) {
      return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
    }
    if (typeof sealed.requestBody.model === "string" && sealed.requestBody.model !== wireModel) {
      return { ok: false, reason: "PROVIDER_MAPPING_MISMATCH" };
    }
    const bodyFingerprint = paidRunnerRequestBodyFingerprint(sealed.requestBody);
    if (
      bodyFingerprint !== sealed.requestBodyFingerprint ||
      bodyFingerprint !== publicCall.requestBodyFingerprint
    ) {
      return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
    }
    if (sealed.finalWireFingerprint !== publicCall.finalWireFingerprint) {
      return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
    }
  }
  return { ok: true };
}

export function assertCurrentMainRpPaidAllowlist(allowlist: readonly string[]): void {
  if (JSON.stringify([...allowlist]) !== JSON.stringify([...MAIN_RP_MODEL_IDS])) {
    throw new Error("PAID_RUNNER_MODEL_REGISTRY_DRIFT");
  }
}

export function expectedPaidRunnerProvider(canonicalId: SelectedAI): "openrouter" | "cheaperinference" {
  const provider = selectedAIProvider(canonicalId);
  if (provider !== "openrouter" && provider !== "cheaperinference") {
    throw new Error("PAID_RUNNER_UNSUPPORTED_PROVIDER");
  }
  return provider;
}

export function expectedPaidRunnerWireModel(canonicalId: SelectedAI): string {
  return resolveMainRpPrimaryWireModelId(canonicalId);
}

export function isWellFormedPaidExperimentSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && RP_QUALITY_PAID_EXPERIMENT_SECRET_RE.test(value);
}

export function experimentSecretUsesProductionKey(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!value) return false;
  return RP_QUALITY_PAID_PRODUCTION_KEY_ENVS.some((key) => {
    const production = env[key]?.trim();
    return Boolean(production) && production === value;
  });
}

export function evaluatePaidRunnerAuthorizationPrerequisites(
  input: PaidRunnerAuthorizationInput,
  mode: PaidRunnerMode
): PaidRunnerAuthorization {
  if (mode === "PREPARE") return deny("PREPARE_MODE_DOES_NOT_POST");
  if (input.userCostApproved !== true) return deny("MISSING_USER_COST_APPROVAL");
  if (!input.experimentSecret) return deny("MISSING_EXPERIMENT_SECRET");
  if (experimentSecretUsesProductionKey(input.experimentSecret)) {
    return deny("PRODUCTION_KEY_FALLBACK_FORBIDDEN");
  }
  if (!isWellFormedPaidExperimentSecret(input.experimentSecret)) {
    return deny("MALFORMED_EXPERIMENT_SECRET");
  }
  if (input.plannedCalls !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    return deny("PLANNED_CALL_COUNT_MISMATCH");
  }
  try {
    assertCurrentMainRpPaidAllowlist(input.allowlist);
  } catch {
    return deny("MODEL_ALLOWLIST_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/.test(input.approvedManifestFingerprint.trim())) {
    return deny("MANIFEST_FINGERPRINT_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/.test(input.expectedIdentityHash.trim())) {
    return deny("IDENTITY_HASH_MISMATCH");
  }
  if (!input.expectedProductionSha.trim()) {
    return deny("PRODUCTION_SHA_MISMATCH");
  }
  return { authorized: true, providerPosts: 0 };
}

export function evaluatePaidRunnerAuthorization(
  manifest: PaidRunnerPublicManifest,
  input: PaidRunnerAuthorizationInput,
  mode: PaidRunnerMode
): PaidRunnerAuthorization {
  const prerequisites = evaluatePaidRunnerAuthorizationPrerequisites(input, mode);
  if (!prerequisites.authorized) return prerequisites;
  if (manifest.approvalStatus !== "NOT_APPROVED") return deny("APPROVAL_STATUS_NOT_APPROVED");
  const recomputedIdentity = paidRunnerIdentityHash(manifest.identityHashes);
  if (recomputedIdentity !== manifest.identityHash || recomputedIdentity !== input.expectedIdentityHash) {
    return deny("IDENTITY_HASH_MISMATCH");
  }
  const recomputedManifest = paidRunnerManifestFingerprint(paidRunnerManifestDraft(manifest));
  if (
    recomputedManifest !== manifest.manifestFingerprint ||
    recomputedManifest !== input.approvedManifestFingerprint
  ) {
    return deny("MANIFEST_FINGERPRINT_MISMATCH");
  }
  if (input.expectedProductionSha !== manifest.productionDeploySha) {
    return deny("PRODUCTION_SHA_MISMATCH");
  }
  if (manifest.calls.length !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    return deny("PLANNED_CALL_COUNT_MISMATCH");
  }
  for (const call of manifest.calls) {
    if (!input.allowlist.includes(call.canonicalId)) return deny("MODEL_ALLOWLIST_MISMATCH");
    if (call.provider !== expectedPaidRunnerProvider(call.canonicalId)) {
      return deny("PROVIDER_MAPPING_MISMATCH");
    }
    if (call.wireModel !== expectedPaidRunnerWireModel(call.canonicalId)) {
      return deny("PROVIDER_MAPPING_MISMATCH");
    }
    if (call.maxTokensPresent !== false) return deny("PROVIDER_MAPPING_MISMATCH");
  }
  return { authorized: true, providerPosts: 0 };
}

export function createPaidRunnerJournal(
  manifestFingerprint: string,
  extras?: {
    identityHash?: string;
    experimentContinuityFingerprint?: string;
  }
): PaidRunnerJournal {
  return {
    manifestFingerprint,
    identityHash: extras?.identityHash,
    experimentContinuityFingerprint: extras?.experimentContinuityFingerprint,
    entries: [],
    executedManifestFingerprints: [],
  };
}

export type PaidRunnerJournalLock = {
  release(): void;
};

export type PaidRunnerJournalStore = {
  kind: "memory" | "file";
  load(
    manifestFingerprint: string,
    discovery?: PaidRunnerJournalDiscovery
  ): PaidRunnerJournal | null;
  persist(journal: PaidRunnerJournal): void;
  tryAcquireExclusiveLock(
    manifestFingerprint: string,
    continuityFingerprint?: string
  ):
    | { ok: true; lock: PaidRunnerJournalLock }
    | { ok: false; reason: "CONCURRENT_LAUNCH" | "JOURNAL_STORE_UNAVAILABLE" };
};

const memoryLaunchLocks = new Map<string, true>();

function clonePaidRunnerJournal(journal: PaidRunnerJournal): PaidRunnerJournal {
  return {
    manifestFingerprint: journal.manifestFingerprint,
    identityHash: journal.identityHash,
    experimentContinuityFingerprint: journal.experimentContinuityFingerprint,
    entries: journal.entries.map((entry) => ({ ...entry })),
    executedManifestFingerprints: [...journal.executedManifestFingerprints],
  };
}

function journalPublicPayload(journal: PaidRunnerJournal): {
  manifestFingerprint: string;
  identityHash?: string;
  experimentContinuityFingerprint?: string;
  entries: PaidRunnerJournalEntry[];
  executedManifestFingerprints: string[];
} {
  return {
    manifestFingerprint: journal.manifestFingerprint,
    ...(journal.identityHash ? { identityHash: journal.identityHash } : {}),
    ...(journal.experimentContinuityFingerprint
      ? { experimentContinuityFingerprint: journal.experimentContinuityFingerprint }
      : {}),
    entries: journal.entries,
    executedManifestFingerprints: journal.executedManifestFingerprints,
  };
}

function journalJsonIsPublicSafe(journal: PaidRunnerJournal): void {
  const json = JSON.stringify(journalPublicPayload(journal));
  if (/sk-[a-zA-Z0-9]{10,}|rpq-paid-|Authorization|Bearer /i.test(json)) {
    throw new Error("JOURNAL_CONTAINS_SECRET");
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function fileJournalPath(directory: string, fingerprint: string): string {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("JOURNAL_FINGERPRINT_MISMATCH");
  }
  return path.join(directory, `rp-quality-paid-journal-${fingerprint}.json`);
}

function exclusiveLockKeys(
  manifestFingerprint: string,
  continuityFingerprint?: string
): string[] {
  if (continuityFingerprint && continuityFingerprint !== manifestFingerprint) {
    return [continuityFingerprint, manifestFingerprint];
  }
  return [manifestFingerprint];
}

const FILE_JOURNAL_NAME_RE = /^rp-quality-paid-journal-([a-f0-9]{64})\.json$/;

function readFilePaidRunnerJournal(file: string): PaidRunnerJournal {
  let parsed: PaidRunnerJournal;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as PaidRunnerJournal;
  } catch {
    throw new Error("CORRUPT_JOURNAL");
  }
  if (!parsed || typeof parsed.manifestFingerprint !== "string" || !Array.isArray(parsed.entries)) {
    throw new Error("CORRUPT_JOURNAL");
  }
  return clonePaidRunnerJournal(parsed);
}

function discoverFilePaidRunnerJournal(
  directory: string,
  manifestFingerprint: string,
  discovery: PaidRunnerJournalDiscovery
): PaidRunnerJournal | null {
  let adopted: PaidRunnerJournal | null = null;
  for (const name of readdirSync(directory)) {
    const match = FILE_JOURNAL_NAME_RE.exec(name);
    if (!match) continue;
    if (match[1] === manifestFingerprint) continue;
    const parsed = readFilePaidRunnerJournal(path.join(directory, name));
    const verdict = classifyPaidRunnerJournalContinuity(parsed, discovery, manifestFingerprint);
    if (verdict === "body_or_identity_drift") {
      throw new Error("BODY_DRIFT");
    }
    if (verdict !== "sha_only_rotation") continue;
    if (adopted && adopted.manifestFingerprint !== parsed.manifestFingerprint) {
      throw new Error("JOURNAL_FINGERPRINT_MISMATCH");
    }
    adopted = parsed;
  }
  return adopted;
}

function acquireFileJournalLock(
  directory: string,
  fingerprint: string
):
  | { ok: true; lock: PaidRunnerJournalLock; lockPath: string }
  | { ok: false; reason: "CONCURRENT_LAUNCH" | "JOURNAL_STORE_UNAVAILABLE" } {
  try {
    mkdirSync(directory, { recursive: true });
    const lockPath = `${fileJournalPath(directory, fingerprint)}.lock`;
    if (existsSync(lockPath)) {
      const pid = Number(readFileSync(lockPath, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
        return { ok: false, reason: "CONCURRENT_LAUNCH" };
      }
      try {
        unlinkSync(lockPath);
      } catch {
        return { ok: false, reason: "CONCURRENT_LAUNCH" };
      }
    }
    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, `${process.pid}\n`);
    } finally {
      closeSync(fd);
    }
    return {
      ok: true,
      lockPath,
      lock: {
        release() {
          try {
            unlinkSync(lockPath);
          } catch {
            /* lock already released */
          }
        },
      },
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return { ok: false, reason: "CONCURRENT_LAUNCH" };
    return { ok: false, reason: "JOURNAL_STORE_UNAVAILABLE" };
  }
}

export function createMemoryPaidRunnerJournalStore(
  seed?: PaidRunnerJournal
): PaidRunnerJournalStore {
  let current: PaidRunnerJournal | null = seed ? clonePaidRunnerJournal(seed) : null;
  return {
    kind: "memory",
    load() {
      return current ? clonePaidRunnerJournal(current) : null;
    },
    persist(journal) {
      journalJsonIsPublicSafe(journal);
      current = clonePaidRunnerJournal(journal);
      if (seed) {
        seed.manifestFingerprint = current.manifestFingerprint;
        seed.identityHash = current.identityHash;
        seed.experimentContinuityFingerprint = current.experimentContinuityFingerprint;
        seed.entries = current.entries.map((entry) => ({ ...entry }));
        seed.executedManifestFingerprints = [...current.executedManifestFingerprints];
      }
    },
    tryAcquireExclusiveLock(manifestFingerprint, continuityFingerprint) {
      const keys = exclusiveLockKeys(manifestFingerprint, continuityFingerprint);
      if (keys.some((key) => memoryLaunchLocks.has(key))) {
        return { ok: false, reason: "CONCURRENT_LAUNCH" };
      }
      for (const key of keys) memoryLaunchLocks.set(key, true);
      return {
        ok: true,
        lock: {
          release() {
            for (const key of keys) memoryLaunchLocks.delete(key);
          },
        },
      };
    },
  };
}

export function probePaidRunnerJournalDirectory(directory: string): {
  privateMode: boolean;
  dirFsyncSupported: boolean;
} {
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new Error("JOURNAL_STORE_UNAVAILABLE");
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    /* ignore */
  }
  let dirFsyncSupported = false;
  try {
    const dirFd = openSync(directory, "r");
    try {
      fsyncSync(dirFd);
      dirFsyncSupported = true;
    } finally {
      closeSync(dirFd);
    }
  } catch {
    dirFsyncSupported = false;
  }
  return { privateMode: true, dirFsyncSupported };
}

export function createFilePaidRunnerJournalStore(directory: string): PaidRunnerJournalStore {
  probePaidRunnerJournalDirectory(directory);
  return {
    kind: "file",
    load(manifestFingerprint, discovery) {
      const file = fileJournalPath(directory, manifestFingerprint);
      if (existsSync(file)) {
        const parsed = readFilePaidRunnerJournal(file);
        if (parsed.manifestFingerprint !== manifestFingerprint) {
          throw new Error("JOURNAL_FINGERPRINT_MISMATCH");
        }
        if (discovery) {
          const verdict = classifyPaidRunnerJournalContinuity(
            parsed,
            discovery,
            manifestFingerprint
          );
          if (verdict === "body_or_identity_drift") {
            throw new Error("BODY_DRIFT");
          }
        }
        return parsed;
      }
      if (!discovery) return null;
      return discoverFilePaidRunnerJournal(directory, manifestFingerprint, discovery);
    },
    persist(journal) {
      probePaidRunnerJournalDirectory(directory);
      journalJsonIsPublicSafe(journal);
      const dest = fileJournalPath(directory, journal.manifestFingerprint);
      const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
      const fd = openSync(tmp, "w", 0o600);
      try {
        writeFileSync(fd, `${JSON.stringify(journalPublicPayload(journal))}\n`, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      try {
        chmodSync(tmp, 0o600);
      } catch {
        /* ignore */
      }
      renameSync(tmp, dest);
      try {
        chmodSync(dest, 0o600);
      } catch {
        /* ignore */
      }
      const dirFd = openSync(directory, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    },
    tryAcquireExclusiveLock(manifestFingerprint, continuityFingerprint) {
      const keys = exclusiveLockKeys(manifestFingerprint, continuityFingerprint);
      const acquired: PaidRunnerJournalLock[] = [];
      for (const key of keys) {
        const next = acquireFileJournalLock(directory, key);
        if (!next.ok) {
          for (const lock of acquired.reverse()) lock.release();
          return next;
        }
        acquired.push(next.lock);
      }
      return {
        ok: true,
        lock: {
          release() {
            for (const lock of acquired.reverse()) lock.release();
          },
        },
      };
    },
  };
}

export function recoverPaidRunnerLeftoverSent(journal: PaidRunnerJournal): boolean {
  let recovered = false;
  for (const entry of journal.entries) {
    if (entry.status === "SENT") {
      entry.status = "UNKNOWN_UNRESOLVED";
      entry.settlementSource = "unsettled";
      entry.finishReason = entry.finishReason ?? "process_crash";
      recovered = true;
    }
  }
  return recovered;
}

function emptyUsageFields(): Pick<
  PaidRunnerJournalEntry,
  | "providerRequestId"
  | "httpResult"
  | "finishReason"
  | "promptTokens"
  | "completionTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "reasoningTokens"
  | "billedUsd"
  | "visibleChars"
  | "elapsedMs"
  | "artifactFingerprint"
  | "generationId"
> {
  return {
    providerRequestId: null,
    httpResult: null,
    finishReason: null,
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    billedUsd: null,
    visibleChars: null,
    elapsedMs: null,
    artifactFingerprint: null,
    generationId: null,
  };
}

export function journalCanStartNextCall(
  journal: PaidRunnerJournal,
  call: PaidRunnerPublicCall
): { ok: true } | { ok: false; reason: PaidRunnerDenialReason } {
  if (call.requestOrder > RP_QUALITY_PRECALL_PLANNED_CALLS) {
    return { ok: false, reason: "THIRTEENTH_CALL_FORBIDDEN" };
  }
  if (journal.executedManifestFingerprints.includes(journal.manifestFingerprint)) {
    return { ok: false, reason: "DUPLICATE_MANIFEST_EXECUTION" };
  }
  const replay = journal.entries.find(
    (entry) =>
      entry.fixtureId === call.fixtureId &&
      entry.canonicalId === call.canonicalId &&
      (entry.status === "SENT" || entry.status === "SETTLED" || entry.status === "UNKNOWN_UNRESOLVED")
  );
  if (replay) return { ok: false, reason: "FIXTURE_MODEL_REPLAY" };
  const last = [...journal.entries].reverse().find((entry) => entry.status !== "PREPARED");
  if (last && (last.status === "SENT" || last.status === "UNKNOWN_UNRESOLVED" || last.status === "FAILED")) {
    return { ok: false, reason: last.settlementSource === "missing" ? "COST_EVIDENCE_MISSING" : "PRIOR_CALL_UNRESOLVED" };
  }
  if (last && last.status === "BLOCKED") {
    return { ok: false, reason: last.blockReason ?? "PRIOR_CALL_UNRESOLVED" };
  }
  if (
    last &&
    last.status === "SETTLED" &&
    last.settlementSource !== "mock_exact" &&
    last.settlementSource !== "provider_exact"
  ) {
    return { ok: false, reason: "COST_EVIDENCE_MISSING" };
  }
  if (!last && call.requestOrder !== 1) {
    return { ok: false, reason: "PRIOR_CALL_UNRESOLVED" };
  }
  if (last && last.requestOrder + 1 !== call.requestOrder) {
    return { ok: false, reason: "PRIOR_CALL_UNRESOLVED" };
  }
  return { ok: true };
}

export function journalEntryMatchesSealedCall(
  entry: PaidRunnerJournalEntry,
  call: PaidRunnerPublicCall
): boolean {
  return (
    entry.requestOrder === call.requestOrder &&
    entry.fixtureId === call.fixtureId &&
    entry.canonicalId === call.canonicalId &&
    Boolean(entry.requestBodyFingerprint) &&
    Boolean(entry.finalWireFingerprint) &&
    entry.requestBodyFingerprint === call.requestBodyFingerprint &&
    entry.finalWireFingerprint === call.finalWireFingerprint
  );
}

export function journalEntryIsExactSettled(
  entry: PaidRunnerJournalEntry,
  call?: PaidRunnerPublicCall
): boolean {
  if (entry.status !== "SETTLED") return false;
  if (entry.settlementSource !== "provider_exact" && entry.settlementSource !== "mock_exact") {
    return false;
  }
  if (call && !journalEntryMatchesSealedCall(entry, call)) return false;
  return true;
}

export function journalAllCallsExactSettled(
  journal: PaidRunnerJournal,
  calls: readonly PaidRunnerPublicCall[]
): boolean {
  return calls.every((call) => {
    const entry = journal.entries.find((row) => row.requestOrder === call.requestOrder);
    return Boolean(entry && journalEntryIsExactSettled(entry, call));
  });
}

function denialForUnresolvedJournalEntry(
  entry: PaidRunnerJournalEntry
): PaidRunnerDenialReason {
  if (entry.status === "BLOCKED") return entry.blockReason ?? "PRIOR_CALL_UNRESOLVED";
  if (entry.settlementSource === "missing") return "COST_EVIDENCE_MISSING";
  if (entry.status === "UNKNOWN_UNRESOLVED" && entry.generationId) {
    return "RECONCILIATION_FAILED";
  }
  return "PRIOR_CALL_UNRESOLVED";
}

export async function recoverPaidRunnerUnknownSettlements(input: {
  journal: PaidRunnerJournal;
  sealedCalls: readonly PaidRunnerSealedCall[];
  reconcile: {
    fetchImpl: typeof fetch;
    keys: PaidRunnerReconcileKeys;
  };
}): Promise<{
  wrote: boolean;
  stillUnresolved: boolean;
  denialReason: PaidRunnerDenialReason | null;
}> {
  let wrote = false;
  for (const entry of input.journal.entries) {
    if (entry.status !== "UNKNOWN_UNRESOLVED") continue;
    const call = input.sealedCalls.find((row) => row.requestOrder === entry.requestOrder);
    if (!call || !journalEntryMatchesSealedCall(entry, call)) {
      return { wrote, stillUnresolved: true, denialReason: "BODY_DRIFT" };
    }
    const recovered = await reconcilePaidRunnerUnknownJournalEntry({
      provider: call.provider,
      wireModel: call.wireModel,
      generationId: entry.generationId,
      providerRequestId: entry.providerRequestId,
      elapsedMs: entry.elapsedMs ?? 0,
      fetchImpl: input.reconcile.fetchImpl,
      keys: input.reconcile.keys,
    });
    if (!recovered.ok) {
      return {
        wrote,
        stillUnresolved: true,
        denialReason:
          entry.generationId || entry.providerRequestId
            ? "RECONCILIATION_FAILED"
            : denialForUnresolvedJournalEntry(entry),
      };
    }
    entry.status = "SETTLED";
    entry.settlementSource = "provider_exact";
    entry.billedUsd = recovered.billedUsd;
    entry.providerRequestId = recovered.requestId;
    entry.outputAvailability = entry.artifactFingerprint ? "persisted" : "unavailable";
    wrote = true;
  }
  const unresolved = input.journal.entries.find(
    (entry) =>
      entry.status === "SENT" ||
      entry.status === "UNKNOWN_UNRESOLVED" ||
      entry.status === "FAILED"
  );
  if (unresolved) {
    return {
      wrote,
      stillUnresolved: true,
      denialReason: denialForUnresolvedJournalEntry(unresolved),
    };
  }
  return { wrote, stillUnresolved: false, denialReason: null };
}

export function markPaidRunnerJournalPrepared(
  journal: PaidRunnerJournal,
  calls: readonly PaidRunnerPublicCall[]
): void {
  journal.entries = calls.map((call) => ({
    requestOrder: call.requestOrder,
    fixtureId: call.fixtureId,
    canonicalId: call.canonicalId,
    finalWireFingerprint: call.finalWireFingerprint,
    requestBodyFingerprint: call.requestBodyFingerprint,
    status: "PREPARED",
    settlementSource: "missing",
    blockReason: null,
    ...emptyUsageFields(),
  }));
}

export function createMockPaidRunnerTransport(options?: {
  failAt?: number;
  throwAt?: number;
  rejectAt?: number;
  failureKind?: PaidRunnerTransportFailure["kind"];
  omitRequestId?: boolean;
  omitBilledUsd?: boolean;
  billedUsd?: number | null;
  httpStatus?: number;
  wrongModel?: boolean;
}): PaidRunnerTransport {
  let count = 0;
  return {
    kind: "mock",
    async post(input) {
      count += 1;
      if (options?.throwAt === count || (options?.failAt === count && options.failureKind === "throw")) {
        throw new Error("PAID_RUNNER_TRANSPORT_THROW");
      }
      if (options?.rejectAt === count) {
        return Promise.reject(new Error("PAID_RUNNER_TRANSPORT_REJECT"));
      }
      if (options?.failAt === count) {
        return {
          ok: false,
          kind: options.failureKind ?? "timeout",
          httpStatus: options.failureKind === "http" ? 500 : null,
          text: options.failureKind === "partial_stream" ? "partial " : "",
          headers: {} as Record<string, string>,
          body: options.failureKind === "malformed" ? "not-json" : {},
        };
      }
      const billedUsd = options?.omitBilledUsd ? null : options?.billedUsd === undefined ? 0.01 : options.billedUsd;
      const text = `모의 출력 ${input.canonicalId} ${count} — 장면은 이어지고 공간은 유지된다.`;
      return {
        ok: true,
        httpStatus: options?.httpStatus ?? 200,
        text,
        finishReason: "stop",
        usage: {
          promptTokens: 100,
          completionTokens: 80,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          billedUsd,
        },
        requestId: options?.omitRequestId ? "" : `mock-req-${count}`,
        headers: {
          "x-request-id": options?.omitRequestId ? "" : `mock-req-${count}`,
          "x-ci-request-id": options?.omitRequestId ? "" : `mock-req-${count}`,
        },
        body: {
          id: options?.omitRequestId ? undefined : `mock-req-${count}`,
          model: options?.wrongModel ? "wrong-provider-model" : input.body.model,
          usage: {
            prompt_tokens: 100,
            completion_tokens: 80,
            cost: billedUsd ?? undefined,
          },
        },
      };
    },
  };
}

export function createLivePaidRunnerTransport(): never {
  throw new Error("LIVE_TRANSPORT_NOT_SHIPPED");
}

function settleFromTransport(
  call: PaidRunnerSealedCall,
  result: PaidRunnerTransportResult,
  elapsedMs: number,
  transportKind: PaidRunnerTransportKind
): PaidRunnerUsageEvidence {
  if (!result.ok) {
    return {
      fixtureId: call.fixtureId,
      canonicalId: call.canonicalId,
      provider: call.provider,
      wireModel: call.wireModel,
      providerRequestId: null,
      httpResult: result.httpStatus,
      finishReason: result.kind,
      promptTokens: null,
      completionTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      billedUsd: null,
      settlementSource: "unsettled",
      visibleChars: result.text.length || null,
      elapsedMs,
      finalWireFingerprint: call.finalWireFingerprint,
    };
  }
  const bodyModel =
    result.body && typeof result.body === "object" && "model" in result.body
      ? String((result.body as { model?: unknown }).model ?? "")
      : "";
  if (result.httpStatus < 200 || result.httpStatus >= 300) {
    return {
      fixtureId: call.fixtureId,
      canonicalId: call.canonicalId,
      provider: call.provider,
      wireModel: call.wireModel,
      providerRequestId: null,
      httpResult: result.httpStatus,
      finishReason: "http",
      promptTokens: null,
      completionTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      billedUsd: null,
      settlementSource: "unsettled",
      visibleChars: result.text.length || null,
      elapsedMs,
      finalWireFingerprint: call.finalWireFingerprint,
    };
  }
  if (bodyModel && bodyModel !== call.wireModel) {
    return {
      fixtureId: call.fixtureId,
      canonicalId: call.canonicalId,
      provider: call.provider,
      wireModel: call.wireModel,
      providerRequestId: null,
      httpResult: result.httpStatus,
      finishReason: "wrong_provider_model",
      promptTokens: null,
      completionTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      billedUsd: null,
      settlementSource: "unsettled",
      visibleChars: result.text.length || null,
      elapsedMs,
      finalWireFingerprint: call.finalWireFingerprint,
    };
  }
  const usage = parseCompatibleUsage({
    usage:
      result.body && typeof result.body === "object"
        ? (result.body as { usage?: unknown }).usage
        : undefined,
    transportProvider: call.provider,
  });
  const headerBag = new Headers(result.headers);
  const requestId =
    result.requestId ||
    readCompatibleCompletionProviderRequestId({
      provider: call.provider,
      headers: headerBag,
      body: result.body,
    });
  const billedUsd =
    transportKind === "live"
      ? null
      : result.usage.billedUsd ?? usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? null;
  let settlementSource: PaidRunnerUsageEvidence["settlementSource"];
  if (!requestId) {
    settlementSource = "missing";
  } else if (billedUsd == null || !(billedUsd > 0)) {
    settlementSource = "unsettled";
  } else if (transportKind === "mock") {
    settlementSource = "mock_exact";
  } else {
    settlementSource = "unsettled";
  }
  return {
    fixtureId: call.fixtureId,
    canonicalId: call.canonicalId,
    provider: call.provider,
    wireModel: call.wireModel,
    providerRequestId: requestId || null,
    httpResult: result.httpStatus,
    finishReason: result.finishReason,
    promptTokens: result.usage.promptTokens || usage.promptTokens || null,
    completionTokens: result.usage.completionTokens || usage.completionTokens || null,
    cacheReadTokens: result.usage.cacheReadTokens || usage.cacheReadTokens || null,
    cacheWriteTokens: result.usage.cacheWriteTokens || usage.cacheWriteTokens || null,
    reasoningTokens: result.usage.reasoningTokens || usage.reasoningTokens || null,
    billedUsd,
    settlementSource,
    visibleChars: result.text.length,
    elapsedMs,
    finalWireFingerprint: call.finalWireFingerprint,
  };
}

function journalStatusForTransport(
  result: PaidRunnerTransportResult,
  usage: PaidRunnerUsageEvidence
): PaidRunnerJournalStatus {
  if (!result.ok) {
    if (
      result.kind === "timeout" ||
      result.kind === "partial_stream" ||
      result.kind === "throw" ||
      result.kind === "connection_reset"
    ) {
      return "UNKNOWN_UNRESOLVED";
    }
    return "FAILED";
  }
  if (result.httpStatus < 200 || result.httpStatus >= 300) return "FAILED";
  if (usage.finishReason === "wrong_provider_model" || usage.finishReason === "empty_content") {
    return "FAILED";
  }
  if (usage.settlementSource === "mock_exact" || usage.settlementSource === "provider_exact") {
    return "SETTLED";
  }
  if (usage.billedUsd != null && !(usage.billedUsd > 0)) return "FAILED";
  return "UNKNOWN_UNRESOLVED";
}

function denialForUnresolvedUsage(usage: PaidRunnerUsageEvidence): PaidRunnerDenialReason {
  if (usage.settlementSource === "missing" || (usage.billedUsd != null && !(usage.billedUsd > 0))) {
    return "COST_EVIDENCE_MISSING";
  }
  return "PRIOR_CALL_UNRESOLVED";
}

function writeJournalEntry(
  journal: PaidRunnerJournal,
  call: PaidRunnerPublicCall,
  patch: Partial<PaidRunnerJournalEntry>
): void {
  const existing = journal.entries.find((entry) => entry.requestOrder === call.requestOrder);
  const next: PaidRunnerJournalEntry = {
    requestOrder: call.requestOrder,
    fixtureId: call.fixtureId,
    canonicalId: call.canonicalId,
    finalWireFingerprint: call.finalWireFingerprint,
    requestBodyFingerprint: call.requestBodyFingerprint,
    status: "PREPARED",
    settlementSource: "missing",
    blockReason: null,
    ...emptyUsageFields(),
    ...existing,
    ...patch,
  };
  if (existing) {
    journal.entries[journal.entries.indexOf(existing)] = next;
    return;
  }
  journal.entries.push(next);
}

export function buildPaidRunnerPublicManifest(input: {
  mainSha: string;
  productionDeploySha: string;
  identityHashes: PaidRunnerIdentityHashes;
  sealedCalls: readonly PaidRunnerSealedCall[];
}): PaidRunnerPublicManifest {
  const identityHash = paidRunnerIdentityHash(input.identityHashes);
  const calls = input.sealedCalls.map((call) => ({
    requestOrder: call.requestOrder,
    fixtureId: call.fixtureId,
    canonicalId: call.canonicalId,
    provider: call.provider,
    wireModel: call.wireModel,
    endpointKind: call.endpointKind,
    finalWireFingerprint: call.finalWireFingerprint,
    requestBodyFingerprint: call.requestBodyFingerprint,
    effectiveCanonMode: call.effectiveCanonMode,
    authoringLevel: "NORMAL" as const,
    contentMode: "SAFE" as const,
    maxTokensPresent: false as const,
  }));
  const draft = {
    version: 1 as const,
    mode: RP_QUALITY_PAID_RUNNER_DEFAULT_MODE,
    mainSha: input.mainSha,
    productionDeploySha: input.productionDeploySha,
    characterId: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId,
    personaName: RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName,
    identityHashes: input.identityHashes,
    identityHash,
    calls,
    approvalStatus: "NOT_APPROVED" as const,
    pricingSnapshotProvenance: "publishedModelPricing.getPublishedPricing" as const,
    unknownSingleCallCost: true as const,
  };
  return {
    ...draft,
    providerPosts: 0,
    manifestFingerprint: paidRunnerManifestFingerprint(draft),
  };
}

export function planPaidRunnerCost(
  sizeRows: readonly RpQualityPrecallSizeRow[],
  fxRow: RpQualityPrecallFxSnapshotRow
): RpQualityPrecallCostPlanning {
  return computeRpQualityPrecallCostPlanning({ sizeRows, fxRow });
}

export function publicMetadataContainsSecret(value: unknown): boolean {
  const json = JSON.stringify(value);
  if (!json) return false;
  if (/sk-[a-zA-Z0-9]{10,}|rpq-paid-|Authorization|Bearer /i.test(json)) return true;
  if (RP_QUALITY_PRECALL_HISTORICAL_ROW_POINTER.characterName && json.includes("오늘은 그냥")) {
    return true;
  }
  return false;
}

export function paidRunnerLiveDispatchDenied(input: {
  transport: PaidRunnerTransport;
  liveExecuteApproved?: boolean;
  journalStore?: PaidRunnerJournalStore;
  artifactStore?: PaidRunnerArtifactStore;
}): PaidRunnerDenialReason | null {
  if (input.transport.kind !== "live") {
    return null;
  }
  if (input.transport.simulation === true) {
    return null;
  }
  if (input.liveExecuteApproved !== true) {
    return "LIVE_EXECUTE_NOT_APPROVED";
  }
  if (input.journalStore?.kind !== "file") {
    return "JOURNAL_STORE_UNAVAILABLE";
  }
  if (input.artifactStore?.kind !== "file") {
    return "ARTIFACT_STORE_UNAVAILABLE";
  }
  return null;
}

export function paidRunnerReportedProviderPosts(
  transport: PaidRunnerTransport,
  transportPosts: number
): number {
  if (transport.kind !== "live" || transport.simulation === true) {
    return 0;
  }
  return transportPosts;
}

export async function runPaidRunner(input: {
  mode: PaidRunnerMode;
  manifest: PaidRunnerPublicManifest;
  sealedCalls: readonly PaidRunnerSealedCall[];
  authorization: PaidRunnerAuthorizationInput;
  transport: PaidRunnerTransport;
  journal?: PaidRunnerJournal;
  journalStore?: PaidRunnerJournalStore;
  artifactStore?: PaidRunnerArtifactStore;
  liveExecuteApproved?: boolean;
  reconcile?: {
    fetchImpl: typeof fetch;
    keys: PaidRunnerReconcileKeys;
  };
}): Promise<PaidRunnerRunResult> {
  const publicResults: PaidRunnerPublicResult[] = [];
  const privateResults: PaidRunnerPrivateResult[] = [];
  const manifestDraft = paidRunnerManifestDraft(input.manifest);
  const continuityFingerprint = paidRunnerExperimentContinuityFingerprint(manifestDraft);
  const discovery: PaidRunnerJournalDiscovery = {
    continuityFingerprint,
    identityHash: input.manifest.identityHash,
    calls: input.manifest.calls,
  };
  const emptyJournal =
    input.journal ??
    createPaidRunnerJournal(input.manifest.manifestFingerprint, {
      identityHash: input.manifest.identityHash,
      experimentContinuityFingerprint: continuityFingerprint,
    });
  const closed = (
    partial: Partial<PaidRunnerRunResult> & Pick<PaidRunnerRunResult, "authorized" | "denialReason" | "journal">
  ): PaidRunnerRunResult => ({
    mode: input.mode,
    providerPosts: 0,
    transportPosts: 0,
    networkAttempts: 0,
    dbWrites: 0,
    publicResults,
    privateResults,
    publicMetadataSafe: true,
    ...partial,
  });

  const gate = evaluatePaidRunnerAuthorization(input.manifest, input.authorization, input.mode);
  if (!gate.authorized) {
    return closed({ authorized: false, denialReason: gate.reason, journal: emptyJournal });
  }
  if (input.transport.kind === "live" && !input.reconcile) {
    return closed({
      authorized: false,
      denialReason: "MISSING_INFERENCE_KEY",
      journal: emptyJournal,
    });
  }
  const liveNetworkDenied = paidRunnerLiveDispatchDenied(input);
  if (liveNetworkDenied) {
    return closed({
      authorized: false,
      denialReason: liveNetworkDenied,
      journal: emptyJournal,
    });
  }

  const seal = verifyPaidRunnerDispatchSeal({
    manifest: input.manifest,
    sealedCalls: input.sealedCalls,
  });
  if (!seal.ok) {
    return closed({ authorized: false, denialReason: seal.reason, journal: emptyJournal });
  }

  const canonicalFingerprint = paidRunnerManifestFingerprint(manifestDraft);
  const store = input.journalStore ?? createMemoryPaidRunnerJournalStore(emptyJournal);
  const lockResult = store.tryAcquireExclusiveLock(canonicalFingerprint, continuityFingerprint);
  if (!lockResult.ok) {
    return closed({
      authorized: false,
      denialReason: lockResult.reason,
      journal: emptyJournal,
    });
  }

  let journal = emptyJournal;
  let transportPosts = 0;
  try {
    let loaded: PaidRunnerJournal | null = null;
    try {
      loaded = store.load(canonicalFingerprint, discovery);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const denial: PaidRunnerDenialReason =
        message === "JOURNAL_FINGERPRINT_MISMATCH"
          ? "JOURNAL_FINGERPRINT_MISMATCH"
          : message === "CORRUPT_JOURNAL"
            ? "CORRUPT_JOURNAL"
            : message === "BODY_DRIFT"
              ? "BODY_DRIFT"
              : "JOURNAL_STORE_UNAVAILABLE";
      return closed({
        authorized: false,
        denialReason: denial,
        journal,
      });
    }
    journal = loaded ?? clonePaidRunnerJournal(emptyJournal);
    if (journal.manifestFingerprint !== canonicalFingerprint) {
      const verdict = classifyPaidRunnerJournalContinuity(
        journal,
        discovery,
        canonicalFingerprint
      );
      if (verdict === "body_or_identity_drift") {
        return closed({
          authorized: false,
          denialReason: "BODY_DRIFT",
          journal,
        });
      }
      if (verdict !== "sha_only_rotation") {
        return closed({
          authorized: false,
          denialReason: "JOURNAL_FINGERPRINT_MISMATCH",
          journal,
        });
      }
      journal.identityHash = journal.identityHash ?? input.manifest.identityHash;
      journal.experimentContinuityFingerprint =
        journal.experimentContinuityFingerprint ?? continuityFingerprint;
    } else if (discovery) {
      const exactVerdict = classifyPaidRunnerJournalContinuity(
        journal,
        discovery,
        canonicalFingerprint
      );
      if (exactVerdict === "body_or_identity_drift") {
        return closed({
          authorized: false,
          denialReason: "BODY_DRIFT",
          journal,
        });
      }
    }

    const persist = (): PaidRunnerDenialReason | null => {
      try {
        store.persist(journal);
        return null;
      } catch {
        return "JOURNAL_STORE_UNAVAILABLE";
      }
    };

    if (recoverPaidRunnerLeftoverSent(journal)) {
      const persistFail = persist();
      return closed({
        authorized: false,
        denialReason: persistFail ?? "PRIOR_CALL_UNRESOLVED",
        journal,
      });
    }

    if (journal.entries.length === 0) {
      markPaidRunnerJournalPrepared(journal, input.manifest.calls);
      journal.identityHash = journal.identityHash ?? input.manifest.identityHash;
      journal.experimentContinuityFingerprint =
        journal.experimentContinuityFingerprint ?? continuityFingerprint;
      const persistFail = persist();
      if (persistFail) {
        return closed({ authorized: false, denialReason: persistFail, journal });
      }
    }

    if (input.reconcile) {
      const recoveredUnknown = await recoverPaidRunnerUnknownSettlements({
        journal,
        sealedCalls: input.sealedCalls,
        reconcile: input.reconcile,
      });
      if (recoveredUnknown.wrote) {
        const persistFail = persist();
        if (persistFail) {
          return closed({ authorized: false, denialReason: persistFail, journal });
        }
      }
      if (recoveredUnknown.stillUnresolved) {
        return closed({
          authorized: true,
          denialReason: recoveredUnknown.denialReason ?? "COST_EVIDENCE_MISSING",
          journal,
        });
      }
    } else {
      const unresolved = journal.entries.find(
        (entry) =>
          entry.status === "SENT" ||
          entry.status === "UNKNOWN_UNRESOLVED" ||
          entry.status === "FAILED"
      );
      if (unresolved) {
        return closed({
          authorized: true,
          denialReason: denialForUnresolvedJournalEntry(unresolved),
          journal,
        });
      }
    }

    if (
      journal.executedManifestFingerprints.includes(journal.manifestFingerprint) ||
      journalAllCallsExactSettled(journal, input.manifest.calls)
    ) {
      return closed({
        authorized: true,
        denialReason: "DUPLICATE_MANIFEST_EXECUTION",
        journal,
      });
    }

    for (const sealed of input.sealedCalls) {
      const existing = journal.entries.find((entry) => entry.requestOrder === sealed.requestOrder);
      if (existing && journalEntryIsExactSettled(existing, sealed)) {
        continue;
      }
      if (existing && existing.status === "SETTLED" && !journalEntryMatchesSealedCall(existing, sealed)) {
        persist();
        return closed({
          authorized: true,
          denialReason: "BODY_DRIFT",
          journal,
        });
      }
      const startGate = journalCanStartNextCall(journal, sealed);
      if (!startGate.ok) {
        const existing = journal.entries.find((entry) => entry.requestOrder === sealed.requestOrder);
        if (!existing || existing.status === "PREPARED") {
          writeJournalEntry(journal, sealed, {
            status: "BLOCKED",
            blockReason: startGate.reason,
          });
        }
        persist();
        return closed({
          authorized: true,
          denialReason: startGate.reason,
          journal,
          transportPosts,
        });
      }

      writeJournalEntry(journal, sealed, { status: "SENT", settlementSource: "unsettled" });
      const persistSent = persist();
      if (persistSent) {
        writeJournalEntry(journal, sealed, { status: "PREPARED", settlementSource: "missing" });
        return closed({
          authorized: false,
          denialReason: persistSent,
          journal,
          transportPosts,
        });
      }

      const started = Date.now();
      let result: PaidRunnerTransportResult;
      try {
        result = await input.transport.post({
          endpoint: sealed.endpoint,
          body: sealed.requestBody,
          canonicalId: sealed.canonicalId,
          provider: sealed.provider,
        });
      } catch {
        result = {
          ok: false,
          kind: "throw",
          httpStatus: null,
          text: "",
          headers: {} as Record<string, string>,
          body: {},
        };
      }
      transportPosts += 1;
      const elapsedMs = Date.now() - started;
      let usage = settleFromTransport(sealed, result, elapsedMs, input.transport.kind);
      if (
        input.transport.kind === "live" &&
        input.reconcile &&
        result.ok &&
        usage.finishReason !== "wrong_provider_model" &&
        usage.finishReason !== "http"
      ) {
        usage = await reconcilePaidRunnerSettlement({
          call: sealed,
          result,
          elapsedMs,
          fetchImpl: input.reconcile.fetchImpl,
          keys: input.reconcile.keys,
        });
      }
      if (result.ok && !result.text.trim()) {
        usage = { ...usage, finishReason: "empty_content", settlementSource: "unsettled" };
      }
      const status = journalStatusForTransport(result, usage);
      if (status !== "SETTLED") {
        writeJournalEntry(journal, sealed, {
          status,
          settlementSource: usage.settlementSource,
          providerRequestId: usage.providerRequestId,
          billedUsd: usage.billedUsd,
          httpResult: usage.httpResult,
          finishReason: usage.finishReason,
          elapsedMs,
          generationId: result.ok ? result.generationId ?? null : null,
        });
        persist();
        return closed({
          authorized: true,
          denialReason: result.ok && input.transport.kind === "live" && usage.settlementSource !== "provider_exact"
            ? usage.settlementSource === "missing"
              ? "COST_EVIDENCE_MISSING"
              : "RECONCILIATION_FAILED"
            : denialForUnresolvedUsage(usage),
          journal,
          transportPosts,
          providerPosts: paidRunnerReportedProviderPosts(input.transport, transportPosts),
        });
      }
      const artifacts = input.artifactStore ?? createMemoryPaidRunnerArtifactStore();
      const fingerprint = paidRunnerArtifactFingerprint(result.ok ? result.text : "");
      try {
        artifacts.persist({
          requestOrder: sealed.requestOrder,
          fingerprint,
          text: result.ok ? result.text : "",
        });
      } catch {
        writeJournalEntry(journal, sealed, {
          status: "UNKNOWN_UNRESOLVED",
          settlementSource: usage.settlementSource,
          providerRequestId: usage.providerRequestId,
          billedUsd: usage.billedUsd,
          finishReason: "artifact_persist_failed",
          elapsedMs,
        });
        persist();
        return closed({
          authorized: true,
          denialReason: "ARTIFACT_STORE_UNAVAILABLE",
          journal,
          transportPosts,
          providerPosts: paidRunnerReportedProviderPosts(input.transport, transportPosts),
        });
      }
      writeJournalEntry(journal, sealed, {
        status: "SETTLED",
        settlementSource: usage.settlementSource,
        providerRequestId: usage.providerRequestId,
        httpResult: usage.httpResult,
        finishReason: usage.finishReason,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens: usage.reasoningTokens,
        billedUsd: usage.billedUsd,
        visibleChars: usage.visibleChars,
        elapsedMs,
        artifactFingerprint: fingerprint,
        generationId: result.ok ? result.generationId ?? null : null,
        outputAvailability: "persisted",
      });
      const persistSettled = persist();
      if (persistSettled) {
        return closed({
          authorized: true,
          denialReason: persistSettled,
          journal,
          transportPosts,
          providerPosts: paidRunnerReportedProviderPosts(input.transport, transportPosts),
        });
      }
      const packet = buildQualityOutputPacket({
        opaqueLabel: `call-${sealed.requestOrder}`,
        generatedText: result.text,
        model: sealed.canonicalId,
        sceneClass: sealed.fixtureId,
        authoringLevel: DEFAULT_USER_AUTHORING_LEVEL,
        turnKind: "manual",
        contentMode: "SAFE",
        finishReason: usage.finishReason,
        finalWireFingerprint: sealed.finalWireFingerprint,
      });
      publicResults.push({
        requestOrder: sealed.requestOrder,
        fixtureId: sealed.fixtureId,
        status: "SETTLED",
        visibleChars: packet.metadata.visibleChars,
        finishReason: usage.finishReason,
        finalWireFingerprint: sealed.finalWireFingerprint,
        scores: emptyRubricScores(),
      });
      privateResults.push({
        requestOrder: sealed.requestOrder,
        reveal: {
          canonicalId: sealed.canonicalId,
          provider: sealed.provider,
          wireModel: sealed.wireModel,
        },
        packet,
        usage,
      });
    }
    journal.executedManifestFingerprints.push(journal.manifestFingerprint);
    persist();
    return closed({
      authorized: true,
      denialReason: null,
      journal,
      transportPosts,
      providerPosts: paidRunnerReportedProviderPosts(input.transport, transportPosts),
      publicResults,
      privateResults,
      publicMetadataSafe: !publicMetadataContainsSecret({
        publicResults,
        journal: journal.entries.map((entry) => ({
          requestOrder: entry.requestOrder,
          status: entry.status,
          billedUsd: entry.billedUsd,
        })),
      }),
    });
  } finally {
    lockResult.lock.release();
  }
}

export function paidRunnerSoftAimUncapped(): {
  softAimChars: number;
  applicationMaxTokens: number | undefined;
} {
  return {
    softAimChars: UNIFIED_TIER_AIM_CHARS,
    applicationMaxTokens: resolveOpenRouterMaxTokens(3200, 8192, MAIN_RP_MODEL_IDS[0]),
  };
}

export function paidRunnerRegistrySnapshot(): {
  models: ReturnType<typeof rpQualityPrecallBenchmarkModels>;
  fixtures: typeof RP_QUALITY_PRECALL_FIXTURE_IDS;
  plannedCalls: number;
  mutation: typeof RP_QUALITY_PRECALL_MUTATION_POLICY;
} {
  const models = rpQualityPrecallBenchmarkModels();
  assertCurrentMainRpPaidAllowlist(models.map((model) => model.canonicalId));
  return {
    models,
    fixtures: RP_QUALITY_PRECALL_FIXTURE_IDS,
    plannedCalls: RP_QUALITY_PRECALL_PLANNED_CALLS,
    mutation: RP_QUALITY_PRECALL_MUTATION_POLICY,
  };
}
