import { getDb } from "@/lib/db";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import { isMemoryFeatureEnabled } from "./memory-feature";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import {
  countChatTurns,
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  type MemoryRecordView,
} from "./memory-turn-summary";
import {
  scheduleCharacterRollingSummary,
  shouldTriggerRollingSummary,
  syncChatLongTermMemory,
} from "./memory-rolling-summary";
import type { MemoryTier } from "./memory-types";

/** 완료된 배치 기록만 반영 — summarized_turn_count 재계산 */
export function computeSummarizedTurnCountFromRecords(
  records: MemoryRecordView[],
  actualTurnCount: number
): number {
  let summarized = 0;
  for (const r of records) {
    const span = r.turnEnd - r.turnStart + 1;
    if (span === ROLLING_SUMMARY_INTERVAL && r.turnEnd <= actualTurnCount) {
      summarized = Math.max(summarized, r.turnEnd);
    }
  }
  return summarized;
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
 * 마지막 턴 삭제 후 message_count·요약 기록·로어북을 DB 대화와 맞춤.
 * (재생성·삭제·고르기로 6턴 경계가 어긋난 경우 복구)
 */
export function reconcileMemoryAfterTurnDelete(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier: MemoryTier;
  memoryCapacity: number;
}): boolean {
  if (!isMemoryFeatureEnabled()) return false;

  const actualTurnCount = countChatTurns(opts.chatId);
  getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);

  pruneStaleMemoryRecords(opts.chatId, actualTurnCount);
  const remaining = listMemoryRecordsForChat(opts.chatId);
  const newSummarized = computeSummarizedTurnCountFromRecords(remaining, actualTurnCount);

  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
  let lorebook = rebuildLorebookFromRecords(opts.chatId);
  if (lorebook.length > budget) {
    lorebook = trimLorebookToBudgetSync(lorebook, budget);
  }

  updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
    message_count: actualTurnCount,
    summarized_turn_count: newSummarized,
    recent_summary: lorebook,
    membership_tier: opts.tier,
  });
  syncChatLongTermMemory(opts.chatId, lorebook);

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
    `[memory] reconcile after turn delete chat=${opts.chatId} turns=${actualTurnCount} summarized=${newSummarized}`
  );
  return true;
}
