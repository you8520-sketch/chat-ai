import type { HonorificNames } from "@/lib/chatMemory";
import { getSubscriptionTier } from "@/lib/userPersonas";
import type { User } from "@/lib/auth-types";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import type { Route } from "@/lib/ai";
import {
  catchUpRollingSummaries,
  refreshRollingSummaryForRegeneratedAssistant,
  regenerateMemoryRecordBatch,
  scheduleCharacterRollingSummary,
  shouldTriggerRollingSummary,
  summarySealAtTurn,
  turnsUntilNextSummary,
} from "./memory-rolling-summary";
import {
  mergeRelationshipMetaFromTurn,
  mergeRelationshipMetaAfterRegenerate,
} from "./memory-relationship-meta";
import { setMemoryRelationshipTaskState, skipMemoryRelationshipProviderTask } from "./memoryRelationshipTask";
import type { AssistantGenerationScope } from "@/lib/assistantGenerationScope";
import {
  getChatMemoryRow,
  getOrCreateChatMemory,
  updateChatMemory,
  upgradeTierForUser,
} from "./memory-db";
import { getDb } from "@/lib/db";
import {
  getMemorySourceBoundary,
  invalidateDerivedMemoryGeneration,
  isMemorySourceEligible,
  isMemoryWriteGuardCurrentCore,
  resolveCanonicalSourceUserMessageId,
} from "./memory-source-boundary";
import { countMemoryEligibleCompletedTurnsCore } from "./memory-turn-loader";
import { resolveOocSceneRenderIntent } from "@/lib/oocSceneRender";
import { syncMemoryEligibleTurnCount } from "./memory-reconcile";
import { reconcileSharedEpisodicFactsForTurn } from "./memory-episodic-shared";
import { buildMemoryContext } from "./memory-injector";
import { ensureLorebookWithinBudget, trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { commitManualGlobalCheckpointCore } from "./memory-global-checkpoint";
import { executeGlobalLorebookCompaction } from "./memory-global-compaction-execution";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import { emptyMemoryInjection, isMemoryFeatureEnabled } from "./memory-feature";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import {
  resolveMinNarrativeContext,
  resolveRecentNarrativeContextLimit,
  shouldIncludeArchiveAlways,
} from "@/lib/contextTrack";
import { buildRecentNarrativeContextBlock } from "./memory-narrative-context";
import {
  MEDIUM_TERM_BLOCK_COUNT,
  buildMediumTermMemoryBlockForProjection,
} from "./memory-medium-term";
import type { MemoryInjection, MemorySnapshot, MemoryTier } from "./memory-types";

export type { MemoryTier, MemoryInjection, MemorySnapshot } from "./memory-types";

const lorebookMaintenanceRunning = new Set<number>();

/** @internal test seam — await this promise after lorebook resolve, before commit guard */
let lorebookMaintenanceDefer: Promise<void> | null = null;

export function __setLorebookMaintenanceDeferForTests(defer: Promise<void> | null): void {
  lorebookMaintenanceDefer = defer;
}

/** 채팅·패널 응답을 막지 않고 로어북 재조립·AI 압축을 백그라운드에서 수행 */
export function scheduleBackgroundLorebookMaintenance(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  memoryCapacity: number;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): void {
  if (!isMemoryFeatureEnabled() || isGeminiIsolationMode()) return;
  if (lorebookMaintenanceRunning.has(opts.chatId)) return;
  lorebookMaintenanceRunning.add(opts.chatId);

  void (async () => {
    try {
      const db = getDb();
      const boundarySnapshot = getMemorySourceBoundary(opts.chatId);
      const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
      const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity);

      let recentSummary = memory.recent_summary?.trim() ?? "";
      let archiveSummary = memory.archive_summary?.trim() ?? "";
      let archiveCompressed = false;
      let recentCompressed = false;

      if (lorebookMaintenanceDefer) {
        await lorebookMaintenanceDefer;
      }

      const compactResult = await executeGlobalLorebookCompaction({
        chatId: opts.chatId,
        userId: opts.userId,
        characterId: opts.characterId,
        tier: opts.tier,
        memoryCapacity: opts.memoryCapacity,
        boundarySnapshot,
        sourceUserMessageIds: [],
        turnTrace: opts.turnTrace,
        trigger: "background",
      });
      if (compactResult.committed && compactResult.mode !== "none") {
        recentCompressed = true;
        recentSummary = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier).recent_summary;
      } else if (compactResult.mode === "none" && compactResult.committed) {
        recentSummary = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier).recent_summary;
        recentCompressed = recentSummary.trim() !== (memory.recent_summary?.trim() ?? "");
      }

      if (archiveSummary.length > budget.archive) {
        const fittedArchive = trimLorebookToBudgetSync(archiveSummary, budget.archive);
        if (fittedArchive !== archiveSummary) {
          archiveSummary = fittedArchive;
          archiveCompressed = true;
        }
      }

      if (archiveCompressed) {
        if (
          !isMemoryWriteGuardCurrentCore(db, {
            chatId: opts.chatId,
            snapshot: boundarySnapshot,
            sourceUserMessageIds: [],
          })
        ) {
          return;
        }
        updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
          recent_summary: recentSummary,
          archive_summary: archiveSummary,
          membership_tier: opts.tier,
        });
      }
    } catch (e) {
      console.warn("[memory] background lorebook maintenance failed:", (e as Error).message);
    } finally {
      lorebookMaintenanceRunning.delete(opts.chatId);
    }
  })();
}

