import type { HonorificNames } from "@/lib/chatMemory";
import { getSubscriptionTier } from "@/lib/userPersonas";
import type { User } from "@/lib/auth-types";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import type { Route } from "@/lib/ai";
import {
  catchUpRollingSummaries,
  processRollingSummaryBatch,
  refreshRollingSummaryForRegeneratedAssistant,
  regenerateMemoryRecordBatch,
  scheduleCharacterRollingSummary,
  shouldTriggerRollingSummary,
  turnsUntilNextSummary,
} from "./memory-rolling-summary";
import {
  mergeRelationshipMetaFromTurn,
  mergeRelationshipMetaAfterRegenerate,
} from "./memory-relationship-meta";
import { setMemoryRelationshipTaskState } from "./memoryRelationshipTask";
import {
  getChatMemoryRow,
  getOrCreateChatMemory,
  updateChatMemory,
  upgradeTierForUser,
} from "./memory-db";
import { getDb } from "@/lib/db";
import {
  executeAtomicMemoryReset,
  getMemorySourceBoundary,
  isMemorySourceEligible,
  isMemoryWriteGuardCurrentCore,
  resolveCanonicalSourceUserMessageId,
} from "./memory-source-boundary";
import { countMemoryEligibleCompletedTurnsCore } from "./memory-turn-loader";
import { resolveOocSceneRenderIntent } from "@/lib/oocSceneRender";
import { syncMemoryEligibleTurnCount } from "./memory-reconcile";
import { buildMemoryContext } from "./memory-injector";
import { ensureLorebookWithinBudget, trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import {
  resolveLorebookFromRecords,
  resolveLorebookFromRecordsSync,
} from "./memory-lorebook-resolve";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import { emptyMemoryInjection, isMemoryFeatureEnabled } from "./memory-feature";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import {
  resolveMinNarrativeContext,
  resolveRecentNarrativeContextLimit,
  shouldIncludeArchiveAlways,
} from "@/lib/contextTrack";
import { buildRecentNarrativeContextBlock } from "./memory-narrative-context";
import type { MemoryInjection, MemorySnapshot, MemoryTier } from "./memory-types";

export type { MemoryTier, MemoryInjection, MemorySnapshot } from "./memory-types";

const lorebookMaintenanceRunning = new Set<number>();

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
      const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
      const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity);

      let recentSummary = memory.recent_summary?.trim() ?? "";
      let archiveSummary = memory.archive_summary?.trim() ?? "";
      let archiveCompressed = false;
      let recentCompressed = false;

      const resolved = await resolveLorebookFromRecords(
        opts.chatId,
        budget.lorebook,
        opts.turnTrace
      );
      if (resolved.text) {
        if (resolved.text !== recentSummary) {
          recentSummary = resolved.text;
          recentCompressed = true;
        }
      } else {
        const { text: fittedRecent, compressed } = await ensureLorebookWithinBudget(
          recentSummary,
          budget.lorebook,
          opts.turnTrace
        );
        if (compressed) {
          recentSummary = fittedRecent;
          recentCompressed = true;
        }
      }

      if (archiveSummary.length > budget.archive) {
        const { text: fittedArchive, compressed } = await ensureLorebookWithinBudget(
          archiveSummary,
          budget.archive,
          opts.turnTrace
        );
        if (compressed) {
          archiveSummary = fittedArchive;
          archiveCompressed = true;
        }
      }

      if (recentCompressed || archiveCompressed) {
        updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
          recent_summary: recentSummary,
          archive_summary: archiveSummary,
          last_compressed_at: new Date().toISOString(),
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
  const rebuilt = resolveLorebookFromRecordsSync(opts.chatId, budget.lorebook, {
    excludeTurnStartGte: opts.excludeSummaryTurnStartGte,
  });
  const recentSummary = rebuilt.text || memory?.recent_summary?.trim() || "";
  const archiveSummary = memory?.archive_summary?.trim() ?? "";
  const recentForPrompt = trimLorebookToBudgetSync(recentSummary, budget.lorebook);
  const archiveForPrompt =
    archiveSummary.length > budget.archive
      ? trimLorebookToBudgetSync(archiveSummary, budget.archive)
      : archiveSummary;

  return buildMemoryContext({
    memory: {
      recent_summary: recentForPrompt,
      archive_summary: archiveForPrompt,
      membership_tier: opts.tier,
    },
    userMessage: opts.userMessage,
    tier: opts.tier,
    memoryCapacity: opts.memoryCapacity,
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

  const rebuilt = resolveLorebookFromRecordsSync(opts.chatId, budget.lorebook, {
    excludeTurnStartGte: opts.excludeSummaryTurnStartGte,
  });
  let recentSummary = rebuilt.text || memory.recent_summary?.trim() || "";
  let archiveSummary = memory.archive_summary?.trim() ?? "";

  const recentForPrompt = trimLorebookToBudgetSync(recentSummary, budget.lorebook);
  const archiveForPrompt =
    archiveSummary.length > budget.archive
      ? trimLorebookToBudgetSync(archiveSummary, budget.archive)
      : archiveSummary;

  if (rebuilt.overBudget || recentSummary.length > budget.lorebook || archiveSummary.length > budget.archive) {
    scheduleBackgroundLorebookMaintenance({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      tier: opts.tier,
      memoryCapacity: opts.memoryCapacity,
      turnTrace: opts.turnTrace,
    });
  } else if (rebuilt.text && rebuilt.text !== memory.recent_summary?.trim()) {
    updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
      recent_summary: rebuilt.text,
      membership_tier: opts.tier,
    });
  }

  return buildMemoryContext({
    memory: {
      ...memory,
      recent_summary: recentForPrompt,
      archive_summary: archiveForPrompt,
    },
    userMessage: opts.userMessage,
    tier: opts.tier,
    memoryCapacity: opts.memoryCapacity,
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
}): Promise<void> {
  if (!isMemoryFeatureEnabled()) return;
  if (resolveOocSceneRenderIntent(opts.userMessage)) return;
  if (isGeminiIsolationMode()) {
    console.warn("[gemini-isolation] scheduleMemoryUpdate skipped");
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
      setMemoryRelationshipTaskState(
        opts.assistantMessageId,
        "skipped",
        "memory_source_pre_reset"
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
        sourceUserMessageId,
        boundarySnapshot,
        assistantMessageId: opts.assistantMessageId,
      });
    }
  } catch (e) {
    console.warn("[memory] relationship meta extract failed:", (e as Error).message);
  }

  if (isRegenerate && opts.assistantMessageId) {
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
    if (shouldTriggerRollingSummary(eligibleCount, summarized)) {
      void processRollingSummaryBatch({
        chatId: opts.chatId,
        userId: opts.userId,
        characterId: opts.characterId,
        charName: opts.relationshipNames.charName,
        tier: opts.tier,
        memoryCapacity: opts.memoryCapacity,
        characterIdentity: opts.characterIdentity,
        userPersona: opts.userPersona,
        turnTrace: opts.turnTrace,
      }).catch((e) => {
        console.warn("[memory] regen rolling summary seal failed:", (e as Error).message);
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

  if (shouldTriggerRollingSummary(count, summarized)) {
    void processRollingSummaryBatch({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      charName: opts.relationshipNames.charName,
      tier: opts.tier,
      memoryCapacity: opts.memoryCapacity,
      characterIdentity: opts.characterIdentity,
      userPersona: opts.userPersona,
      turnTrace: opts.turnTrace,
    }).catch((e) => {
      console.warn("[memory] rolling summary after turn failed:", (e as Error).message);
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

/** 유저가 패널에서 현재기억 본문을 직접 수정 — 초과 시 Flash 압축 */
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
  const { text: fitted, compressed } = await ensureLorebookWithinBudget(lorebook, budget);
  updateChatMemory(chatId, userId, characterId, {
    recent_summary: fitted,
    last_compressed_at: compressed ? new Date().toISOString() : undefined,
    membership_tier: tier,
  });
  return getMemorySnapshot(chatId, userId, characterId, tier, memoryCapacity);
}

export function clearMemoryForChat(
  chatId: number,
  userId: number,
  characterId: number,
  tier: MemoryTier
): void {
  executeAtomicMemoryReset({ chatId, userId, characterId, tier });
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
