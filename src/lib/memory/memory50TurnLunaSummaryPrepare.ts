/**
 * PREPARE / NO_POST path for a later 10-call GPT-6 Luna rolling-summary run.
 * Reuses the live seal, Global Memory, prompt builder, CheaperInference
 * completion adapter, and isolated-DB helper. Not a second memory, routing,
 * or billing owner. Live network execute is not shipped in this PR.
 */
import { createHash } from "node:crypto";
import {
  resolveBackgroundMaxInputTokens,
  resolveBackgroundMaxOutputTokens,
  resolveBackgroundPrimaryModelId,
} from "@/lib/ai";
import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL } from "@/lib/cheaperInferenceConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import {
  RP_QUALITY_PAID_PRODUCTION_KEY_ENVS,
  experimentSecretUsesProductionKey,
  paidRunnerRequestBodyFingerprint,
} from "@/lib/rpQualityPaidRunner";
import { paidRunnerArtifactFingerprint } from "@/lib/rpQualityPaidRunnerArtifacts";
import { assertIsolatedTestDatabaseActive } from "@/lib/test/isolatedTestDatabase";
import { estimateTokens, estimateTokensFromCharCount } from "@/lib/tokenEstimate";
import { AB_ANSWER_KEY } from "./memory50TurnAbAnswerKey";
import {
  AB_CHARACTER_CARD,
  AB_CHARACTER_NAME,
  AB_GREETING,
  AB_PERSONA_CARD,
  AB_SCRIPT,
  AB_SCRIPT_ID,
} from "./memory50TurnAbScript";
import {
  AB_CHAT_ID,
  AB_CHARACTER_ID,
  AB_COMPLETED_TURNS,
  AB_USER_ID,
} from "./memory50TurnAbRunner";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { ROLLING_SUMMARY_MAX_CHARS } from "./memory-constants";
import {
  __formatBatchDialogueForTests,
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  summarizeTurnBatch,
  type RollingSummaryLlmCaller,
} from "./memory-rolling-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { listMemoryRecordsForChat } from "./memory-turn-summary";

export const LUNA_SUMMARY_MAIN_SHA =
  "3eea993444daaa0060843ce7d8ac29ae6025f182" as const;
export const LUNA_SUMMARY_PREPARE_MODE = "PREPARE" as const;
export const LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS = 10;
export const LUNA_SUMMARY_PLANNED_POSTS = 10;
export const LUNA_SUMMARY_REQUEST_KIND = "background-memory-extract" as const;
export const LUNA_SUMMARY_EXPERIMENT_KEY_ENV = "MEMORY_LUNA_SUMMARY_EXPERIMENT_KEY";
export const LUNA_SUMMARY_LIVE_EXECUTE_SHIPPED = false;
export const LUNA_SUMMARY_APPROVED_SCRIPT_HASH =
  "c7d1c0a1a060526b99538e98e58fddc75fae42499990ecf50fa1c961997394e8" as const;
export const LUNA_SUMMARY_APPROVED_PREPARE_MANIFEST =
  "8d78a6d473961d5806865046182917ccc6d5610675b5f5f611c9630957b1272b" as const;