export function resolveMemoryTier(user: User): MemoryTier {
  return getSubscriptionTier(user);
}

/**
 * 3계층 메모리 — 프롬프트 주입용 read-only 조립.
 * 요약 생성·수정은 rolling-summary / memory-turn-summary가 담당.
 */
export function buildHierarchicalMemoryPromptLayers(opts: {
  chatId: number;
  completedTurns: number;
  modelId?: string | null;
  provider?: "gemini" | "openrouter" | "openai";
  /** 재생성 — 해당 assistant가 마지막인 요약 블록 제외 */
  excludeAssistantMessageId?: number | null;
}): {
  recentNarrativeContext: string;
} {
  if (!isMemoryFeatureEnabled()) {
    return { recentNarrativeContext: "" };
  }
  const narrativeLimit = resolveRecentNarrativeContextLimit(opts.modelId, opts.provider);
  const narrativeMin = resolveMinNarrativeContext(opts.modelId, opts.provider);
  return {
    recentNarrativeContext: buildRecentNarrativeContextBlock(
      opts.chatId,
      opts.completedTurns,
      narrativeLimit,
      narrativeMin,
      opts.excludeAssistantMessageId
    ),
  };
}

/** Model picker / dry-run — read-only memory assembly (no DB writes, no background jobs). */
export async function buildMemoryContextForPreview(opts: {
  chatId: number;
  tier: MemoryTier;
  memoryCapacity: number;
  userMessage: string;
  modelId?: string | null;
  provider?: "gemini" | "openrouter" | "openai";
  excludeSummaryTurnStartGte?: number;
  pastEventSummaryDedupe?: boolean;
}): Promise<MemoryInjection> {
  if (!isMemoryFeatureEnabled()) {
    return emptyMemoryInjection(opts.tier);
  }

  const memory = getChatMemoryRow(opts.chatId);
  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity);
  const resolved = resolveGlobalCurrentMemory(opts.chatId, budget.lorebook, {
    excludeTurnStartGte: opts.excludeSummaryTurnStartGte,
    storedRecentSummary: memory?.recent_summary,
  });
  const recentForPrompt = resolved.text;
  const archiveSummary = memory?.archive_summary?.trim() ?? "";
  const archiveForPrompt =
    archiveSummary.length > budget.archive
      ? trimLorebookToBudgetSync(archiveSummary, budget.archive)
      : archiveSummary;

  const mediumTerm = buildMediumTermMemoryBlockForProjection({
    chatId: opts.chatId,
    blockCount: MEDIUM_TERM_BLOCK_COUNT,
    excludeTurnStartGte: opts.excludeSummaryTurnStartGte,
    projectionKind: resolved.projectionKind,
  });

  return buildMemoryContext({
    memory: {
      recent_summary: recentForPrompt,
      archive_summary: archiveForPrompt,
      membership_tier: opts.tier,
    },
    userMessage: opts.userMessage,
    tier: opts.tier,
    memoryCapacity: opts.memoryCapacity,
    mediumTermText: mediumTerm.text,
    includeArchiveAlways: shouldIncludeArchiveAlways(opts.modelId, opts.provider),
    pastEventSummaryDedupe: opts.pastEventSummaryDedupe === true,
  });
}

