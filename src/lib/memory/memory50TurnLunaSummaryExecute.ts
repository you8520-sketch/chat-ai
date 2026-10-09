/**
 * Authorized 10-POST GPT-6 Luna rolling-summary execute.
 * Reuses callOpenRouterCompletion, the paid-runner file lock/journal
 * persist pattern, isolated DB, and the live seal owner.
 * Production-key fallback is forbidden. This is not a second billing owner.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
} from "@/lib/chatModels";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import {
  callOpenRouterCompletion,
  CompatibleCompletionError,
} from "@/lib/openRouterCompletion";
import {
  RP_QUALITY_PAID_PRODUCTION_KEY_ENVS,
  createFilePaidRunnerJournalStore,
  experimentSecretUsesProductionKey,
  paidRunnerRequestBodyFingerprint,
  type PaidRunnerJournalStore,
} from "@/lib/rpQualityPaidRunner";
import {
  createFilePaidRunnerArtifactStore,
  paidRunnerArtifactFingerprint,
  type PaidRunnerArtifactStore,
} from "@/lib/rpQualityPaidRunnerArtifacts";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { assertIsolatedTestDatabaseActive } from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";
import {
  AB_CHAT_ID,
  AB_CHARACTER_ID,
  AB_COMPLETED_TURNS,
  AB_FREEZE_USER,
  AB_USER_ID,
  harborCharacterChunks,
  seedHarborExperimentChat,
} from "./memory50TurnAbRunner";
import { buildOracleDiagnosticMemory } from "./memory50TurnAbAnswerKey";
import {
  AB_CHARACTER_CARD,
  AB_CHARACTER_NAME,
  AB_GREETING,
  AB_PERSONA_CARD,
  AB_PERSONA_NAME,
  AB_PROBES,
  AB_SCRIPT,
} from "./memory50TurnAbScript";
import {
  LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS,
  LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST,
  LUNA_SUMMARY_APPROVED_SCRIPT_HASH,
  LUNA_SUMMARY_EXPERIMENT_KEY_ENV,
  LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS,
  LUNA_SUMMARY_PLANNED_POSTS,
  LUNA_SUMMARY_REQUEST_KIND,
  buildLunaSummaryPrepareManifest,
  evaluateLunaSummaryGate,
  harborScriptHash,
  type LunaSummaryDenialReason,
} from "./memory50TurnLunaSummaryPrepare";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { buildMemoryContextForChat } from "./memory-manager";
import {
  __formatBatchDialogueForTests,
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  summarizeTurnBatch,
  type RollingSummaryLlmCaller,
} from "./memory-rolling-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { listMemoryRecordsForChat } from "./memory-turn-summary";

export const LUNA_SUMMARY_EXECUTE_MAIN_SHA =
  "7573e6fd3552a5802e97d1507f8f671d361447a2" as const;
export const LUNA_SUMMARY_EXECUTE_SHIPPED = true;
export const LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST_FINGERPRINT =
  LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST;
export const LUNA_SUMMARY_JOURNAL_DIR_ENV = "MEMORY_LUNA_SUMMARY_JOURNAL_DIR";
export const LUNA_SUMMARY_CANONICAL_JOURNAL_DIR =
  "/opt/cursor/artifacts/luna-summary-journal-v1" as const;
export const LUNA_SUMMARY_JOURNAL_DIR_PREFIX = "luna-summary-journal";
export const LUNA_SUMMARY_LIVE_APPROVAL_STATUS = "NOT_APPROVED" as const;
export const LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS = [
  "b0bdd7591f55845993aa03fcc871fdc2fa07a1ae5c8c6ece10f47f805b7579ef",
  "482b02d3be9680b79c8132904b944584d67dddc4e222d396196b3797ec7410b0",
  "f56c75ebaa224aaea8ce4ec32d039649c953dc1e4a6a2af6b45ad4db9547631c",
  "a510be4f863a37ddd7798a79376b9141e52c38dce85f4b5c7e2615d564fd1171",
  "d60b94b653a61713757fd08afa0171bc3574c578288e78eb1901e1ac1773c295",
  "17e975a68f247d53ad1c5ecbf7736e40ea8cbc0be1097660efd5beaef9ba7ee3",
  "1531941805edec6c7915ab7a070c9fab8313212f62496123b72dfdaba93a671a",
  "f9e66e2a5cec971ccc6eef9191863ed78aff1c7de16ba657346763562c2aadc6",
  "55b48b897cbf8108a8e6d95000b736a180a252f5c7db1f73e05db8a97fc3f371",
  "fdebfff8d04a74969cba22ed1872f8be0d7993b7ecb72fb4cad87e4d78ac1f45",
] as const;
export const LUNA_SUMMARY_LIVE_WIRE_CONTRACT = {
  model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
  endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  temperature: 0.3,
  stream: false,
  disableReasoning: true,
  maxTokens: null,
  requestKind: LUNA_SUMMARY_REQUEST_KIND,
} as const;

export function lunaSummaryLiveExecuteManifestFingerprint(): string {
  return paidRunnerRequestBodyFingerprint({
    version: 2,
    mode: "LIVE_EXECUTE",
    mainSha: LUNA_SUMMARY_EXECUTE_MAIN_SHA,
    prepareManifestFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST,
    scriptHash: LUNA_SUMMARY_APPROVED_SCRIPT_HASH,
    liveBatchFingerprints: [...LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS],
    prepareBatchFingerprints: [...LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS],
    approvalStatus: LUNA_SUMMARY_LIVE_APPROVAL_STATUS,
    temperature: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.temperature,
    stream: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.stream,
    disableReasoning: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.disableReasoning,
    maxTokens: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.maxTokens,
    journalCanonicalDirectory: LUNA_SUMMARY_CANONICAL_JOURNAL_DIR,
  });
}

export const LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST =
  lunaSummaryLiveExecuteManifestFingerprint();

export type LunaExecuteDenialReason =
  | LunaSummaryDenialReason
  | "REQUEST_IDENTITY_MISMATCH"
  | "JOURNAL_STORE_UNAVAILABLE"
  | "JOURNAL_PATH_MISSING"
  | "JOURNAL_PATH_UNSAFE"
  | "PRIOR_RESERVED_HISTORY"
  | "SUMMARY_VALIDATION_FAILED"
  | "MISSING_EXPERIMENT_KEY"
  | "REAL_NETWORK_NOT_ENABLED";

export type LunaDurableStatus =
  | "PREPARED"
  | "SENT"
  | "SETTLED"
  | "UNKNOWN_UNRESOLVED"
  | "FAILED"
  | "EMPTY_STOP"
  | "BLOCKED";

export type LunaDurableJournalEntry = {
  batchIndex: number;
  turnStart: number;
  turnEnd: number;
  requestKind: string;
  requestFingerprint: string;
  status: LunaDurableStatus;
  accepted: boolean | null;
  rejectedReason: string | null;
  rawSummaryFingerprint: string | null;
  storedSummaryFingerprint: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  billedUsd: number | null;
  settlementSource: "provider_exact" | "estimate_not_bill" | "unsettled" | "missing";
  providerRequestId: string | null;
  networkAttempts: number;
};

export type LunaDurableJournal = {
  manifestFingerprint: string;
  requestIdentityFingerprint: string;
  executed: boolean;
  networkAttempts: number;
  entries: LunaDurableJournalEntry[];
};

export type LunaCompletionFn = typeof callOpenRouterCompletion;

export type LunaExecuteGate =
  | { ok: true; paidPostsAllowed: 10; reason: "AUTHORIZED_BOUNDED" }
  | { ok: false; paidPostsAllowed: 0; reason: LunaExecuteDenialReason };

function emptyJournal(fingerprint: string, requestIdentityFingerprint: string): LunaDurableJournal {
  return {
    manifestFingerprint: fingerprint,
    requestIdentityFingerprint,
    executed: false,
    networkAttempts: 0,
    entries: [],
  };
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveLunaSummaryJournalDirectory(input?: {
  journalDirectory?: string | null;
  env?: NodeJS.ProcessEnv;
}):
  | { ok: true; directory: string }
  | { ok: false; reason: "JOURNAL_PATH_MISSING" | "JOURNAL_PATH_UNSAFE" } {
  const env = input?.env ?? process.env;
  const raw = input?.journalDirectory?.trim() || env[LUNA_SUMMARY_JOURNAL_DIR_ENV]?.trim() || "";
  if (!raw) return { ok: false, reason: "JOURNAL_PATH_MISSING" };
  if (raw.includes("\0")) return { ok: false, reason: "JOURNAL_PATH_UNSAFE" };
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) return { ok: false, reason: "JOURNAL_PATH_UNSAFE" };
  if (!path.basename(resolved).startsWith(LUNA_SUMMARY_JOURNAL_DIR_PREFIX)) {
    return { ok: false, reason: "JOURNAL_PATH_UNSAFE" };
  }
  const allowed =
    isInsideDirectory(path.resolve(tmpdir()), resolved) ||
    isInsideDirectory(path.resolve("/opt/cursor/artifacts"), resolved);
  if (!allowed) return { ok: false, reason: "JOURNAL_PATH_UNSAFE" };
  const dataDir = env.DATA_DIR?.trim();
  if (dataDir && isInsideDirectory(path.resolve(dataDir), resolved)) {
    return { ok: false, reason: "JOURNAL_PATH_UNSAFE" };
  }
  if (
    isInsideDirectory(path.resolve("/workspace/data"), resolved) ||
    isInsideDirectory(path.resolve(process.cwd(), "data"), resolved)
  ) {
    return { ok: false, reason: "JOURNAL_PATH_UNSAFE" };
  }
  return { ok: true, directory: resolved };
}

function lunaJournalPath(directory: string, fingerprint: string): string {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("JOURNAL_FINGERPRINT_MISMATCH");
  }
  return path.join(directory, `luna-summary-journal-${fingerprint}.json`);
}

export function recoverLunaLeftoverSent(journal: LunaDurableJournal): boolean {
  let recovered = false;
  for (const entry of journal.entries) {
    if (entry.status === "SENT") {
      entry.status = "UNKNOWN_UNRESOLVED";
      entry.settlementSource = "unsettled";
      entry.rejectedReason = "UNKNOWN_UNRESOLVED_NO_RESEND";
      recovered = true;
    }
  }
  return recovered;
}

export function journalHasReservedHistory(journal: LunaDurableJournal): boolean {
  return journal.executed || journal.entries.some((entry) =>
    entry.status === "SENT" ||
    entry.status === "SETTLED" ||
    entry.status === "FAILED" ||
    entry.status === "EMPTY_STOP" ||
    entry.status === "UNKNOWN_UNRESOLVED"
  );
}

export function createLunaDurableJournalStore(directory: string): {
  lockStore: PaidRunnerJournalStore;
  artifactStore: PaidRunnerArtifactStore;
  load(fingerprint: string): LunaDurableJournal | null;
  persist(journal: LunaDurableJournal): void;
} {
  const resolved = resolveLunaSummaryJournalDirectory({ journalDirectory: directory });
  if (!resolved.ok) {
    throw new Error(resolved.reason);
  }
  mkdirSync(resolved.directory, { recursive: true, mode: 0o700 });
  directory = resolved.directory;
  const lockStore = createFilePaidRunnerJournalStore(directory);
  const artifactStore = createFilePaidRunnerArtifactStore(directory);
  return {
    lockStore,
    artifactStore,
    load(fingerprint) {
      const file = lunaJournalPath(directory, fingerprint);
      if (!existsSync(file)) return null;
      const parsed = JSON.parse(readFileSync(file, "utf8")) as LunaDurableJournal;
      if (!parsed || parsed.manifestFingerprint !== fingerprint || !Array.isArray(parsed.entries)) {
        throw new Error("CORRUPT_JOURNAL");
      }
      return {
        ...parsed,
        entries: parsed.entries.map((entry) => ({ ...entry })),
      };
    },
    persist(journal) {
      const dest = lunaJournalPath(directory, journal.manifestFingerprint);
      const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
      const fd = openSync(tmp, "w", 0o600);
      try {
        writeFileSync(fd, `${JSON.stringify(journal)}\n`, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, dest);
      const dirFd = openSync(directory, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    },
  };
}

export function countReservedNetworkAttempts(journal: LunaDurableJournal): number {
  return journal.entries.filter((entry) =>
    entry.status === "SENT" ||
    entry.status === "SETTLED" ||
    entry.status === "UNKNOWN_UNRESOLVED" ||
    entry.status === "FAILED" ||
    entry.status === "EMPTY_STOP"
  ).length;
}

export async function captureLiveSealBatchFingerprints(): Promise<string[]> {
  const fingerprints: string[] = [];
  __setSummarizeTurnBatchCallerForTests(async (system, history, _trace, requestKind) => {
    if (requestKind === LUNA_SUMMARY_REQUEST_KIND) {
      fingerprints.push(
        paidRunnerRequestBodyFingerprint({
          model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
          endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
          requestKind,
          system,
          user: history.map((message) => message.content).join("\n"),
        })
      );
    }
    throw new Error("PREPARE_MODE_DOES_NOT_POST");
  });
  try {
    for (let start = 1; start <= 50; start += 5) {
      const entries = AB_SCRIPT.filter((turn) => turn.turn >= start && turn.turn <= start + 4).map(
        (turn) => ({
          turnIndex: turn.turn,
          turn: { user: turn.user, assistant: turn.assistant },
        })
      );
      const dialogue = __formatBatchDialogueForTests(entries, AB_CHARACTER_NAME);
      const openingPrelude =
        start === 1
          ? `[OPENING/PRELUDE CONTEXT — not source turn 1]\n${OPENING_TURN_USER}\n${AB_GREETING}`
          : null;
      await summarizeTurnBatch({
        dialogue,
        charName: AB_CHARACTER_NAME,
        startTurn: start,
        endTurn: start + 4,
        openingPrelude,
        characterIdentity: AB_CHARACTER_CARD,
        userPersona: AB_PERSONA_CARD,
      });
    }
  } finally {
    __setSummarizeTurnBatchCallerForTests(null);
  }
  return fingerprints;
}

export async function verifyLunaRequestIdentity(): Promise<{
  ok: boolean;
  reason: LunaExecuteDenialReason | null;
  scriptHash: string;
  prepareManifestFingerprint: string;
  liveExecuteManifestFingerprint: string;
  liveApprovalStatus: typeof LUNA_SUMMARY_LIVE_APPROVAL_STATUS;
  batchFingerprints: string[];
  liveSealFingerprints: string[];
  liveSealMatchesPrepareCapture: boolean;
  liveSealMatchesLivePins: boolean;
  shaOnlyDifference: {
    pinnedPrepareMainSha: string;
    currentMainSha: typeof LUNA_SUMMARY_EXECUTE_MAIN_SHA;
    requestPayloadUnchanged: boolean;
  };
}> {
  const manifest = await buildLunaSummaryPrepareManifest();
  const scriptHash = harborScriptHash();
  const batchFingerprints = manifest.batches.map((batch) => batch.requestFingerprint);
  const liveSealFingerprints = await captureLiveSealBatchFingerprints();
  const prepareCaptureUnchanged =
    scriptHash === LUNA_SUMMARY_APPROVED_SCRIPT_HASH &&
    batchFingerprints.length === LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS.length &&
    batchFingerprints.every((fp, index) => fp === LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS[index]) &&
    manifest.modelId === "gpt-6-luna" &&
    manifest.wireModel === "gpt-6-luna" &&
    manifest.endpoint === CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL &&
    manifest.requestKind === LUNA_SUMMARY_REQUEST_KIND &&
    manifest.outputTokenPolicy.productionMaxTokensApplied === null &&
    manifest.plannedPosts === LUNA_SUMMARY_PLANNED_POSTS &&
    manifest.maximumNetworkAttempts === LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS &&
    manifest.approvalStatus === "NOT_APPROVED";
  const liveSealMatchesPrepareCapture = liveSealFingerprints.every(
    (fp, index) => fp === LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS[index]
  );
  const liveSealMatchesLivePins =
    liveSealFingerprints.length === LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS.length &&
    liveSealFingerprints.every((fp, index) => fp === LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS[index]);
  const liveIdentityOk = prepareCaptureUnchanged && liveSealMatchesLivePins;
  return {
    ok: liveIdentityOk,
    reason: liveIdentityOk ? null : "REQUEST_IDENTITY_MISMATCH",
    scriptHash,
    prepareManifestFingerprint: manifest.manifestFingerprint,
    liveExecuteManifestFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
    liveApprovalStatus: LUNA_SUMMARY_LIVE_APPROVAL_STATUS,
    batchFingerprints,
    liveSealFingerprints,
    liveSealMatchesPrepareCapture,
    liveSealMatchesLivePins,
    shaOnlyDifference: {
      pinnedPrepareMainSha: manifest.mainSha,
      currentMainSha: LUNA_SUMMARY_EXECUTE_MAIN_SHA,
      requestPayloadUnchanged: prepareCaptureUnchanged,
    },
  };
}

export function evaluateLunaSummaryExecuteGate(input: {
  userCostApproved?: boolean;
  experimentKey?: string | null;
  env?: NodeJS.ProcessEnv;
  identityOk: boolean;
  isolatedDb: boolean;
  allowRealNetwork?: boolean;
  requireLiveApproval?: boolean;
}): LunaExecuteGate {
  const env = input.env ?? process.env;
  const prepare = evaluateLunaSummaryGate({
    mode: "AUTHORIZED",
    userCostApproved: input.userCostApproved,
    experimentKey: input.experimentKey,
    env,
    approvedManifestFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST,
    expectedManifestFingerprint: LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST,
  });
  if (prepare.reason === "MISSING_USER_COST_APPROVAL" || prepare.reason === "MISSING_EXPERIMENT_KEY" || prepare.reason === "PRODUCTION_KEY_FORBIDDEN" || prepare.reason === "MANIFEST_FINGERPRINT_MISMATCH") {
    return { ok: false, paidPostsAllowed: 0, reason: prepare.reason };
  }
  if (!input.experimentKey?.trim()) {
    return { ok: false, paidPostsAllowed: 0, reason: "MISSING_EXPERIMENT_KEY" };
  }
  if (
    experimentSecretUsesProductionKey(input.experimentKey, env) ||
    RP_QUALITY_PAID_PRODUCTION_KEY_ENVS.some((key) => env[key]?.trim() === input.experimentKey?.trim())
  ) {
    return { ok: false, paidPostsAllowed: 0, reason: "PRODUCTION_KEY_FORBIDDEN" };
  }
  if (!input.identityOk) {
    return { ok: false, paidPostsAllowed: 0, reason: "REQUEST_IDENTITY_MISMATCH" };
  }
  if (!input.isolatedDb) {
    return { ok: false, paidPostsAllowed: 0, reason: "ISOLATED_TEST_DB_REQUIRED" };
  }
  if (input.requireLiveApproval === true && LUNA_SUMMARY_LIVE_APPROVAL_STATUS !== "APPROVED") {
    return { ok: false, paidPostsAllowed: 0, reason: "APPROVAL_STATUS_NOT_APPROVED" };
  }
  if (input.allowRealNetwork !== true) {
    return { ok: false, paidPostsAllowed: 0, reason: "REAL_NETWORK_NOT_ENABLED" };
  }
  return { ok: true, paidPostsAllowed: 10, reason: "AUTHORIZED_BOUNDED" };
}

export function createLunaSummaryLiveCaller(opts: {
  experimentKey: string;
  env?: NodeJS.ProcessEnv;
  journal: LunaDurableJournal;
  persist: (journal: LunaDurableJournal) => void;
  artifactStore: PaidRunnerArtifactStore;
  completion?: LunaCompletionFn;
  allowRealNetwork?: boolean;
}): RollingSummaryLlmCaller & { networkPosts: number } {
  const env = opts.env ?? process.env;
  const completion = opts.completion;
  const caller = (async (system, history, _trace, requestKind) => {
    if (requestKind !== LUNA_SUMMARY_REQUEST_KIND) {
      throw new Error("INTERNAL_RETRY_NETWORK_FORBIDDEN");
    }
    if (opts.journal.entries.some((entry) => entry.status === "UNKNOWN_UNRESOLVED")) {
      throw new Error("UNKNOWN_UNRESOLVED_NO_RESEND");
    }
    if (opts.journal.executed) {
      throw new Error("DUPLICATE_MANIFEST_EXECUTION");
    }
    const reserved = countReservedNetworkAttempts(opts.journal);
    if (reserved >= LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS) {
      throw new Error("NETWORK_ATTEMPT_LIMIT");
    }
    if (
      !opts.experimentKey.trim() ||
      experimentSecretUsesProductionKey(opts.experimentKey, env) ||
      RP_QUALITY_PAID_PRODUCTION_KEY_ENVS.some((key) => env[key]?.trim() === opts.experimentKey.trim())
    ) {
      throw new Error("PRODUCTION_KEY_FORBIDDEN");
    }
    const user = history.map((message) => message.content).join("\n");
    const requestFingerprint = paidRunnerRequestBodyFingerprint({
      model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      requestKind,
      system,
      user,
    });
    const expectedFingerprint =
      LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS[countReservedNetworkAttempts(opts.journal)];
    if (
      opts.allowRealNetwork === true &&
      !opts.completion &&
      expectedFingerprint &&
      requestFingerprint !== expectedFingerprint
    ) {
      throw new Error("REQUEST_IDENTITY_MISMATCH");
    }
    const existing = opts.journal.entries.find(
      (entry) =>
        entry.requestFingerprint === requestFingerprint &&
        (entry.status === "SENT" ||
          entry.status === "SETTLED" ||
          entry.status === "UNKNOWN_UNRESOLVED")
    );
    if (existing) {
      throw new Error("DUPLICATE_MANIFEST_EXECUTION");
    }
    const batchIndex = reserved + 1;
    const entry: LunaDurableJournalEntry = {
      batchIndex,
      turnStart: (batchIndex - 1) * 5 + 1,
      turnEnd: batchIndex * 5,
      requestKind,
      requestFingerprint,
      status: "SENT",
      accepted: null,
      rejectedReason: null,
      rawSummaryFingerprint: null,
      storedSummaryFingerprint: null,
      promptTokens: null,
      completionTokens: null,
      billedUsd: null,
      settlementSource: "unsettled",
      providerRequestId: null,
      networkAttempts: reserved + 1,
    };
    opts.journal.entries.push(entry);
    opts.journal.networkAttempts = countReservedNetworkAttempts(opts.journal);
    opts.persist(opts.journal);
    caller.networkPosts = opts.journal.networkAttempts;

    if (!completion && opts.allowRealNetwork !== true) {
      entry.status = "BLOCKED";
      entry.rejectedReason = "REAL_NETWORK_NOT_ENABLED";
      opts.persist(opts.journal);
      throw new Error("REAL_NETWORK_NOT_ENABLED");
    }
    const post = completion ?? callOpenRouterCompletion;
    try {
      const result = await post({
        system,
        history,
        model: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.model,
        temperature: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.temperature,
        maxTokens: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.maxTokens,
        disableReasoning: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.disableReasoning,
        requestKind: LUNA_SUMMARY_LIVE_WIRE_CONTRACT.requestKind,
        cheaperInferenceApiKeyOverride: opts.experimentKey,
      });
      const text = result.text ?? "";
      entry.promptTokens = result.usage?.inputTokens ?? null;
      entry.completionTokens = result.usage?.outputTokens ?? null;
      entry.providerRequestId = result.usage?.providerRequestId ?? null;
      entry.billedUsd = result.usage?.cheaperInferenceBilledCostUsd ?? null;
      entry.settlementSource =
        entry.billedUsd != null ? "provider_exact" : result.usage?.estimated ? "estimate_not_bill" : "unsettled";
      if (!text.trim()) {
        entry.status = "EMPTY_STOP";
        entry.accepted = false;
        entry.rejectedReason = "EMPTY_SUMMARY_STOP";
        opts.persist(opts.journal);
        throw new Error("EMPTY_SUMMARY_STOP");
      }
      entry.status = "SETTLED";
      entry.accepted = null;
      entry.rawSummaryFingerprint = paidRunnerArtifactFingerprint(text);
      opts.artifactStore.persist({
        requestOrder: batchIndex,
        fingerprint: entry.rawSummaryFingerprint,
        text,
      });
      opts.persist(opts.journal);
      return { text };
    } catch (error) {
      if (entry.status === "SENT") {
        const message = error instanceof Error ? error.message : String(error);
        const unresolved =
          error instanceof CompatibleCompletionError === false &&
          /timeout|ETIMEDOUT|ECONNRESET|aborted|fetch failed|network/i.test(message);
        entry.status = unresolved ? "UNKNOWN_UNRESOLVED" : "FAILED";
        entry.accepted = false;
        entry.rejectedReason = unresolved ? "UNKNOWN_UNRESOLVED_NO_RESEND" : message.slice(0, 300);
        entry.settlementSource = unresolved ? "unsettled" : entry.settlementSource;
        opts.persist(opts.journal);
        if (unresolved) throw new Error("UNKNOWN_UNRESOLVED_NO_RESEND");
      }
      throw error;
    }
  }) as RollingSummaryLlmCaller & { networkPosts: number };
  caller.networkPosts = opts.journal.networkAttempts;
  return caller;
}

export async function runAuthorizedLunaSummaryExperiment(input: {
  userCostApproved: boolean;
  experimentKey?: string | null;
  env?: NodeJS.ProcessEnv;
  journalDirectory: string;
  allowRealNetwork?: boolean;
  completion?: LunaCompletionFn;
}): Promise<{
  executed: boolean;
  paidPosts: number;
  networkPosts: number;
  sealedRounds: number;
  frontier: number;
  abortReason: LunaExecuteDenialReason | null;
  journal: LunaDurableJournal;
  identity: Awaited<ReturnType<typeof verifyLunaRequestIdentity>>;
  globalMemory: string;
  armAMemory: string;
  oracleWrittenToDb: boolean;
  answerKeyLeakedIntoArmA: boolean;
}> {
  const journalDir = resolveLunaSummaryJournalDirectory({
    journalDirectory: input.journalDirectory,
    env: input.env,
  });
  const identity = await verifyLunaRequestIdentity();
  const emptyAbort = (
    abortReason: LunaExecuteDenialReason,
    journal: LunaDurableJournal = emptyJournal(
      LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
      LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST
    )
  ) => ({
    executed: false,
    paidPosts: 0,
    networkPosts: journal.networkAttempts,
    sealedRounds: 0,
    frontier: 0,
    abortReason,
    journal,
    identity,
    globalMemory: "",
    armAMemory: "",
    oracleWrittenToDb: false,
    answerKeyLeakedIntoArmA: false,
  });
  if (!journalDir.ok) {
    return emptyAbort(journalDir.reason);
  }
  const isolated = (() => {
    try {
      assertIsolatedTestDatabaseActive();
      return true;
    } catch {
      return false;
    }
  })();
  const paying = input.allowRealNetwork === true && !input.completion;
  const gate = evaluateLunaSummaryExecuteGate({
    userCostApproved: input.userCostApproved,
    experimentKey: input.experimentKey,
    env: input.env,
    identityOk: paying ? identity.ok : identity.shaOnlyDifference.requestPayloadUnchanged,
    isolatedDb: isolated,
    allowRealNetwork: paying || Boolean(input.completion),
    requireLiveApproval: paying,
  });
  const fingerprint = LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST;
  const store = createLunaDurableJournalStore(journalDir.directory);
  const lock = store.lockStore.tryAcquireExclusiveLock(fingerprint);
  if (!lock.ok) {
    return emptyAbort(lock.reason);
  }
  try {
    const journal = store.load(fingerprint) ?? emptyJournal(fingerprint, fingerprint);
    if (journalHasReservedHistory(journal)) {
      return emptyAbort("PRIOR_RESERVED_HISTORY", journal);
    }
    if (!gate.ok) {
      return emptyAbort(gate.reason, journal);
    }
    seedHarborExperimentChat();
    const caller = createLunaSummaryLiveCaller({
      experimentKey: input.experimentKey!,
      env: input.env,
      journal,
      persist: (next) => store.persist(next),
      artifactStore: store.artifactStore,
      completion: input.completion,
      allowRealNetwork: input.allowRealNetwork,
    });
    __setSummarizeTurnBatchCallerForTests(caller);
    let sealedRounds = 0;
    let abortReason: LunaExecuteDenialReason | null = null;
    try {
      for (let round = 0; round < 12; round += 1) {
        try {
          const sealed = await processRollingSummaryBatch({
            chatId: AB_CHAT_ID,
            userId: AB_USER_ID,
            characterId: AB_CHARACTER_ID,
            charName: AB_CHARACTER_NAME,
            characterIdentity: AB_CHARACTER_CARD,
            userPersona: AB_PERSONA_CARD,
            tier: "pro",
            memoryCapacity: MEMORY_CAPACITY_FIXED,
          });
          if (!sealed) {
            const lastEntry = journal.entries[journal.entries.length - 1];
            if (lastEntry?.status === "SETTLED" && lastEntry.accepted !== true) {
              lastEntry.accepted = false;
              lastEntry.rejectedReason = lastEntry.rejectedReason ?? "SUMMARY_VALIDATION_FAILED";
              store.persist(journal);
              abortReason = "SUMMARY_VALIDATION_FAILED";
            } else if (sealedRounds < LUNA_SUMMARY_PLANNED_POSTS) {
              abortReason = journal.entries.some((entry) => entry.status === "UNKNOWN_UNRESOLVED")
                ? "UNKNOWN_UNRESOLVED_NO_RESEND"
                : "EMPTY_SUMMARY_STOP";
            }
            break;
          }
          const records = listMemoryRecordsForChat(AB_CHAT_ID).filter((record) => !record.inactive);
          const confirmed = listMemoryRecordsForChat(AB_CHAT_ID).filter((record) => !record.inactive);
          const last = records[records.length - 1];
          const sealedRow = confirmed[confirmed.length - 1];
          const lastEntry = journal.entries[journal.entries.length - 1];
          if (
            lastEntry &&
            last?.summary &&
            sealedRow?.summary === last.summary
          ) {
            lastEntry.storedSummaryFingerprint = paidRunnerArtifactFingerprint(sealedRow.summary);
            lastEntry.accepted = true;
            store.persist(journal);
            store.artifactStore.persist({
              requestOrder: lastEntry.batchIndex + 100,
              fingerprint: lastEntry.storedSummaryFingerprint,
              text: sealedRow.summary,
            });
          } else if (lastEntry) {
            lastEntry.accepted = false;
            lastEntry.rejectedReason = "SUMMARY_VALIDATION_FAILED";
            store.persist(journal);
            abortReason = "SUMMARY_VALIDATION_FAILED";
            break;
          }
          sealedRounds += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const lastEntry = journal.entries[journal.entries.length - 1];
          if (lastEntry?.status === "SETTLED" && lastEntry.accepted !== true) {
            lastEntry.accepted = false;
            lastEntry.rejectedReason = lastEntry.rejectedReason ?? "SUMMARY_VALIDATION_FAILED";
            store.persist(journal);
          }
          if (message.includes("EMPTY_SUMMARY_STOP")) abortReason = "EMPTY_SUMMARY_STOP";
          else if (message.includes("INTERNAL_RETRY_NETWORK_FORBIDDEN")) abortReason = "SUMMARY_VALIDATION_FAILED";
          else if (message.includes("NETWORK_ATTEMPT_LIMIT")) abortReason = "NETWORK_ATTEMPT_LIMIT";
          else if (message.includes("UNKNOWN_UNRESOLVED_NO_RESEND")) abortReason = "UNKNOWN_UNRESOLVED_NO_RESEND";
          else if (message.includes("DUPLICATE_MANIFEST_EXECUTION")) abortReason = "DUPLICATE_MANIFEST_EXECUTION";
          else if (message.includes("REQUEST_IDENTITY_MISMATCH")) abortReason = "REQUEST_IDENTITY_MISMATCH";
          else if (message.includes("SUMMARY_VALIDATION_FAILED")) abortReason = "SUMMARY_VALIDATION_FAILED";
          else throw error;
          break;
        }
      }
    } finally {
      __setSummarizeTurnBatchCallerForTests(null);
    }
    const records = listMemoryRecordsForChat(AB_CHAT_ID).filter((record) => !record.inactive);
    const frontier = highestContiguousCompletedTurn(records, AB_COMPLETED_TURNS);
    if (sealedRounds === 10 && frontier === AB_COMPLETED_TURNS) {
      journal.executed = true;
      store.persist(journal);
    }
    const global = resolveGlobalCurrentMemory(AB_CHAT_ID, MEMORY_CAPACITY_FIXED);
    const injection = await buildMemoryContextForChat({
      chatId: AB_CHAT_ID,
      userId: AB_USER_ID,
      characterId: AB_CHARACTER_ID,
      tier: "pro",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: AB_PROBES[0]!.user,
      modelId: "deepseek-v4.1-flash",
    });
    const armA = buildContext({
      charName: AB_CHARACTER_NAME,
      chunks: harborCharacterChunks(),
      userNickname: AB_PERSONA_NAME,
      userPersona: AB_PERSONA_CARD,
      longTermMemory: injection.text,
      shortTermHistory: [],
      currentUserMessage: AB_FREEZE_USER,
      nsfw: false,
      provider: "cheaperinference",
      modelId: "deepseek-v4.1-flash",
      completedTurns: AB_COMPLETED_TURNS,
      summarizedTurnCount: frontier,
    });
    const oracle = buildOracleDiagnosticMemory();
    const storedJoined = records.map((record) => record.summary).join("\n");
    return {
      executed: journal.executed,
      paidPosts: input.allowRealNetwork === true && !input.completion ? journal.networkAttempts : 0,
      networkPosts: journal.networkAttempts,
      sealedRounds,
      frontier,
      abortReason,
      journal,
      identity,
      globalMemory: global.text,
      armAMemory: (armA.meta.trackedSections ?? []).find((section) => section.id === "current-memory")?.text ?? injection.text,
      oracleWrittenToDb: storedJoined.includes("[진단 메모]"),
      answerKeyLeakedIntoArmA: armA.systemPrompt.includes(oracle) || armA.systemPrompt.includes("[진단 메모]"),
    };
  } finally {
    lock.lock.release();
  }
}

export function lunaExecuteExperimentKeyPresent(env: NodeJS.ProcessEnv = process.env): {
  present: boolean;
  equalsProduction: boolean;
  envName: typeof LUNA_SUMMARY_EXPERIMENT_KEY_ENV;
} {
  const key = env[LUNA_SUMMARY_EXPERIMENT_KEY_ENV]?.trim() ?? "";
  return {
    present: Boolean(key),
    equalsProduction: experimentSecretUsesProductionKey(key, env),
    envName: LUNA_SUMMARY_EXPERIMENT_KEY_ENV,
  };
}