export const LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS = [
  "de7bd2ffe3ad2b8dcf9740228674105eb9f33d8d82d46a373bbc577f14749372",
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

export type LunaSummaryMode = "PREPARE" | "AUTHORIZED";

export type LunaSummaryDenialReason =
  | "PREPARE_MODE_DOES_NOT_POST"
  | "LIVE_EXECUTE_NOT_SHIPPED"
  | "MISSING_USER_COST_APPROVAL"
  | "APPROVAL_STATUS_NOT_APPROVED"
  | "MANIFEST_FINGERPRINT_MISMATCH"
  | "PRODUCTION_KEY_FORBIDDEN"
  | "MISSING_EXPERIMENT_KEY"
  | "ISOLATED_TEST_DB_REQUIRED"
  | "DUPLICATE_MANIFEST_EXECUTION"
  | "CONCURRENT_LAUNCH"
  | "NETWORK_ATTEMPT_LIMIT"
  | "INTERNAL_RETRY_NETWORK_FORBIDDEN"
  | "UNKNOWN_UNRESOLVED_NO_RESEND"
  | "EMPTY_SUMMARY_STOP";

export type LunaSummaryGateInput = {
  mode: LunaSummaryMode;
  userCostApproved?: boolean;
  approvedManifestFingerprint?: string | null;
  expectedManifestFingerprint?: string | null;
  experimentKey?: string | null;
  env?: NodeJS.ProcessEnv;
};

export type LunaSummaryGate =
  | { ok: true; mode: "PREPARE"; paidPostsAllowed: 0; reason: "PREPARE_MODE_DOES_NOT_POST" }
  | { ok: false; mode: LunaSummaryMode; paidPostsAllowed: 0; reason: LunaSummaryDenialReason };

export type LunaSummaryBatchRequest = {
  batchIndex: number;
  turnStart: number;
  turnEnd: number;
  requestKind: typeof LUNA_SUMMARY_REQUEST_KIND;
  requestFingerprint: string;
  inputTokens: number;
};

export type LunaSummaryJournalEntry = {
  batchIndex: number;
  turnStart: number;
  turnEnd: number;
  requestKind: string;
  requestFingerprint: string;
  status:
    | "PREPARED"
    | "STUB_ACCEPTED"
    | "BLOCKED"
    | "UNKNOWN_UNRESOLVED"
    | "FAILED"
    | "EMPTY_STOP";
  accepted: boolean | null;
  rejectedReason: string | null;
  rawSummaryFingerprint: string | null;
  storedSummaryFingerprint: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  billedUsd: number | null;
  providerRequestId: string | null;
  settlementSource: "unsettled" | "estimate_not_bill" | "missing";
  networkAttempts: number;
};

export type LunaSummaryPublicManifest = {
  version: 1;
  mode: "PREPARE";
  mainSha: typeof LUNA_SUMMARY_MAIN_SHA;
  scriptId: typeof AB_SCRIPT_ID;
  scriptHash: string;
  liveCanonBound: false;
  modelId: typeof CHEAPER_INFERENCE_GPT_6_LUNA_MODEL;
  wireModel: typeof CHEAPER_INFERENCE_GPT_6_LUNA_MODEL;
  provider: "cheaperinference";
  endpoint: typeof CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL;
  requestKind: typeof LUNA_SUMMARY_REQUEST_KIND;
  plannedPosts: typeof LUNA_SUMMARY_PLANNED_POSTS;
  maximumNetworkAttempts: typeof LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS;
  batches: LunaSummaryBatchRequest[];
  outputTokenPolicy: {
    productionMaxTokensApplied: null;
    resolverDefaultUnused: number;
    acceptedClampChars: number;
    hardMaximumUsd: "UNBOUNDED_WITHOUT_REQUEST_MAX_TOKENS";
  };
  pricingSnapshot: {
    owner: "resolveOpenRouterModelRates";
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
  };
  experimentKeyEvidence: {
    envName: typeof LUNA_SUMMARY_EXPERIMENT_KEY_ENV;
    present: boolean;
    equalsProduction: boolean;
    keyValueStored: false;
  };
  journalStore: {
    owner: "LunaSummaryJournalEntry";
    artifactPath: "memory_50turn_luna_summary_prepare.json";
    storesSecrets: false;
    usageOwners: {
      tokens: "parseCompatibleUsage";
      providerRequestId: "readCompatibleCompletionProviderRequestId";
      billedUsd: "provider usage only — estimate_not_bill until settled";
    };
  };
  approvalStatus: "NOT_APPROVED";
  providerPosts: 0;
  liveExecuteShipped: false;
  manifestFingerprint: string;
};

const executedManifests = new Set<string>();
let launchLock = false;

export function resetLunaSummaryPrepareStateForTests(): void {
  executedManifests.clear();
  launchLock = false;
  __setSummarizeTurnBatchCallerForTests(null);
}

export function harborScriptHash(): string {
  return createHash("sha256")
    .update(JSON.stringify({ id: AB_SCRIPT_ID, turns: AB_SCRIPT }), "utf8")
    .digest("hex");
}

export function evaluateLunaSummaryGate(input: LunaSummaryGateInput): LunaSummaryGate {
  const env = input.env ?? process.env;
  switch (input.mode) {
    case "PREPARE":
      if (input.userCostApproved === true) {
        return { ok: false, mode: input.mode, paidPostsAllowed: 0, reason: "LIVE_EXECUTE_NOT_SHIPPED" };
      }
      return {
        ok: true,
        mode: "PREPARE",
        paidPostsAllowed: 0,
        reason: "PREPARE_MODE_DOES_NOT_POST",
      };
    case "AUTHORIZED":
      if (input.userCostApproved !== true) {
        return { ok: false, mode: input.mode, paidPostsAllowed: 0, reason: "MISSING_USER_COST_APPROVAL" };
      }
      if (!input.experimentKey?.trim()) {
        return { ok: false, mode: input.mode, paidPostsAllowed: 0, reason: "MISSING_EXPERIMENT_KEY" };
      }
      if (
        experimentSecretUsesProductionKey(input.experimentKey, env) ||
        RP_QUALITY_PAID_PRODUCTION_KEY_ENVS.some((key) => env[key]?.trim() === input.experimentKey?.trim())
      ) {
        return { ok: false, mode: input.mode, paidPostsAllowed: 0, reason: "PRODUCTION_KEY_FORBIDDEN" };
      }
      if (
        input.expectedManifestFingerprint &&
        input.approvedManifestFingerprint !== input.expectedManifestFingerprint
      ) {
        return { ok: false, mode: input.mode, paidPostsAllowed: 0, reason: "MANIFEST_FINGERPRINT_MISMATCH" };
      }
      return { ok: false, mode: input.mode, paidPostsAllowed: 0, reason: "LIVE_EXECUTE_NOT_SHIPPED" };
    default: {
      const _never: never = input.mode;
      return { ok: false, mode: "AUTHORIZED", paidPostsAllowed: 0, reason: _never };
    }
  }
}

export function attemptLunaSummaryLiveExecute(input: LunaSummaryGateInput): {
  executed: false;
  paidPosts: 0;
  gate: LunaSummaryGate;
} {
  return {
    executed: false,
    paidPosts: 0,
    gate: evaluateLunaSummaryGate({ ...input, mode: "AUTHORIZED" }),
  };
}

function usd(tokens: number, perMillion: number): number {
  return (tokens / 1_000_000) * perMillion;
}

export function createLunaSummaryCaller(opts: {
  journal: LunaSummaryJournalEntry[];
  stubSummary?: (userContent: string) => string | Promise<string>;
  countStubAsNetwork?: boolean;
  maxNetworkAttempts?: number;
  lastUnknown?: { value: boolean };
}): RollingSummaryLlmCaller & { networkPosts: number } {
  const maxAttempts = opts.maxNetworkAttempts ?? LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS;
  const caller = (async (system, history, _trace, requestKind) => {
    if (opts.lastUnknown?.value) {
      throw new Error("UNKNOWN_UNRESOLVED_NO_RESEND");
    }
    if (requestKind !== LUNA_SUMMARY_REQUEST_KIND) {
      throw new Error("INTERNAL_RETRY_NETWORK_FORBIDDEN");
    }
    if (caller.networkPosts >= maxAttempts) {
      throw new Error("NETWORK_ATTEMPT_LIMIT");
    }
    if (!opts.stubSummary) {
      throw new Error("PREPARE_MODE_DOES_NOT_POST");
    }
    if (opts.countStubAsNetwork) {
      caller.networkPosts += 1;
    }
    const user = history.map((message) => message.content).join("\n");
    const text = await opts.stubSummary(user);
    const firstAttempts = opts.journal.filter(
      (entry) => entry.requestKind === LUNA_SUMMARY_REQUEST_KIND
    ).length;
    const batchIndex = firstAttempts + 1;
    opts.journal.push({
      batchIndex,
      turnStart: (batchIndex - 1) * 5 + 1,
      turnEnd: batchIndex * 5,
      requestKind,
      requestFingerprint: paidRunnerRequestBodyFingerprint({
        model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
        endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        requestKind,
        system,
        user,
      }),
      status: text.trim() ? "STUB_ACCEPTED" : "EMPTY_STOP",
      accepted: Boolean(text.trim()),
      rejectedReason: text.trim() ? null : "EMPTY_SUMMARY_STOP",
      rawSummaryFingerprint: text.trim() ? paidRunnerArtifactFingerprint(text) : null,
      storedSummaryFingerprint: text.trim() ? paidRunnerArtifactFingerprint(text) : null,
      promptTokens: estimateTokens(system) + estimateTokens(user),
      completionTokens: text.trim() ? estimateTokens(text) : 0,
      billedUsd: null,
      providerRequestId: null,
      settlementSource: "unsettled",
      networkAttempts: caller.networkPosts,
    });
    if (!text.trim()) {
      throw new Error("EMPTY_SUMMARY_STOP");
    }
    return { text };
  }) as RollingSummaryLlmCaller & { networkPosts: number };
  caller.networkPosts = 0;
  return caller;
}

export function planLunaSummaryLiveTransport(input: {
  experimentKey: string;
  env?: NodeJS.ProcessEnv;
  approvedManifestFingerprint?: string | null;
  expectedManifestFingerprint?: string | null;
}): {
  shipped: false;
  adapter: "callOpenRouterCompletion";
  productionKeyFallback: false;
  cheaperInferenceApiKeyOverride: "PRESENT_NOT_SERIALIZED";
  maxTokens: null;
  model: typeof CHEAPER_INFERENCE_GPT_6_LUNA_MODEL;
  endpoint: typeof CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL;
  requestKind: typeof LUNA_SUMMARY_REQUEST_KIND;
  denial: LunaSummaryDenialReason;
} {
  const gate = evaluateLunaSummaryGate({
    mode: "AUTHORIZED",
    userCostApproved: true,
    experimentKey: input.experimentKey,
    env: input.env,
    approvedManifestFingerprint: input.approvedManifestFingerprint,
    expectedManifestFingerprint: input.expectedManifestFingerprint,
  });
  return {
    shipped: false,
    adapter: "callOpenRouterCompletion",
    productionKeyFallback: false,
    cheaperInferenceApiKeyOverride: "PRESENT_NOT_SERIALIZED",
    maxTokens: null,
    model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    requestKind: LUNA_SUMMARY_REQUEST_KIND,
    denial: gate.reason,
  };
}

export async function captureLunaSummaryBatchRequests(): Promise<LunaSummaryBatchRequest[]> {
  const firstAttempts: LunaSummaryBatchRequest[] = [];
  __setSummarizeTurnBatchCallerForTests(async (system, history, _trace, requestKind) => {
    if (requestKind === LUNA_SUMMARY_REQUEST_KIND) {
      const user = history.map((message) => message.content).join("\n");
      firstAttempts.push({
        batchIndex: firstAttempts.length + 1,
        turnStart: firstAttempts.length * 5 + 1,
        turnEnd: firstAttempts.length * 5 + 5,
        requestKind: LUNA_SUMMARY_REQUEST_KIND,
        requestFingerprint: paidRunnerRequestBodyFingerprint({
          model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
          endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
          requestKind,
          system,
          user,
        }),
        inputTokens: estimateTokens(system) + estimateTokens(user),
      });
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
      const summary = await summarizeTurnBatch({
        dialogue,
        charName: AB_CHARACTER_NAME,
        startTurn: start,
        endTurn: start + 4,
        openingPrelude: start === 1 ? AB_GREETING : null,
        characterIdentity: AB_CHARACTER_CARD,
        userPersona: AB_PERSONA_CARD,
      });
      if (summary !== "") {
        throw new Error("PREPARE_CAPTURE_MUST_NOT_RETURN_SUMMARY");
      }
    }
  } finally {
    __setSummarizeTurnBatchCallerForTests(null);
  }
  return firstAttempts;
}

export function lunaSummaryManifestFingerprint(
  manifest: Omit<LunaSummaryPublicManifest, "manifestFingerprint" | "providerPosts">
): string {
  return paidRunnerRequestBodyFingerprint({
    version: manifest.version,
    mainSha: manifest.mainSha,
    scriptHash: manifest.scriptHash,
    modelId: manifest.modelId,
    wireModel: manifest.wireModel,
    provider: manifest.provider,
    endpoint: manifest.endpoint,
    requestKind: manifest.requestKind,
    plannedPosts: manifest.plannedPosts,
    maximumNetworkAttempts: manifest.maximumNetworkAttempts,
    batches: manifest.batches,
    productionMaxTokensApplied: manifest.outputTokenPolicy.productionMaxTokensApplied,
    acceptedClampChars: manifest.outputTokenPolicy.acceptedClampChars,
    inputUsdPerMillion: manifest.pricingSnapshot.inputUsdPerMillion,
    outputUsdPerMillion: manifest.pricingSnapshot.outputUsdPerMillion,
    journalStorePath: manifest.journalStore.artifactPath,
    approvalStatus: manifest.approvalStatus,
  });
}

export async function buildLunaSummaryPrepareManifest(
  env: NodeJS.ProcessEnv = process.env
): Promise<LunaSummaryPublicManifest> {
  const batches = await captureLunaSummaryBatchRequests();
  const experimentKey = env[LUNA_SUMMARY_EXPERIMENT_KEY_ENV]?.trim() ?? "";
  const luna = resolveOpenRouterModelRates(CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
  const draft: Omit<LunaSummaryPublicManifest, "manifestFingerprint" | "providerPosts"> = {
    version: 1,
    mode: "PREPARE",
    mainSha: LUNA_SUMMARY_MAIN_SHA,
    scriptId: AB_SCRIPT_ID,
    scriptHash: harborScriptHash(),
    liveCanonBound: false,
    modelId: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
    wireModel: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
    provider: "cheaperinference",
    endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    requestKind: LUNA_SUMMARY_REQUEST_KIND,
    plannedPosts: LUNA_SUMMARY_PLANNED_POSTS,
    maximumNetworkAttempts: LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS,
    batches,
    outputTokenPolicy: {
      productionMaxTokensApplied: null,
      resolverDefaultUnused: resolveBackgroundMaxOutputTokens(LUNA_SUMMARY_REQUEST_KIND),
      acceptedClampChars: ROLLING_SUMMARY_MAX_CHARS,
      hardMaximumUsd: "UNBOUNDED_WITHOUT_REQUEST_MAX_TOKENS",
    },
    pricingSnapshot: {
      owner: "resolveOpenRouterModelRates",
      inputUsdPerMillion: luna.inputUsdPerM,
      outputUsdPerMillion: luna.outputUsdPerM,
    },
    experimentKeyEvidence: {
      envName: LUNA_SUMMARY_EXPERIMENT_KEY_ENV,
      present: Boolean(experimentKey),
      equalsProduction: experimentSecretUsesProductionKey(experimentKey, env),
      keyValueStored: false,
    },
    journalStore: {
      owner: "LunaSummaryJournalEntry",
      artifactPath: "memory_50turn_luna_summary_prepare.json",
      storesSecrets: false,
      usageOwners: {
        tokens: "parseCompatibleUsage",
        providerRequestId: "readCompatibleCompletionProviderRequestId",
        billedUsd: "provider usage only — estimate_not_bill until settled",
      },
    },
    approvalStatus: "NOT_APPROVED",
    liveExecuteShipped: false,
  };
  return {
    ...draft,
    providerPosts: 0,
    manifestFingerprint: lunaSummaryManifestFingerprint(draft),
  };
}

export function estimateLunaSummaryPrepareCost(manifest: LunaSummaryPublicManifest) {
  const inputTokens = manifest.batches.reduce((sum, batch) => sum + batch.inputTokens, 0);
  const acceptedOut = estimateTokensFromCharCount(manifest.outputTokenPolicy.acceptedClampChars);
  const unusedResolverOut = manifest.outputTokenPolicy.resolverDefaultUnused;
  const rates = manifest.pricingSnapshot;
  return {
    plannedPosts: manifest.plannedPosts,
    maximumNetworkAttempts: manifest.maximumNetworkAttempts,
    inputTokens,
    expectedUsdAtAcceptedClamp:
      usd(inputTokens, rates.inputUsdPerMillion) +
      usd(manifest.plannedPosts * acceptedOut, rates.outputUsdPerMillion),
    informationalUsdIfResolverDefaultApplied:
      usd(inputTokens, rates.inputUsdPerMillion) +
      usd(manifest.plannedPosts * unusedResolverOut, rates.outputUsdPerMillion),
    hardMaximumUsd: manifest.outputTokenPolicy.hardMaximumUsd,
    note: "background-memory-extract leaves max_tokens null. The 3072 resolver default is unused by the live caller. This is not a production output-cap change.",
  };
}

export const LUNA_SUMMARY_GRADER_ITEMS = AB_ANSWER_KEY.map((fact) => ({
  id: fact.id,
  sourceTurn: fact.sourceTurn,
  longMemEvalKind:
    fact.status === "never_given"
      ? ("abstention" as const)
      : fact.invalidated
        ? ("knowledge_update" as const)
        : ("factual_recall" as const),
  latestValue: fact.latestValue,
  expectedBehavior: fact.expectedBehavior,
  locomoPlusImplicitApplication: "FOLLOW_UP_MAIN_RP_ONLY" as const,
}));

export async function sealHarborWithLunaCaller(opts: {
  stubSummary: (userContent: string) => string | Promise<string>;
  countStubAsNetwork?: boolean;
  lastUnknown?: { value: boolean };
}): Promise<{
  sealedRounds: number;
  frontier: number;
  networkPosts: number;
  journal: LunaSummaryJournalEntry[];
  abortReason: LunaSummaryDenialReason | null;
}> {
  assertIsolatedTestDatabaseActive();
  if (launchLock) {
    return {
      sealedRounds: 0,
      frontier: 0,
      networkPosts: 0,
      journal: [],
      abortReason: "CONCURRENT_LAUNCH",
    };
  }
  launchLock = true;
  const journal: LunaSummaryJournalEntry[] = [];
  const caller = createLunaSummaryCaller({
    journal,
    stubSummary: opts.stubSummary,
    countStubAsNetwork: opts.countStubAsNetwork,
    lastUnknown: opts.lastUnknown,
  });
  __setSummarizeTurnBatchCallerForTests(caller);
  let sealedRounds = 0;
  let abortReason: LunaSummaryDenialReason | null = null;
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
          if (sealedRounds < LUNA_SUMMARY_PLANNED_POSTS) {
            abortReason =
              journal.some((entry) => entry.status === "EMPTY_STOP")
                ? "EMPTY_SUMMARY_STOP"
                : journal.some((entry) => entry.status === "UNKNOWN_UNRESOLVED")
                  ? "UNKNOWN_UNRESOLVED_NO_RESEND"
                  : "EMPTY_SUMMARY_STOP";
          }
          break;
        }
        sealedRounds += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("EMPTY_SUMMARY_STOP")) {
          abortReason = "EMPTY_SUMMARY_STOP";
          break;
        }
        if (message.includes("INTERNAL_RETRY_NETWORK_FORBIDDEN")) {
          abortReason = "INTERNAL_RETRY_NETWORK_FORBIDDEN";
          break;
        }
        if (message.includes("NETWORK_ATTEMPT_LIMIT")) {
          abortReason = "NETWORK_ATTEMPT_LIMIT";
          break;
        }
        if (message.includes("UNKNOWN_UNRESOLVED_NO_RESEND")) {
          abortReason = "UNKNOWN_UNRESOLVED_NO_RESEND";
          break;
        }
        if (message.includes("CONCURRENT_LAUNCH")) {
          abortReason = "CONCURRENT_LAUNCH";
          break;
        }
        throw error;
      }
    }
  } finally {
    launchLock = false;
    __setSummarizeTurnBatchCallerForTests(null);
  }
  const records = listMemoryRecordsForChat(AB_CHAT_ID).filter((record) => !record.inactive);
  return {
    sealedRounds,
    frontier: highestContiguousCompletedTurn(records, AB_COMPLETED_TURNS),
    networkPosts: caller.networkPosts,
    journal,
    abortReason,
  };
}