/** AI 호출 전 장기 기억 컨텍스트 조립 — LLM 압축은 백그라운드, 프롬프트는 동기 trim */
export async function buildMemoryContextForChat(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  memoryCapacity: number;
  userMessage: string;
  modelId?: string | null;
  provider?: "gemini" | "openrouter" | "openai";
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  /** raw history에 포함된 최초 턴(1-indexed) — 이 턴 이후 요약본 제외 (DeepSeek) */
  excludeSummaryTurnStartGte?: number;
  /** DeepSeek — [과거 사건 요약본] + 중복 사건 단일 인지 문구 */
  pastEventSummaryDedupe?: boolean;
}): Promise<MemoryInjection> {
  if (!isMemoryFeatureEnabled()) {
    return emptyMemoryInjection(opts.tier);
  }
  const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity);

  const resolved = resolveGlobalCurrentMemory(opts.chatId, budget.lorebook, {
    excludeTurnStartGte: opts.excludeSummaryTurnStartGte,
    storedRecentSummary: memory.recent_summary,
  });
  const archiveSummary = memory.archive_summary?.trim() ?? "";
  const recentForPrompt = resolved.text;
  const archiveForPrompt =
    archiveSummary.length > budget.archive
      ? trimLorebookToBudgetSync(archiveSummary, budget.archive)
      : archiveSummary;

  if (resolved.needsBackgroundCompact || archiveSummary.length > budget.archive) {
    scheduleBackgroundLorebookMaintenance({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      tier: opts.tier,
      memoryCapacity: opts.memoryCapacity,
      turnTrace: opts.turnTrace,
    });
  } else if (
    resolved.projectionKind === "exact" &&
    resolved.text &&
    resolved.text !== memory.recent_summary?.trim()
  ) {
    updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
      recent_summary: resolved.text,
      membership_tier: opts.tier,
    });
  }

  const mediumTerm = buildMediumTermMemoryBlockForProjection({
    chatId: opts.chatId,
    blockCount: MEDIUM_TERM_BLOCK_COUNT,
    excludeTurnStartGte: opts.excludeSummaryTurnStartGte,
    projectionKind: resolved.projectionKind,
  });

  return buildMemoryContext({
    memory: {
      ...memory,
      recent_summary: recentForPrompt,
      archive_summary: archiveForPrompt,
    },
    userMessage: opts.userMessage,
    tier: opts.tier,
    memoryCapacity: opts.memoryCapacity,
    mediumTermText: mediumTerm.text,
    includeArchiveAlways: shouldIncludeArchiveAlways(opts.modelId, opts.provider),
    pastEventSummaryDedupe: opts.pastEventSummaryDedupe === true,
  });
}

