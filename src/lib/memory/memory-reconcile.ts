import { getDb } from "@/lib/db";
import { rollbackBranchControlMutationsForDeletedUserMessage } from "./memory-branch-control";
import { isMemoryFeatureEnabled } from "./memory-feature";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  type MemoryRecordView,
} from "./memory-turn-summary";
import { countMemoryEligibleCompletedTurns } from "./memory-turn-loader";
import {
  scheduleCharacterRollingSummary,
  shouldTriggerRollingSummary,
} from "./memory-rolling-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { reconcileSummarizedTurnCountFromTable } from "./memory-summary-persist";
import type { MemoryTier } from "./memory-types";

/** memory-eligible 완료 턴 수로 message_count를 맞춘다 (재생성·패널 조회·드리프트 복구). */
export function syncMemoryEligibleTurnCount(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
}): number {
  const count = countMemoryEligibleCompletedTurns(opts.chatId);
  const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  if ((memory.message_count ?? 0) !== count) {
    updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
      message_count: count,
      membership_tier: opts.tier,
    });
  }
  return count;
}

/** 완료된 배치 중 1부터 연속인 구간만 반영 — 구멍(예: 7만 있고 1 없음)이면 0 */
export function computeSummarizedTurnCountFromRecords(
  records: MemoryRecordView[],
  actualTurnCount: number
): number {
  return highestContiguousCompletedTurn(records, actualTurnCount);
}

/** 실제 턴 수보다 뒤에 걸친 요약 기록 제거 */
export function pruneStaleMemoryRecords(chatId: number, actualTurnCount: number): void {
  const db = getDb();
  for (const r of listMemoryRecordsForChat(chatId)) {
    if (r.turnStart > actualTurnCount || r.turnEnd > actualTurnCount) {
      db.prepare(`DELETE FROM chat_turn_summaries WHERE id=? AND chat_id=?`).run(r.id, chatId);
    }
  }
}

/**
 * Soft-delete (`deleteMemoryRecord`) 후 counter·로어북·LTM을 active 행만으로 재정렬하고,
 * 누락 배치가 있고 봉인 조건이 충족되면 [1~5] 등을 다시 봉인한다.
 *
 * 이전에는 inactive 행이 contiguous coverage / idempotent skip에 남아
 * summarized_turn_count가 내려가지 않고 새 5턴 요약이 영구히 막혔다.
 */
export function reconcileMemoryAfterRecordDelete(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier: MemoryTier;
  memoryCapacity: number;
}): boolean {
  if (!isMemoryFeatureEnabled()) return false;

  const actualTurnCount = countMemoryEligibleCompletedTurns(opts.chatId);
  getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);

  updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
    message_count: actualTurnCount,
    membership_tier: opts.tier,
  });

  const newSummarized = reconcileSummarizedTurnCountFromTable({
    chatId: opts.chatId,
    userId: opts.userId,
    characterId: opts.characterId,
    tier: opts.tier,
    playableTurnCount: actualTurnCount,
  });

  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
  let lorebook = rebuildLorebookFromRecords(opts.chatId);
  if (lorebook.length > budget) {
    lorebook = trimLorebookToBudgetSync(lorebook, budget);
  }
  updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
    recent_summary: lorebook,
    membership_tier: opts.tier,
  });

  if (shouldTriggerRollingSummary(actualTurnCount, newSummarized)) {
    scheduleCharacterRollingSummary({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      charName: opts.charName,
      tier: opts.tier,
      memoryCapacity: opts.memoryCapacity,
    });
  }

  console.info(
    `[memory] reconcile after record delete chat=${opts.chatId} turns=${actualTurnCount} summarized=${newSummarized}`
  );
  return true;
}

/**
 * 마지막 턴 삭제 후 message_count·요약 기록·로어북을 DB 대화와 맞춤.
 * (재생성·삭제·고르기로 요약 배치 경계가 어긋난 경우 복구)
 */
export function reconcileMemoryAfterTurnDelete(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier: MemoryTier;
  memoryCapacity: number;
  /** Deleted last-turn user message id — rolls back its cross-row branch mutations. */
  deletedUserMessageId?: number | null;
  deletedAssistantMessageId?: number | null;
  deletedPlayableTurn?: number | null;
}): boolean {
  if (!isMemoryFeatureEnabled()) return false;

  const actualTurnCount = countMemoryEligibleCompletedTurns(opts.chatId);
  getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);

  // 1) Roll back cross-row branch side effects caused by the deleted user turn only.
  if (opts.deletedUserMessageId != null) {
    const rolled = rollbackBranchControlMutationsForDeletedUserMessage(
      opts.chatId,
      opts.deletedUserMessageId
    );
    if (rolled > 0) {
      console.info(
        `[memory] branch-control rollback chat=${opts.chatId} userMsg=${opts.deletedUserMessageId} rows=${rolled}`
      );
    }
  }

  // 2) Prune incomplete batch rows
  pruneStaleMemoryRecords(opts.chatId, actualTurnCount);
  updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
    message_count: actualTurnCount,
    membership_tier: opts.tier,
  });
  // 3–5) Counter + LTM rebuild
  const newSummarized = reconcileSummarizedTurnCountFromTable({
    chatId: opts.chatId,
    userId: opts.userId,
    characterId: opts.characterId,
    tier: opts.tier,
    playableTurnCount: actualTurnCount,
  });

  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
  let lorebook = rebuildLorebookFromRecords(opts.chatId);
  if (lorebook.length > budget) {
    lorebook = trimLorebookToBudgetSync(lorebook, budget);
  }
  updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
    recent_summary: lorebook,
    membership_tier: opts.tier,
  });

  // 6) Existing seal trigger
  if (shouldTriggerRollingSummary(actualTurnCount, newSummarized)) {
    scheduleCharacterRollingSummary({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      charName: opts.charName,
      tier: opts.tier,
      memoryCapacity: opts.memoryCapacity,
    });
  }

  console.info(
    `[memory] reconcile after turn delete chat=${opts.chatId} turns=${actualTurnCount} summarized=${newSummarized}` +
      (opts.deletedPlayableTurn != null ? ` deletedTurn=${opts.deletedPlayableTurn}` : "")
  );
  return true;
}
