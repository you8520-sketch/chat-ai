import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { resolveLorebookFromRecords } from "./memory-lorebook-resolve";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { isMemoryFeatureEnabled } from "./memory-feature";
import type { MemoryTier } from "./memory-types";
import {
  countCompletedTurnsUpToMessageId,
  forkSummarizedTurnCount,
  FORK_MEMORY_TURN_INTERVAL,
} from "./memory-fork-turn-count";

export { countCompletedTurnsUpToMessageId, forkSummarizedTurnCount } from "./memory-fork-turn-count";
export { countMemoryEligibleCompletedTurnsUpToMessageId } from "./memory-fork-turn-count";

export function remapForkResetBoundary(opts: {
  parentResetAfterMessageId: number | null;
  forkMessageId: number;
  copiedParentMessageIds: readonly number[];
  messageIdMap: ReadonlyMap<number, number>;
}): number | null {
  if (opts.parentResetAfterMessageId == null) return null;
  const parentBoundaryAtFork = Math.min(
    opts.parentResetAfterMessageId,
    opts.forkMessageId
  );
  let lastBlockedParentMessageId: number | null = null;
  for (const parentMessageId of opts.copiedParentMessageIds) {
    if (parentMessageId > parentBoundaryAtFork) break;
    lastBlockedParentMessageId = parentMessageId;
  }
  return lastBlockedParentMessageId == null
    ? null
    : (opts.messageIdMap.get(lastBlockedParentMessageId) ?? null);
}

/** 부모 채팅의 6턴 히스토리 페이지를 분기 시점까지 새 채팅에 복사 */
export function copyForkTurnSummaries(
  db: Database.Database,
  opts: {
    sourceChatId: number;
    newChatId: number;
    forkTurnCount: number;
    messageIdMap: Map<number, number>;
  }
): number {
  if (opts.forkTurnCount < FORK_MEMORY_TURN_INTERVAL) return 0;

  const rows = db
    .prepare(
      `SELECT turn_number, assistant_message_id,
              source_start_user_message_id, source_end_user_message_id,
              summary, user_edited,
              COALESCE(summary_kind, 'narrative') AS summary_kind,
              scope_payload, branch_id, branch_status, promoted_by, promoted_at,
              COALESCE(inactive, 0) AS inactive
       FROM chat_turn_summaries WHERE chat_id=? ORDER BY turn_number ASC`
    )
    .all(opts.sourceChatId) as {
    turn_number: number;
    assistant_message_id: number | null;
    source_start_user_message_id: number | null;
    source_end_user_message_id: number | null;
    summary: string;
    user_edited: number;
    summary_kind: string;
    scope_payload: string | null;
    branch_id: string | null;
    branch_status: string | null;
    promoted_by: string | null;
    promoted_at: string | null;
    inactive: number;
  }[];

  const ins = db.prepare(
    `INSERT INTO chat_turn_summaries
      (chat_id, turn_number, assistant_message_id, summary, user_edited,
       summary_kind, scope_payload, branch_id, branch_status, promoted_by, promoted_at, inactive,
       source_start_user_message_id, source_end_user_message_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  let copied = 0;
  for (const row of rows) {
    const turnEnd = row.turn_number + FORK_MEMORY_TURN_INTERVAL - 1;
    if (turnEnd > opts.forkTurnCount) continue;

    const newAssistantId =
      row.assistant_message_id != null
        ? (opts.messageIdMap.get(row.assistant_message_id) ?? null)
        : null;
    const newSourceStartId =
      row.source_start_user_message_id != null
        ? (opts.messageIdMap.get(row.source_start_user_message_id) ?? null)
        : null;
    const newSourceEndId =
      row.source_end_user_message_id != null
        ? (opts.messageIdMap.get(row.source_end_user_message_id) ?? null)
        : null;

    ins.run(
      opts.newChatId,
      row.turn_number,
      newAssistantId,
      row.summary,
      row.user_edited ?? 0,
      row.summary_kind,
      row.scope_payload,
      row.branch_id,
      row.branch_status,
      row.promoted_by,
      row.promoted_at,
      row.inactive ?? 0,
      newSourceStartId,
      newSourceEndId
    );
    copied += 1;
  }

  return copied;
}

/** 복사된 히스토리 페이지로 분기 채팅 장기기억 초기화 */
export async function initializeForkChatMemory(opts: {
  newChatId: number;
  userId: number;
  characterId: number;
  forkTurnCount: number;
  tier: MemoryTier;
  memoryCapacity: number;
}): Promise<{ recentSummary: string; summarizedTurnCount: number }> {
  const summarizedTurnCount = forkSummarizedTurnCount(opts.forkTurnCount);

  if (!isMemoryFeatureEnabled()) {
    return { recentSummary: "", summarizedTurnCount: 0 };
  }

  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity);
  let recentSummary = "";
  let compressed = false;

  if (summarizedTurnCount >= FORK_MEMORY_TURN_INTERVAL) {
    const resolved = await resolveLorebookFromRecords(opts.newChatId, budget.lorebook);
    recentSummary = resolved.text;
    compressed = resolved.compressed;
  }

  getOrCreateChatMemory(opts.newChatId, opts.userId, opts.characterId, opts.tier);
  updateChatMemory(opts.newChatId, opts.userId, opts.characterId, {
    recent_summary: recentSummary,
    archive_summary: "",
    message_count: opts.forkTurnCount,
    summarized_turn_count: summarizedTurnCount,
    membership_tier: opts.tier,
    last_compressed_at: compressed ? new Date().toISOString() : null,
  });

  const db = getDb();
  db.prepare(
    `UPDATE chats SET memory=?, current_summary=?, memory_archived_turns=? WHERE id=? AND user_id=?`
  ).run(recentSummary, recentSummary, summarizedTurnCount, opts.newChatId, opts.userId);

  return { recentSummary, summarizedTurnCount };
}
