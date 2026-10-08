/**
 * Paid 12-call Main RP quality runner owner. Prepare/dry-run is the default.
 * This file never opens sockets, never reads production provider keys, and
 * never fills rubric scores. Live POST is a separate operator entrypoint and
 * is not shipped in this PR.
 */
import { createHash } from "node:crypto";

import {
  MAIN_RP_MODEL_IDS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { resolveMainRpPrimaryWireModelId } from "@/lib/openRouterConfig";
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
  | "APPROVAL_STATUS_NOT_APPROVED";

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
  settlementSource: "provider_exact" | "estimate_not_bill" | "missing" | "unsettled";
  visibleChars: number | null;
  elapsedMs: number | null;
  blockReason: PaidRunnerDenialReason | null;
};

export type PaidRunnerJournal = {
  manifestFingerprint: string;
  entries: PaidRunnerJournalEntry[];
  executedManifestFingerprints: string[];
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
};

export type PaidRunnerTransportFailure = {
  ok: false;
  kind: "timeout" | "malformed" | "partial_stream" | "http";
  httpStatus: number | null;
  text: string;
  headers: Record<string, string>;
  body: unknown;
};

export type PaidRunnerTransportResult = PaidRunnerTransportSuccess | PaidRunnerTransportFailure;

export type PaidRunnerTransport = {
  kind: PaidRunnerTransportKind;
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

export function evaluatePaidRunnerAuthorization(
  manifest: PaidRunnerPublicManifest,
  input: PaidRunnerAuthorizationInput,
  mode: PaidRunnerMode
): PaidRunnerAuthorization {
  if (mode === "PREPARE") return deny("PREPARE_MODE_DOES_NOT_POST");
  if (manifest.approvalStatus !== "NOT_APPROVED") return deny("APPROVAL_STATUS_NOT_APPROVED");
  if (input.userCostApproved !== true) return deny("MISSING_USER_COST_APPROVAL");
  if (!input.experimentSecret) return deny("MISSING_EXPERIMENT_SECRET");
  if (experimentSecretUsesProductionKey(input.experimentSecret)) {
    return deny("PRODUCTION_KEY_FALLBACK_FORBIDDEN");
  }
  if (!isWellFormedPaidExperimentSecret(input.experimentSecret)) {
    return deny("MALFORMED_EXPERIMENT_SECRET");
  }
  if (input.approvedManifestFingerprint !== manifest.manifestFingerprint) {
    return deny("MANIFEST_FINGERPRINT_MISMATCH");
  }
  if (input.expectedProductionSha !== manifest.productionDeploySha) {
    return deny("PRODUCTION_SHA_MISMATCH");
  }
  if (input.expectedIdentityHash !== manifest.identityHash) {
    return deny("IDENTITY_HASH_MISMATCH");
  }
  if (input.plannedCalls !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    return deny("PLANNED_CALL_COUNT_MISMATCH");
  }
  if (manifest.calls.length !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    return deny("PLANNED_CALL_COUNT_MISMATCH");
  }
  try {
    assertCurrentMainRpPaidAllowlist(input.allowlist);
  } catch {
    return deny("MODEL_ALLOWLIST_MISMATCH");
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

export function createPaidRunnerJournal(manifestFingerprint: string): PaidRunnerJournal {
  return {
    manifestFingerprint,
    entries: [],
    executedManifestFingerprints: [],
  };
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
  if (last && last.status === "SETTLED" && last.settlementSource === "missing") {
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
  failureKind?: PaidRunnerTransportFailure["kind"];
  omitRequestId?: boolean;
  omitBilledUsd?: boolean;
}): PaidRunnerTransport {
  let count = 0;
  return {
    kind: "mock",
    async post(input) {
      count += 1;
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
      const text = `모의 출력 ${input.canonicalId} ${count} — 장면은 이어지고 공간은 유지된다.`;
      return {
        ok: true,
        httpStatus: 200,
        text,
        finishReason: "stop",
        usage: {
          promptTokens: 100,
          completionTokens: 80,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          billedUsd: options?.omitBilledUsd ? null : 0.01,
        },
        requestId: options?.omitRequestId ? "" : `mock-req-${count}`,
        headers: {
          "x-request-id": options?.omitRequestId ? "" : `mock-req-${count}`,
          "x-ci-request-id": options?.omitRequestId ? "" : `mock-req-${count}`,
        },
        body: {
          id: options?.omitRequestId ? undefined : `mock-req-${count}`,
          usage: {
            prompt_tokens: 100,
            completion_tokens: 80,
            cost: options?.omitBilledUsd ? undefined : 0.01,
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
  elapsedMs: number
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
  const billedUsd = result.usage.billedUsd ?? usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? null;
  const settlementSource: PaidRunnerUsageEvidence["settlementSource"] =
    requestId && billedUsd != null ? "provider_exact" : requestId ? "unsettled" : "missing";
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

export async function runPaidRunner(input: {
  mode: PaidRunnerMode;
  manifest: PaidRunnerPublicManifest;
  sealedCalls: readonly PaidRunnerSealedCall[];
  authorization: PaidRunnerAuthorizationInput;
  transport: PaidRunnerTransport;
  journal?: PaidRunnerJournal;
}): Promise<PaidRunnerRunResult> {
  const journal = input.journal ?? createPaidRunnerJournal(input.manifest.manifestFingerprint);
  const gate = evaluatePaidRunnerAuthorization(input.manifest, input.authorization, input.mode);
  const publicResults: PaidRunnerPublicResult[] = [];
  const privateResults: PaidRunnerPrivateResult[] = [];
  if (!gate.authorized) {
    return {
      mode: input.mode,
      authorized: false,
      denialReason: gate.reason,
      providerPosts: 0,
      transportPosts: 0,
      networkAttempts: 0,
      dbWrites: 0,
      journal,
      publicResults,
      privateResults,
      publicMetadataSafe: true,
    };
  }
  if (input.transport.kind === "live") {
    return {
      mode: input.mode,
      authorized: true,
      denialReason: "LIVE_TRANSPORT_NOT_SHIPPED",
      providerPosts: 0,
      transportPosts: 0,
      networkAttempts: 0,
      dbWrites: 0,
      journal,
      publicResults,
      privateResults,
      publicMetadataSafe: true,
    };
  }

  markPaidRunnerJournalPrepared(journal, input.manifest.calls);
  let transportPosts = 0;
  for (const sealed of input.sealedCalls) {
    const startGate = journalCanStartNextCall(journal, sealed);
    if (!startGate.ok) {
      writeJournalEntry(journal, sealed, {
        status: "BLOCKED",
        blockReason: startGate.reason,
      });
      return {
        mode: input.mode,
        authorized: true,
        denialReason: startGate.reason,
        providerPosts: 0,
        transportPosts,
        networkAttempts: 0,
        dbWrites: 0,
        journal,
        publicResults,
        privateResults,
        publicMetadataSafe: !publicMetadataContainsSecret({ publicResults, journal }),
      };
    }
    writeJournalEntry(journal, sealed, { status: "SENT", settlementSource: "unsettled" });
    const started = Date.now();
    const result = await input.transport.post({
      endpoint: sealed.endpoint,
      body: sealed.requestBody,
      canonicalId: sealed.canonicalId,
      provider: sealed.provider,
    });
    transportPosts += 1;
    const elapsedMs = Date.now() - started;
    if (!result.ok) {
      const status: PaidRunnerJournalStatus =
        result.kind === "timeout" || result.kind === "partial_stream" ? "UNKNOWN_UNRESOLVED" : "FAILED";
      writeJournalEntry(journal, sealed, {
        status,
        settlementSource: "unsettled",
        httpResult: result.httpStatus,
        finishReason: result.kind,
        elapsedMs,
      });
      return {
        mode: input.mode,
        authorized: true,
        denialReason: result.kind === "timeout" || result.kind === "partial_stream"
          ? "PRIOR_CALL_UNRESOLVED"
          : "PRIOR_CALL_UNRESOLVED",
        providerPosts: 0,
        transportPosts,
        networkAttempts: 0,
        dbWrites: 0,
        journal,
        publicResults,
        privateResults,
        publicMetadataSafe: true,
      };
    }
    const usage = settleFromTransport(sealed, result, elapsedMs);
    if (usage.settlementSource !== "provider_exact") {
      writeJournalEntry(journal, sealed, {
        status: "UNKNOWN_UNRESOLVED",
        settlementSource: usage.settlementSource,
        providerRequestId: usage.providerRequestId,
        billedUsd: usage.billedUsd,
        httpResult: usage.httpResult,
        finishReason: usage.finishReason,
        elapsedMs,
      });
      return {
        mode: input.mode,
        authorized: true,
        denialReason: usage.settlementSource === "missing" ? "COST_EVIDENCE_MISSING" : "PRIOR_CALL_UNRESOLVED",
        providerPosts: 0,
        transportPosts,
        networkAttempts: 0,
        dbWrites: 0,
        journal,
        publicResults,
        privateResults,
        publicMetadataSafe: true,
      };
    }
    writeJournalEntry(journal, sealed, {
      status: "SETTLED",
      settlementSource: "provider_exact",
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
    });
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
  return {
    mode: input.mode,
    authorized: true,
    denialReason: null,
    providerPosts: 0,
    transportPosts,
    networkAttempts: 0,
    dbWrites: 0,
    journal,
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
  };
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
