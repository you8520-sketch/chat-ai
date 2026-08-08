/**
 * Phase B1-D2 — Deterministic LTM invalidation after variant switch (LLM=0).
 *
 * Rejected-variant prose must not re-enter canon through rolling summary.
 * Strategy: mark any summary batch covering the source turn inactive, rebuild
 * lorebook from remaining active records, sync chat_memories.recent_summary
 * and both chats.current_summary + chats.memory (legacy fallback).
 *
 * Does NOT call the rolling-summary LLM.
 */
import { getDb } from "@/lib/db";
import { isMemoryFeatureEnabled } from "./memory-feature";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import {
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";
import { countChatTurns } from "./memory-turn-loader";
import { syncChatLongTermMemory } from "./memory-rolling-summary";
import { reconcileSummarizedTurnCountFromTable } from "./memory-summary-persist";
import type { MemoryTier } from "./memory-types";

export type VariantSwitchMemoryReconcileResult = {
  attempted: boolean;
  inactivatedRecordIds: number[];
  lorebookRebuilt: boolean;
};

/**
 * Invalidate summary records whose [turnStart, turnEnd] covers sourceTurn.
 * Rebuild lorebook / LTM from remaining active records.
 */
export function reconcileMemoryAfterVariantSwitch(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  memoryCapacity: number;
  sourceTurn: number;
}): VariantSwitchMemoryReconcileResult {
  if (!isMemoryFeatureEnabled()) {
    return { attempted: false, inactivatedRecordIds: [], lorebookRebuilt: false };
  }
  if (!Number.isFinite(opts.sourceTurn) || opts.sourceTurn <= 0) {
    return { attempted: false, inactivatedRecordIds: [], lorebookRebuilt: false };
  }

  getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  const records = listMemoryRecordsForChat(opts.chatId);
  const inactivatedRecordIds: number[] = [];
  for (const r of records) {
    if (r.inactive) continue;
    if (r.userEdited) continue;
    if (r.turnStart <= opts.sourceTurn && r.turnEnd >= opts.sourceTurn) {
      if (markMemoryRecordInactive(opts.chatId, r.id)) {
        inactivatedRecordIds.push(r.id);
      }
    }
  }

  const actualTurnCount = countChatTurns(opts.chatId);
  reconcileSummarizedTurnCountFromTable({
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
  // current_summary is the primary LTM mirror; also clear legacy chats.memory so
  // empty current_summary cannot fall back to a rejected-variant blob.
  syncChatLongTermMemory(opts.chatId, lorebook);
  getDb()
    .prepare("UPDATE chats SET memory=? WHERE id=?")
    .run(lorebook.trim(), opts.chatId);

  console.info(
    `[memory] reconcile after variant switch chat=${opts.chatId} sourceTurn=${opts.sourceTurn} inactivated=${inactivatedRecordIds.length}`
  );

  return {
    attempted: true,
    inactivatedRecordIds,
    lorebookRebuilt: true,
  };
}
