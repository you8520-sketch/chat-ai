/**
 * Provider-free 50-turn memory A/B experiment runner.
 * Reuses the live summary seal, Global Memory resolver, and prompt builder.
 * This is not a second memory system and not a second billing/routing owner.
 * Paid POSTs stay blocked until a later explicit cost approval.
 */
import { resolveBackgroundPrimaryModelId } from "@/lib/ai";
import { formatMemoryMetaForPrompt } from "@/lib/chatMemory";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import { getDb } from "@/lib/db";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveProviderRawPoolExchangeCount,
} from "@/lib/hybridMemory";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  RP_QUALITY_PAID_PRODUCTION_KEY_ENVS,
  experimentSecretUsesProductionKey,
} from "@/lib/rpQualityPaidRunner";
import { paidRunnerArtifactFingerprint } from "@/lib/rpQualityPaidRunnerArtifacts";
import { estimateTokens, estimateTokensFromCharCount } from "@/lib/tokenEstimate";
import { assertIsolatedTestDatabaseActive } from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";
import {
  AB_ANSWER_KEY,
  AB_CALL_PLAN,
  buildOracleDiagnosticMemory,
  type AbAnswerFact,
} from "./memory50TurnAbAnswerKey";
import {
  AB_CHARACTER_CARD,
  AB_CHARACTER_NAME,
  AB_GREETING,
  AB_PERSONA_CARD,
  AB_PERSONA_NAME,
  AB_PROBES,
  AB_SCRIPT,
  AB_SCRIPT_ID,
} from "./memory50TurnAbScript";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { isMemoryFeatureEnabled } from "./memory-feature";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { buildMemoryContextForChat } from "./memory-manager";
import { loadChatRelationshipMeta } from "./memory-relationship-meta";
import {
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  refreshRollingSummaryForRegeneratedAssistant,
} from "./memory-rolling-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { listMemoryRecordsForChat } from "./memory-turn-summary";

export const AB_RUNNER_MODE = "DRY_RUN_ONLY" as const;
export const AB_EXPERIMENT_SCOPE = "summary_only" as const;
export const AB_CHAT_ID = 920701;
export const AB_USER_ID = 920702;
export const AB_CHARACTER_ID = 920703;
export const AB_COMPLETED_TURNS = 50;
export const AB_FREEZE_USER = "셔터 고리에 손을 얹는다.";
export const AB_NAMES = { charName: AB_CHARACTER_NAME, userName: AB_PERSONA_NAME };

export const AB_LIVE_MODEL_IDS = [
  "deepseek-v4.1-flash",
  "gemini-3.8-flash",
  "gpt-6.1-sol",
  "claude-opus-5.5",
] as const;

export type HarborAbMode = "DRY_RUN_ONLY" | "AUTHORIZED_PAID";
export type HarborAbSummarizer = "extractive_fake" | "live_luna";

export type HarborAbDenialReason =
  | "DRY_RUN_ONLY"
  | "AUTHORIZED_MODE_NOT_SHIPPED"
  | "MISSING_USER_COST_APPROVAL"
  | "EXTERNAL_RUNNER_RETRY_FORBIDDEN"
  | "FALLBACK_FORBIDDEN"
  | "PRODUCTION_KEY_FORBIDDEN"
  | "CHAT_ROUTE_FORBIDDEN"
  | "LIVE_SUMMARIZER_NOT_APPROVED"
  | "EMPTY_OR_INCOMPLETE_SUMMARY";

export type HarborAbGateInput = {
  mode: HarborAbMode;
  userCostApproved?: boolean;
  runnerRetry?: number;
  allowFallback?: boolean;
  useProductionKey?: boolean;
  useChatRoute?: boolean;
  summarizer?: HarborAbSummarizer;
  experimentSecret?: string | null;
  env?: NodeJS.ProcessEnv;
};

export type HarborAbGate =
  | { ok: true; mode: "DRY_RUN_ONLY"; paidPostsAllowed: 0; reason: "DRY_RUN_ONLY" }
  | { ok: false; mode: HarborAbMode; paidPostsAllowed: 0; reason: HarborAbDenialReason };

export type HarborAbReadyState = "READY" | "NOT_READY";

