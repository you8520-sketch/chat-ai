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
      `SELECT turn_number, assistant_message_id, summary, user_edited
       FROM chat_turn_summaries WHERE chat_id=? ORDER BY turn_number ASC`
    )
    .all(opts.sourceChatId) as {
    turn_number: number;
    assistant_message_id: number | null;
    summary: string;
    user_edited: number;
  }[];

  const ins = db.prepare(
    `INSERT INTO chat_turn_summaries (chat_id, turn_number, assistant_message_id, summary, user_edited)
     VALUES (?,?,?,?,?)`
  );

  let copied = 0;
  for (const row of rows) {
    const turnEnd = row.turn_number + FORK_MEMORY_TURN_INTERVAL - 1;
    if (turnEnd > opts.forkTurnCount) continue;

    const newAssistantId =
      row.assistant_message_id != null
        ? (opts.messageIdMap.get(row.assistant_message_id) ?? null)
        : null;

    ins.run(
      opts.newChatId,
      row.turn_number,
      newAssistantId,
      row.summary,
      row.user_edited ?? 0
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