export function markLunaSummaryManifestExecuted(fingerprint: string): void {
  executedManifests.add(fingerprint);
}

export function assertLunaSummaryManifestNotExecuted(fingerprint: string): void {
  if (executedManifests.has(fingerprint)) {
    throw new Error("DUPLICATE_MANIFEST_EXECUTION");
  }
}

export function lunaSummaryBackgroundOwners() {
  return {
    summaryRequest: "summarizeTurnBatch",
    seal: "processRollingSummaryBatch",
    backgroundCall: "callBackgroundMemory",
    backgroundModel: "resolveBackgroundPrimaryModelId",
    backgroundInputCap: "resolveBackgroundMaxInputTokens",
    backgroundOutputCap: "resolveBackgroundMaxOutputTokens",
    completionAdapter: "callOpenRouterCompletion",
    experimentKeyOverride: "cheaperInferenceApiKeyOverride",
    isolation: "assertIsolatedTestDatabaseActive",
    usageTokens: "parseCompatibleUsage",
    providerRequestId: "readCompatibleCompletionProviderRequestId",
    assembly: "runHarborAbDryRun / buildContext",
    publishedLunaRate: "resolveOpenRouterModelRates",
    notUsedForLiveKey: "callBackgroundMemory",
  };
}

export function lunaSummaryResolvedCaps() {
  return {
    modelId: resolveBackgroundPrimaryModelId(null),
    extractInputTokens: resolveBackgroundMaxInputTokens(LUNA_SUMMARY_REQUEST_KIND),
    extractOutputTokensResolver: resolveBackgroundMaxOutputTokens(LUNA_SUMMARY_REQUEST_KIND),
    extractOutputTokensAppliedByLiveCaller: null,
    retryRequestKindDoesNotPost: "background-memory-extract-retry",
  };
}