/** 성공 응답 후 5턴 히스토리 → 로어북 누적 + 관계 메모(호칭·물건·속마음·약속) 추출 */
export async function scheduleMemoryUpdate(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  relationshipNames: HonorificNames;
  tier: MemoryTier;
  memoryCapacity: number;
  characterIdentity?: string | null;
  userMessage: string;
  assistantMessage: string;
  assistantMessageId?: number;
  /** Stable canonical source identity. Assistant regeneration keeps this user id. */
  sourceUserMessageId?: number | null;
  userPersona?: string | null;
  /** 재생성 — message_count 증가·배치 재요약·관계메모 reconcile */
  isRegenerate?: boolean;
  previousAssistantMessage?: string;
  route?: Route;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  /** DeepSeek/Qwen — 메인 JSON tail 파싱 성공 시 Flash 관계메모 추출 생략 */
  relationshipTailParsed?: boolean;
  relationshipDeltaFromMain?: import("@/lib/chatMemory").RelationshipMetaDelta | null;
  /** Shared post-turn Luna call already carried the durable relationship delta. */
  relationshipSharedAttempted?: boolean;
  relationshipSharedParsed?: boolean;
  relationshipSharedDelta?: import("@/lib/chatMemory").RelationshipMetaDelta | null;
  /** Shared initial episodic section parse — memory layer persists after canonical finalize. */
  sharedInitialEpisodic?: import("@/lib/memory/memory-episodic-shared").EpisodicSectionParse | null;
  episodicSharedAttempted?: boolean;
  generationScope?: AssistantGenerationScope;
}): Promise<void> {
  const generationScope = opts.generationScope;
  if (!isMemoryFeatureEnabled()) {
    skipMemoryRelationshipProviderTask(opts.assistantMessageId, "feature_disabled", undefined, generationScope);
    return;
  }
  if (resolveOocSceneRenderIntent(opts.userMessage)) {
    skipMemoryRelationshipProviderTask(opts.assistantMessageId, "ooc_scene", undefined, generationScope);
    return;
  }
  if (isGeminiIsolationMode()) {
    console.warn("[gemini-isolation] scheduleMemoryUpdate skipped");
    skipMemoryRelationshipProviderTask(opts.assistantMessageId, "gemini_isolation", undefined, generationScope);
    return;
  }

  getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);

  const sourceUserMessageId =
    opts.sourceUserMessageId ??
    (opts.assistantMessageId
      ? resolveCanonicalSourceUserMessageId({
          chatId: opts.chatId,
          assistantMessageId: opts.assistantMessageId,
        })
      : null);
  const boundarySnapshot = getMemorySourceBoundary(opts.chatId);
  if (!isMemorySourceEligible({ sourceUserMessageId, boundary: boundarySnapshot })) {
    console.info("MEMORY_SOURCE_PRE_RESET_REJECTED", {
      chat_id: opts.chatId,
      epoch: boundarySnapshot.epoch,
      boundary: boundarySnapshot.resetAfterMessageId,
      source_message_id: sourceUserMessageId,
    });
    if (opts.assistantMessageId) {
      skipMemoryRelationshipProviderTask(
        opts.assistantMessageId,
        "memory_source_pre_reset",
        undefined,
        generationScope
      );
    }
    return;
  }

  const isRegenerate =
    opts.isRegenerate === true &&
    !!opts.previousAssistantMessage?.trim() &&
    !!opts.assistantMessageId;

  try {
    if (isRegenerate) {
      await mergeRelationshipMetaAfterRegenerate({
        chatId: opts.chatId,
        names: opts.relationshipNames,
        userMessage: opts.userMessage,
        newAssistantMessage: opts.assistantMessage,
        previousAssistantMessage: opts.previousAssistantMessage!,
        route: opts.route ?? "safe",
        turnTrace: opts.turnTrace,
        sourceUserMessageId,
        boundarySnapshot,
        assistantMessageId: opts.assistantMessageId,
        generationScope,
        sharedInitialParsed: opts.relationshipSharedParsed,
        sharedInitialDelta: opts.relationshipSharedDelta,
        sharedInitialAttempted: opts.relationshipSharedAttempted,
      });
    } else {
      await mergeRelationshipMetaFromTurn({
        chatId: opts.chatId,
        names: opts.relationshipNames,
        userMessage: opts.userMessage,
        assistantMessage: opts.assistantMessage,
        route: opts.route ?? "safe",
        turnTrace: opts.turnTrace,
        mainModelTailParsed: opts.relationshipTailParsed,
        mainModelDelta: opts.relationshipDeltaFromMain,
        sharedInitialParsed: opts.relationshipSharedParsed,
        sharedInitialDelta: opts.relationshipSharedDelta,
        sharedInitialAttempted: opts.relationshipSharedAttempted,
        sourceUserMessageId,
        boundarySnapshot,
        assistantMessageId: opts.assistantMessageId,
        generationScope,
      });
    }
  } catch (e) {
    console.warn("[memory] relationship meta extract failed:", (e as Error).message);
  }

  if (
    opts.assistantMessageId &&
    (opts.episodicSharedAttempted === true || isRegenerate)
  ) {
    try {
      const episodicResult = reconcileSharedEpisodicFactsForTurn(getDb(), {
        chatId: opts.chatId,
        userId: opts.userId,
        characterId: opts.characterId,
        assistantMessageId: opts.assistantMessageId,
        sourceUserMessageId,
        sourceUserText: opts.userMessage,
        boundarySnapshot,
        episodic: opts.sharedInitialEpisodic ?? {
          present: false,
          valid: false,
          facts: [],
        },
        isRegeneration: isRegenerate,
        requestId: generationScope?.generationRequestId ?? opts.turnTrace?.turnRequestId ?? null,
        generationSequence: generationScope?.generationSequence,
      });
      if (process.env.NODE_ENV !== "production") {
        console.info("[memory] shared episodic reconcile", {
          chat_id: opts.chatId,
          assistant_message_id: opts.assistantMessageId,
          replaced: episodicResult.replaced,
          inserted: episodicResult.inserted,
          skipped: episodicResult.skipped,
        });
      }
    } catch (e) {
      console.warn("[memory] shared episodic reconcile failed:", (e as Error).message);
    }
  }

  if (isRegenerate && opts.assistantMessageId) {
    invalidateDerivedMemoryGeneration(opts.chatId);
    const eligibleCount = syncMemoryEligibleTurnCount({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      tier: opts.tier,
    });
    void refreshRollingSummaryForRegeneratedAssistant({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      charName: opts.relationshipNames.charName,
      tier: opts.tier,
      memoryCapacity: opts.memoryCapacity,
      characterIdentity: opts.characterIdentity,
      userPersona: opts.userPersona,
      assistantMessageId: opts.assistantMessageId,
      turnTrace: opts.turnTrace,
    }).catch((e) => {
      console.warn("[memory] regen rolling summary refresh failed:", (e as Error).message);
    });
    const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
    const summarized = memory.summarized_turn_count ?? 0;
    // Deferred seal — a regen at the canonical frontier must not seal the pending
    // batch (each regen would fire a summary provider call). Sealed-batch rebuild
    // stays inside refreshRollingSummaryForRegeneratedAssistant; the pending batch
    // is sealed by the next request-start catch-up owner instead.
    if (shouldTriggerRollingSummary(eligibleCount, summarized)) {
      console.info("MEMORY_SUMMARY_REGEN_SEAL_DEFERRED", {
        chat_id: opts.chatId,
        assistant_message_id: opts.assistantMessageId,
        eligible_turns: eligibleCount,
        summarized_through: summarized,
      });
    }
    return;
  }

  const db = getDb();
  const count = db.transaction(() => {
    if (
      !isMemoryWriteGuardCurrentCore(db, {
        chatId: opts.chatId,
        snapshot: boundarySnapshot,
        sourceUserMessageIds: [sourceUserMessageId],
      })
    ) {
      return null;
    }
    const eligibleCount = countMemoryEligibleCompletedTurnsCore(db, opts.chatId);
    db.prepare(
      `UPDATE chat_memories SET message_count=?, updated_at=datetime('now') WHERE chat_id=?`
    ).run(eligibleCount, opts.chatId);
    return eligibleCount;
  }).immediate();
  if (count == null) {
    console.info("MEMORY_STALE_EPOCH_REJECTED", {
      chat_id: opts.chatId,
      epoch: boundarySnapshot.epoch,
      source_message_id: sourceUserMessageId,
    });
    return;
  }
  const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  const summarized = memory.summarized_turn_count ?? 0;

  // Deferred seal — post-turn does NOT seal the just-completed 5-turn window:
  // the canonical frontier assistant stays regen/variant-mutable and unsummarized.
  // The next request-start owner (prepareNonBlockingSummaryForMainRp catch-up)
  // seals it in background while Main RP proceeds on unsummarized RAW.
  if (shouldTriggerRollingSummary(count, summarized)) {
    console.info("MEMORY_SUMMARY_SEAL_DEFERRED", {
      chat_id: opts.chatId,
      eligible_turns: count,
      summarized_through: summarized,
      seal_at_turn: summarySealAtTurn(summarized),
    });
  }
}