export type HarborAbFactTrace = {
  id: AbAnswerFact["id"];
  sourceTurn: number | null;
  status: AbAnswerFact["status"];
  inRawHistory: boolean;
  inStoredSummary: boolean;
  inGlobalExact: boolean;
  inArmA: boolean;
  inArmB: boolean;
  oracleWrittenToDb: boolean;
};

export type HarborAbAssembly = {
  modelId: string;
  provider: "openrouter" | "openai" | "cheaperinference";
  probeId: string;
  arm: "A" | "B";
  summarizedTurnCount: number;
  truncatedMemory: boolean;
  systemFingerprint: string;
  historyFingerprint: string;
  inputTokens: number;
  hasCurrentMemory: boolean;
  hasOracleHeader: boolean;
};

export type HarborAbRunResult = {
  status: HarborAbReadyState;
  abortReason: HarborAbDenialReason | null;
  mode: "DRY_RUN_ONLY";
  scriptId: typeof AB_SCRIPT_ID;
  liveCanonBound: false;
  experimentScope: typeof AB_EXPERIMENT_SCOPE;
  paidPosts: 0;
  transportPosts: 0;
  summarizerTransport: "extractive_fake_grounded";
  providerSummaryModel: "NOT_TESTED";
  sealedRounds: number;
  summarizerCalls: number;
  frontier: number;
  rawPool: number;
  excludeTurnStartGte: number;
  projectionKind: string | null;
  reconnectMatched: boolean;
  regenKeptPromise: boolean | null;
  ledgerEmpty: boolean;
  oracleWrittenToDb: boolean;
  answerKeyLeakedIntoArmA: boolean;
  prepAssemblyIsOperationalAb: false;
  traces: HarborAbFactTrace[];
  assemblies: HarborAbAssembly[];
  cost: ReturnType<typeof estimateHarborAbCost>;
  owners: {
    seal: "processRollingSummaryBatch";
    summaryRequest: "summarizeTurnBatch";
    global: "resolveGlobalCurrentMemory";
    injection: "buildMemoryContextForChat";
    assembly: "buildContext";
    publishedPrice: "getPublishedPricing";
    lunaRateSnapshot: "resolveOpenRouterModelRates";
    productionKeyList: "RP_QUALITY_PAID_PRODUCTION_KEY_ENVS";
    artifactFingerprint: "paidRunnerArtifactFingerprint";
  };
};

export function evaluateHarborAbGate(input: HarborAbGateInput): HarborAbGate {
  const mode = input.mode;
  switch (mode) {
    case "AUTHORIZED_PAID":
      return {
        ok: false,
        mode,
        paidPostsAllowed: 0,
        reason: "AUTHORIZED_MODE_NOT_SHIPPED",
      };
    case "DRY_RUN_ONLY":
      break;
    default: {
      const _never: never = mode;
      return {
        ok: false,
        mode: "AUTHORIZED_PAID",
        paidPostsAllowed: 0,
        reason: _never,
      };
    }
  }
  if ((input.runnerRetry ?? 0) !== 0) {
    return { ok: false, mode, paidPostsAllowed: 0, reason: "EXTERNAL_RUNNER_RETRY_FORBIDDEN" };
  }
  if (input.allowFallback === true) {
    return { ok: false, mode, paidPostsAllowed: 0, reason: "FALLBACK_FORBIDDEN" };
  }
  if (input.useProductionKey === true) {
    return { ok: false, mode, paidPostsAllowed: 0, reason: "PRODUCTION_KEY_FORBIDDEN" };
  }
  if (input.useChatRoute === true) {
    return { ok: false, mode, paidPostsAllowed: 0, reason: "CHAT_ROUTE_FORBIDDEN" };
  }
  if (input.summarizer === "live_luna") {
    return { ok: false, mode, paidPostsAllowed: 0, reason: "LIVE_SUMMARIZER_NOT_APPROVED" };
  }
  if (experimentSecretUsesProductionKey(input.experimentSecret, input.env ?? process.env)) {
    return { ok: false, mode, paidPostsAllowed: 0, reason: "PRODUCTION_KEY_FORBIDDEN" };
  }
  if (
    RP_QUALITY_PAID_PRODUCTION_KEY_ENVS.some((key) => Boolean((input.env ?? process.env)[key]?.trim())) &&
    input.useProductionKey !== false
  ) {
    return { ok: false, mode, paidPostsAllowed: 0, reason: "PRODUCTION_KEY_FORBIDDEN" };
  }
  return { ok: true, mode: "DRY_RUN_ONLY", paidPostsAllowed: 0, reason: "DRY_RUN_ONLY" };
}