export function getMemorySnapshot(
  chatId: number,
  userId: number,
  characterId: number,
  tier: MemoryTier,
  memoryCapacity: number
): MemorySnapshot {
  const memory = getOrCreateChatMemory(chatId, userId, characterId, tier);
  const budget = resolveMemoryBudgetFromCapacity(memoryCapacity);
  const turnsUntil = turnsUntilNextSummary(
    memory.message_count,
    memory.summarized_turn_count ?? 0
  );

  return {
    lorebook: memory.recent_summary,
    recentSummary: memory.recent_summary,
    archiveSummary: memory.archive_summary,
    usedChars: memory.used_chars,
    limit: budget.total,
    memoryCapacity: budget.lorebook,
    tier,
    bufferCount: 0,
    messagesUntilCompression: turnsUntil,
    budget,
  };
}

/** 유저가 패널에서 Global Current Memory 본문을 직접 수정 — projection layer only */
export async function updateLorebookForChat(
  chatId: number,
  userId: number,
  characterId: number,
  lorebook: string,
  tier: MemoryTier,
  memoryCapacity: number
): Promise<MemorySnapshot> {
  if (!isMemoryFeatureEnabled()) {
    return getMemorySnapshot(chatId, userId, characterId, tier, memoryCapacity);
  }
  const budget = resolveMemoryBudgetFromCapacity(memoryCapacity).lorebook;
  const { text: fitted } = await ensureLorebookWithinBudget(lorebook, budget);
  const memory = getOrCreateChatMemory(chatId, userId, characterId, tier);
  getDb()
    .transaction(() => {
      commitManualGlobalCheckpointCore(getDb(), {
        chatId,
        manualText: fitted,
        archiveSummary: memory.archive_summary ?? "",
      });
      return true;
    })
    .immediate();
  invalidateDerivedMemoryGeneration(chatId);
  return getMemorySnapshot(chatId, userId, characterId, tier, memoryCapacity);
}

export function upgradeTier(userId: number, tier: MemoryTier): void {
  upgradeTierForUser(userId, tier);
}

export {
  catchUpRollingSummaries,
  ROLLING_SUMMARY_INTERVAL,
  regenerateMemoryRecordBatch,
};
export { isFallbackMemoryRecordSummary } from "./memory-summary-clamp";