/** #1467 assembled A with empty memory and summarizedTurnCount=0. That is not an operational A/B. */
export function describePrepAssemblyLimit(): {
  longTermMemory: null;
  summarizedTurnCount: 0;
  isOperationalAb: false;
  reason: "EMPTY_A_MEMORY_AND_ZERO_FRONTIER";
} {
  return {
    longTermMemory: null,
    summarizedTurnCount: 0,
    isOperationalAb: false,
    reason: "EMPTY_A_MEMORY_AND_ZERO_FRONTIER",
  };
}

export function harborCharacterChunks() {
  return [
    {
      id: "synthetic-core",
      characterId: "synthetic-harbor",
      content: AB_CHARACTER_CARD,
      category: "identity" as const,
      importance: "CRITICAL" as const,
      tokenCount: AB_CHARACTER_CARD.length,
      keywords: [AB_CHARACTER_NAME],
    },
  ];
}

/** Copies grounded dialogue lines. Not a live summary-model quality claim. */
export function extractiveFakeHarborSummary(userContent: string): string {
  const lines = [...userContent.matchAll(/^(?:유저|이안):\s*(.+)$/gm)].map((match) => match[1]!.trim());
  if (lines.length === 0) {
    throw new Error("extractive fake found no harbor dialogue lines");
  }
  let text = lines.join(" → ");
  if (text.length < 80) text = `${text} → ${text}`;
  return text;
}

export function cleanupHarborExperimentChat(): void {
  assertIsolatedTestDatabaseActive();
  const db = getDb();
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(AB_CHAT_ID);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(AB_CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(AB_CHAT_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(AB_CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(AB_CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(AB_USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(AB_CHARACTER_ID);
}

export function seedHarborExperimentChat(): { firstAssistantId: number } {
  assertIsolatedTestDatabaseActive();
  cleanupHarborExperimentChat();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    AB_USER_ID,
    `harbor-${AB_USER_ID}@test.local`,
    AB_PERSONA_NAME,
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(AB_CHARACTER_ID, AB_CHARACTER_NAME);
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    AB_CHAT_ID,
    AB_USER_ID,
    AB_CHARACTER_ID
  );
  getOrCreateChatMemory(AB_CHAT_ID, AB_USER_ID, AB_CHARACTER_ID, "pro");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    AB_CHAT_ID,
    "assistant",
    AB_GREETING,
    "greeting"
  );

  let firstAssistantId = 0;
  for (const turn of AB_SCRIPT) {
    const userId = Number(
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        AB_CHAT_ID,
        "user",
        turn.user,
        "user"
      ).lastInsertRowid
    );
    const assistantId = Number(
      db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, user_message_id) VALUES (?,?,?,?,?)`
        )
        .run(AB_CHAT_ID, "assistant", turn.assistant, "test", userId).lastInsertRowid
    );
    if (turn.turn === 1) firstAssistantId = assistantId;
  }
  updateChatMemory(AB_CHAT_ID, AB_USER_ID, AB_CHARACTER_ID, {
    message_count: AB_COMPLETED_TURNS,
    membership_tier: "pro",
  });
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
  ).run(AB_CHAT_ID, "user", AB_FREEZE_USER);
  return { firstAssistantId };
}

function usd(tokens: number, perMillion: number): number {
  return (tokens / 1_000_000) * perMillion;
}

export function estimateHarborAbCost(input: {
  summaryInputTokens: number;
  assemblies: readonly HarborAbAssembly[];
}) {
  const luna = resolveOpenRouterModelRates(AB_CALL_PLAN.summaryModelDefault);
  const aimOutputTokens = estimateTokensFromCharCount(AB_CALL_PLAN.outputAimChars);
  const summaryOutputTokens = estimateTokensFromCharCount(600);
  const summaryExpectedUsd =
    usd(input.summaryInputTokens, luna.inputUsdPerM) +
    usd(AB_CALL_PLAN.summaryPlannedCalls * summaryOutputTokens, luna.outputUsdPerM);
  const summaryMaxAttemptUsd =
    usd(input.summaryInputTokens * 3, luna.inputUsdPerM) +
    usd(AB_CALL_PLAN.summaryMaxCallsIfUnmodifiedOwner * summaryOutputTokens, luna.outputUsdPerM);
  const rpByModel = AB_LIVE_MODEL_IDS.map((modelId) => {
    const rows = input.assemblies.filter((row) => row.modelId === modelId);
    const calls = rows.length;
    const inputTokens = rows.reduce((sum, row) => sum + row.inputTokens, 0);
    const outputTokens = calls * aimOutputTokens;
    const pricing = getPublishedPricing(modelId);
    return {
      modelId,
      calls,
      inputTokens,
      outputTokensAtAim: outputTokens,
      provider: MAIN_RP_USER_SELECTABLE_OPTIONS.find((option) => option.id === modelId)?.provider,
      inputUsdPerMillion: pricing.billingReferenceInputUsdPerMillion,
      outputUsdPerMillion: pricing.billingReferenceOutputUsdPerMillion,
      expectedUsdAtAim:
        usd(inputTokens, pricing.billingReferenceInputUsdPerMillion) +
        usd(outputTokens, pricing.billingReferenceOutputUsdPerMillion),
      contingencyUsdAtDoubleOutput:
        usd(inputTokens, pricing.billingReferenceInputUsdPerMillion) +
        usd(outputTokens * 2, pricing.billingReferenceOutputUsdPerMillion),
      usage: {
        providerRequestId: null,
        promptTokens: null,
        completionTokens: null,
        billedUsd: null,
        settlementSource: "unsettled" as const,
      },
    };
  });
  const rpExpectedUsd = rpByModel.reduce((sum, row) => sum + row.expectedUsdAtAim, 0);
  const rpContingencyUsd = rpByModel.reduce((sum, row) => sum + row.contingencyUsdAtDoubleOutput, 0);
  return {
    plannedPosts: AB_CALL_PLAN.plannedPostsIfSingleAttempt,
    expectedUsdAtAim: summaryExpectedUsd + rpExpectedUsd,
    contingencyUsd: summaryMaxAttemptUsd + rpContingencyUsd,
    hardMaximumUsd: "UNBOUNDED_WITHOUT_RUNNER_OUTPUT_CAP" as const,
    summary: {
      model: AB_CALL_PLAN.summaryModelDefault,
      provider: AB_CALL_PLAN.summaryProvider,
      plannedCalls: AB_CALL_PLAN.summaryPlannedCalls,
      inputTokens: input.summaryInputTokens,
      expectedUsd: summaryExpectedUsd,
      unmodifiedRetryUsd: summaryMaxAttemptUsd,
    },
    rpByModel,
    note: "Extractive-fake A prompts size the input-token estimate. Live Luna summaries will differ. Output has no production hard cap.",
  };
}

function storedSummariesJoined(): string {
  return listMemoryRecordsForChat(AB_CHAT_ID)
    .filter((record) => !record.inactive)
    .map((record) => record.summary)
    .join("\n");
}

function dbContainsOracle(): boolean {
  const header = "[진단 메모]";
  const recent = getOrCreateChatMemory(AB_CHAT_ID, AB_USER_ID, AB_CHARACTER_ID, "pro").recent_summary ?? "";
  return storedSummariesJoined().includes(header) || recent.includes(header);
}

export async function runHarborAbDryRun(opts?: {
  summarizer?: HarborAbSummarizer | "empty";
  refreshTurn1?: boolean;
}): Promise<HarborAbRunResult> {
  assertIsolatedTestDatabaseActive();
  const gate = evaluateHarborAbGate({
    mode: "DRY_RUN_ONLY",
    runnerRetry: 0,
    allowFallback: false,
    useProductionKey: false,
    useChatRoute: false,
    summarizer: opts?.summarizer === "live_luna" ? "live_luna" : "extractive_fake",
  });
  if (!gate.ok) {
    return {
      ...emptyNotReady(gate.reason),
      abortReason: gate.reason,
    };
  }
  if (!isMemoryFeatureEnabled()) {
    return emptyNotReady("EMPTY_OR_INCOMPLETE_SUMMARY");
  }

  const { firstAssistantId } = seedHarborExperimentChat();
  let summarizerCalls = 0;
  let summaryInputTokens = 0;
  if (opts?.summarizer === "empty") {
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "" }));
  } else {
    __setSummarizeTurnBatchCallerForTests(async (system, history) => {
      summarizerCalls += 1;
      const user = history.map((message) => message.content).join("\n");
      summaryInputTokens += estimateTokens(system) + estimateTokens(user);
      return { text: extractiveFakeHarborSummary(user) };
    });
  }

  let sealedRounds = 0;
  try {
    for (let round = 0; round < 12; round += 1) {
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
      if (!sealed) break;
      sealedRounds += 1;
    }
  } finally {
    __setSummarizeTurnBatchCallerForTests(null);
  }

  const records = listMemoryRecordsForChat(AB_CHAT_ID).filter((record) => !record.inactive);
  const frontier = highestContiguousCompletedTurn(records, AB_COMPLETED_TURNS);
  const summaries = storedSummariesJoined();
  if (sealedRounds !== 10 || frontier !== AB_COMPLETED_TURNS || summaries.trim().length === 0) {
    return {
      ...emptyNotReady("EMPTY_OR_INCOMPLETE_SUMMARY"),
      sealedRounds,
      summarizerCalls,
      frontier,
      abortReason: "EMPTY_OR_INCOMPLETE_SUMMARY",
    };
  }

  const messageRows = getDb()
    .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
    .all(AB_CHAT_ID) as { role: "user" | "assistant"; content: string; model?: string }[];
  const turns = messagesToTurns(messageRows);
  const rawPool = resolveProviderRawPoolExchangeCount({
    memoryFeatureEnabled: true,
    completedTurns: AB_COMPLETED_TURNS,
    summarizedTurnCount: frontier,
  });
  const rawHistory = rawRecentTurnsToHistory(turns, rawPool, {
    summarizedTurnCount: frontier,
    memoryFeatureEnabled: true,
  });
  const excludeTurnStartGte = resolveLorebookExcludeFromTrimmedHistory(turns, rawHistory);
  const resolved = resolveGlobalCurrentMemory(AB_CHAT_ID, MEMORY_CAPACITY_FIXED, {
    excludeTurnStartGte,
  });
  const injection = await buildMemoryContextForChat({
    chatId: AB_CHAT_ID,
    userId: AB_USER_ID,
    characterId: AB_CHARACTER_ID,
    tier: "pro",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    userMessage: AB_PROBES[0]!.user,
    excludeSummaryTurnStartGte: excludeTurnStartGte,
    modelId: "deepseek-v4.1-flash",
  });
  const reconnect = await buildMemoryContextForChat({
    chatId: AB_CHAT_ID,
    userId: AB_USER_ID,
    characterId: AB_CHARACTER_ID,
    tier: "pro",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    userMessage: AB_PROBES[0]!.user,
    excludeSummaryTurnStartGte: excludeTurnStartGte,
    modelId: "deepseek-v4.1-flash",
  });

  if (!injection.text.trim()) {
    return emptyNotReady("EMPTY_OR_INCOMPLETE_SUMMARY");
  }

  const oracle = buildOracleDiagnosticMemory();
  const relationship = formatMemoryMetaForPrompt(loadChatRelationshipMeta(AB_CHAT_ID, AB_NAMES));
  const ledgerEmpty = !relationship;
  const oracleWrittenToDb = dbContainsOracle();
  const rawJoined = rawHistory.map((message) => message.content).join("\n");
  const chunks = harborCharacterChunks();

  const assemblies: HarborAbAssembly[] = [];
  for (const model of MAIN_RP_USER_SELECTABLE_OPTIONS) {
    for (const probe of AB_PROBES) {
      const shared = {
        charName: AB_CHARACTER_NAME,
        chunks,
        userNickname: AB_PERSONA_NAME,
        userPersona: AB_PERSONA_CARD,
        memoryMeta: relationship,
        shortTermHistory: rawHistory,
        currentUserMessage: probe.user,
        nsfw: false as const,
        provider: model.provider,
        modelId: model.id,
        completedTurns: AB_COMPLETED_TURNS,
        summarizedTurnCount: frontier,
        chatId: AB_CHAT_ID,
        userId: AB_USER_ID,
      };
      const armA = buildContext({ ...shared, longTermMemory: injection.text });
      const armB = buildContext({ ...shared, longTermMemory: oracle });
      const historyA = armA.history.map((message) => message.content).join("\n");
      const historyB = armB.history.map((message) => message.content).join("\n");
      const sectionA = (armA.meta.trackedSections ?? []).find((section) => section.id === "current-memory");
      const sectionB = (armB.meta.trackedSections ?? []).find((section) => section.id === "current-memory");
      assemblies.push({
        modelId: model.id,
        provider: model.provider,
        probeId: probe.id,
        arm: "A",
        summarizedTurnCount: frontier,
        truncatedMemory: armA.meta.truncatedMemory === true,
        systemFingerprint: paidRunnerArtifactFingerprint(armA.systemPrompt),
        historyFingerprint: paidRunnerArtifactFingerprint(historyA),
        inputTokens: estimateTokens(armA.systemPrompt) + estimateTokens(historyA),
        hasCurrentMemory: Boolean(sectionA?.text),
        hasOracleHeader: (sectionA?.text ?? "").includes("[진단 메모]"),
      });
      assemblies.push({
        modelId: model.id,
        provider: model.provider,
        probeId: probe.id,
        arm: "B",
        summarizedTurnCount: frontier,
        truncatedMemory: armB.meta.truncatedMemory === true,
        systemFingerprint: paidRunnerArtifactFingerprint(armB.systemPrompt),
        historyFingerprint: paidRunnerArtifactFingerprint(historyB),
        inputTokens: estimateTokens(armB.systemPrompt) + estimateTokens(historyB),
        hasCurrentMemory: Boolean(sectionB?.text),
        hasOracleHeader: (sectionB?.text ?? "").includes("[진단 메모]"),
      });
    }
  }

  const firstArmA = buildContext({
    charName: AB_CHARACTER_NAME,
    chunks,
    userNickname: AB_PERSONA_NAME,
    userPersona: AB_PERSONA_CARD,
    longTermMemory: injection.text,
    memoryMeta: relationship,
    shortTermHistory: rawHistory,
    currentUserMessage: AB_PROBES[0]!.user,
    nsfw: false,
    provider: "cheaperinference",
    modelId: "deepseek-v4.1-flash",
    completedTurns: AB_COMPLETED_TURNS,
    summarizedTurnCount: frontier,
  });
  const answerKeyLeakedIntoArmA = AB_ANSWER_KEY.some(
    (fact) => fact.oracleText != null && firstArmA.systemPrompt.includes(fact.oracleText)
  ) || firstArmA.systemPrompt.includes("[진단 메모]");

  let regenKeptPromise: boolean | null = null;
  if (opts?.refreshTurn1 !== false) {
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      summarizerCalls += 1;
      return { text: extractiveFakeHarborSummary(history.map((message) => message.content).join("\n")) };
    });
    try {
      const refreshed = await refreshRollingSummaryForRegeneratedAssistant({
        chatId: AB_CHAT_ID,
        userId: AB_USER_ID,
        characterId: AB_CHARACTER_ID,
        charName: AB_CHARACTER_NAME,
        characterIdentity: AB_CHARACTER_CARD,
        userPersona: AB_PERSONA_CARD,
        tier: "pro",
        memoryCapacity: MEMORY_CAPACITY_FIXED,
        assistantMessageId: firstAssistantId,
      });
      const after = await buildMemoryContextForChat({
        chatId: AB_CHAT_ID,
        userId: AB_USER_ID,
        characterId: AB_CHARACTER_ID,
        tier: "pro",
        memoryCapacity: MEMORY_CAPACITY_FIXED,
        userMessage: AB_PROBES[0]!.user,
        excludeSummaryTurnStartGte: excludeTurnStartGte,
        modelId: "deepseek-v4.1-flash",
      });
      regenKeptPromise = refreshed && after.text.includes("시 의회에는 넘기지");
    } finally {
      __setSummarizeTurnBatchCallerForTests(null);
    }
  }

  const traces = AB_ANSWER_KEY.map((fact) => {
    const needle = factNeedle(fact);
    return {
      id: fact.id,
      sourceTurn: fact.sourceTurn,
      status: fact.status,
      inRawHistory: needle ? rawJoined.includes(needle) : false,
      inStoredSummary: needle ? summaries.includes(needle) : false,
      inGlobalExact: needle ? injection.text.includes(needle) : false,
      inArmA: needle ? firstArmA.systemPrompt.includes(needle) : false,
      inArmB: fact.oracleText != null,
      oracleWrittenToDb,
    };
  });

  return {
    status: "READY",
    abortReason: null,
    mode: "DRY_RUN_ONLY",
    scriptId: AB_SCRIPT_ID,
    liveCanonBound: false,
    experimentScope: AB_EXPERIMENT_SCOPE,
    paidPosts: 0,
    transportPosts: 0,
    summarizerTransport: "extractive_fake_grounded",
    providerSummaryModel: "NOT_TESTED",
    sealedRounds,
    summarizerCalls,
    frontier,
    rawPool,
    excludeTurnStartGte: excludeTurnStartGte ?? 0,
    projectionKind: resolved.projectionKind,
    reconnectMatched: reconnect.text === injection.text,
    regenKeptPromise,
    ledgerEmpty,
    oracleWrittenToDb,
    answerKeyLeakedIntoArmA,
    prepAssemblyIsOperationalAb: false,
    traces,
    assemblies,
    cost: estimateHarborAbCost({ summaryInputTokens, assemblies }),
    owners: {
      seal: "processRollingSummaryBatch",
      summaryRequest: "summarizeTurnBatch",
      global: "resolveGlobalCurrentMemory",
      injection: "buildMemoryContextForChat",
      assembly: "buildContext",
      publishedPrice: "getPublishedPricing",
      lunaRateSnapshot: "resolveOpenRouterModelRates",
      productionKeyList: "RP_QUALITY_PAID_PRODUCTION_KEY_ENVS",
      artifactFingerprint: "paidRunnerArtifactFingerprint",
    },
  };
}

function factNeedle(fact: AbAnswerFact): string | null {
  switch (fact.id) {
    case "promise":
      return "시 의회에는 넘기지";
    case "npc_old":
      return "이름은 부르지 않겠다";
    case "world":
      return "밤 나룻배";
    case "relationship_new":
      return "예비 인장";
    case "latest_state":
      return "열아홉";
    case "invalidated_relationship":
      return "이름을 부르지 않던 태도";
    case "unresolved_goal":
      return "봄 밀물";
    case "never_given":
      return null;
    default: {
      const _never: never = fact.id;
      return _never;
    }
  }
}

/** Paid execute is not shipped. Always 0 POSTs. */
export function attemptHarborAbPaidExecute(
  input: Omit<HarborAbGateInput, "mode"> & { mode?: HarborAbMode }
): {
  executed: false;
  paidPosts: 0;
  gate: HarborAbGate;
} {
  const gate = evaluateHarborAbGate({ ...input, mode: "AUTHORIZED_PAID" });
  return { executed: false, paidPosts: 0, gate };
}

function emptyNotReady(reason: HarborAbDenialReason): HarborAbRunResult {
  return {
    status: "NOT_READY",
    abortReason: reason,
    mode: "DRY_RUN_ONLY",
    scriptId: AB_SCRIPT_ID,
    liveCanonBound: false,
    experimentScope: AB_EXPERIMENT_SCOPE,
    paidPosts: 0,
    transportPosts: 0,
    summarizerTransport: "extractive_fake_grounded",
    providerSummaryModel: "NOT_TESTED",
    sealedRounds: 0,
    summarizerCalls: 0,
    frontier: 0,
    rawPool: 0,
    excludeTurnStartGte: 0,
    projectionKind: null,
    reconnectMatched: false,
    regenKeptPromise: null,
    ledgerEmpty: true,
    oracleWrittenToDb: false,
    answerKeyLeakedIntoArmA: false,
    prepAssemblyIsOperationalAb: false,
    traces: [],
    assemblies: [],
    cost: estimateHarborAbCost({ summaryInputTokens: 0, assemblies: [] }),
    owners: {
      seal: "processRollingSummaryBatch",
      summaryRequest: "summarizeTurnBatch",
      global: "resolveGlobalCurrentMemory",
      injection: "buildMemoryContextForChat",
      assembly: "buildContext",
      publishedPrice: "getPublishedPricing",
      lunaRateSnapshot: "resolveOpenRouterModelRates",
      productionKeyList: "RP_QUALITY_PAID_PRODUCTION_KEY_ENVS",
      artifactFingerprint: "paidRunnerArtifactFingerprint",
    },
  };
}
