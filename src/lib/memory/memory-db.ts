import { getDb } from "@/lib/db";
import { getChatMemoryCapacity, resolveMemoryBudgetFromCapacity } from "./memory-capacity";
import type { ChatMemoryRow, MemoryBufferRow, MemoryTier } from "./memory-types";

export function calcUsedChars(row: Pick<ChatMemoryRow, "pinned_facts" | "recent_summary" | "archive_summary">): number {
  return (row.pinned_facts?.length ?? 0) + (row.recent_summary?.length ?? 0) + (row.archive_summary?.length ?? 0);
}

const CHAT_MEMORY_SELECT = `SELECT id, chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary,
              membership_tier, used_chars, message_count, summarized_turn_count, last_compressed_at, created_at, updated_at
       FROM chat_memories WHERE chat_id=?`;

export function getOrCreateChatMemory(
  chatId: number,
  userId: number,
  characterId: number,
  tier: MemoryTier
): ChatMemoryRow {
  const db = getDb();
  let row = db.prepare(CHAT_MEMORY_SELECT).get(chatId) as ChatMemoryRow | undefined;

  if (!row) {
    migrateLegacyChatMemory(chatId, userId, characterId, tier);
    row = db.prepare(CHAT_MEMORY_SELECT).get(chatId) as ChatMemoryRow | undefined;
    if (!row) {
      db.prepare(
        `INSERT INTO chat_memories
          (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
         VALUES (?,?,?,?,?,?,?,?,0)`
      ).run(chatId, userId, characterId, "", "", "", tier, 0);
      row = db.prepare(CHAT_MEMORY_SELECT).get(chatId) as ChatMemoryRow;
    }
  } else if (row.membership_tier !== tier) {
    db.prepare(
      `UPDATE chat_memories SET membership_tier=?, updated_at=datetime('now') WHERE chat_id=?`
    ).run(tier, chatId);
    row = { ...row, membership_tier: tier };
  }

  if (row && row.summarized_turn_count == null) {
    row = { ...row, summarized_turn_count: 0 };
  }

  if (row) {
    row = foldLegacyPinnedIntoLorebook(row);
  }

  return row;
}

/** Read-only fetch — never inserts, migrates, or updates chat_memories. */
export function getChatMemoryRow(chatId: number): ChatMemoryRow | null {
  const row = getDb().prepare(CHAT_MEMORY_SELECT).get(chatId) as ChatMemoryRow | undefined;
  return row ?? null;
}

/** 구버전 고정 기억(pinned_facts)을 로어북(recent_summary) 앞에 1회 병합 */
function foldLegacyPinnedIntoLorebook(row: ChatMemoryRow): ChatMemoryRow {
  const pinned = row.pinned_facts?.trim();
  if (!pinned) return row;

  const db = getDb();
  const merged = [pinned, row.recent_summary?.trim() ?? ""].filter(Boolean).join("\n\n");
  const used = calcUsedChars({
    pinned_facts: "",
    recent_summary: merged,
    archive_summary: row.archive_summary,
  });

  db.prepare(
    `UPDATE chat_memories SET pinned_facts='', recent_summary=?, used_chars=?, updated_at=datetime('now') WHERE chat_id=?`
  ).run(merged, used, row.chat_id);

  return { ...row, pinned_facts: "", recent_summary: merged, used_chars: used };
}
/** 해당 채팅방의 chats.current_summary / memory → chat_memories.recent_summary 1회 이전 */
function migrateLegacyChatMemory(
  chatId: number,
  userId: number,
  characterId: number,
  tier: MemoryTier
): void {
  const db = getDb();
  const legacy = db
    .prepare(
      `SELECT current_summary, memory FROM chats
       WHERE id=? AND user_id=? AND character_id=?
         AND ((current_summary IS NOT NULL AND current_summary != '') OR (memory IS NOT NULL AND memory != ''))`
    )
    .get(chatId, userId, characterId) as { current_summary?: string; memory: string } | undefined;

  if (!legacy) return;
  const text = (legacy.current_summary?.trim() || legacy.memory?.trim()) ?? "";
  if (!text) return;

  db.prepare(
    `INSERT INTO chat_memories
      (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
     VALUES (?,?,?,?,?,?,?,?,0)`
  ).run(chatId, userId, characterId, "", text, "", tier, text.length);
}

export function appendToBuffer(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  role: "user" | "assistant";
  content: string;
  messageIndex: number;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO memory_buffer (user_id, character_id, chat_id, role, content, message_index) VALUES (?,?,?,?,?,?)`
  ).run(opts.userId, opts.characterId, opts.chatId, opts.role, opts.content, opts.messageIndex);
}

export function getBufferMessages(chatId: number): MemoryBufferRow[] {
  return getDb()
    .prepare(
      `SELECT id, user_id, character_id, chat_id, role, content, message_index, created_at
       FROM memory_buffer WHERE chat_id=? ORDER BY message_index ASC, id ASC`
    )
    .all(chatId) as MemoryBufferRow[];
}

export function getBufferCount(chatId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM memory_buffer WHERE chat_id=?`)
    .get(chatId) as { c: number };
  return row.c;
}

export function clearBuffer(chatId: number, upToMessageIndex?: number): void {
  const db = getDb();
  if (upToMessageIndex != null) {
    db.prepare(
      `DELETE FROM memory_buffer WHERE chat_id=? AND message_index <= ?`
    ).run(chatId, upToMessageIndex);
  } else {
    db.prepare(`DELETE FROM memory_buffer WHERE chat_id=?`).run(chatId);
  }
}

export function updateChatMemory(
  chatId: number,
  userId: number,
  characterId: number,
  patch: Partial<
    Pick<
      ChatMemoryRow,
      | "pinned_facts"
      | "recent_summary"
      | "archive_summary"
      | "membership_tier"
      | "message_count"
      | "summarized_turn_count"
      | "last_compressed_at"
    >
  >
): ChatMemoryRow {
  const db = getDb();
  const current = getOrCreateChatMemory(chatId, userId, characterId, patch.membership_tier ?? "free");

  const pinned = patch.pinned_facts ?? current.pinned_facts;
  const recent = patch.recent_summary ?? current.recent_summary;
  const archive = patch.archive_summary ?? current.archive_summary;
  const tier = patch.membership_tier ?? current.membership_tier;
  const used = calcUsedChars({ pinned_facts: pinned, recent_summary: recent, archive_summary: archive });

  db.prepare(
    `UPDATE chat_memories SET
      pinned_facts=?, recent_summary=?, archive_summary=?,
      membership_tier=?, used_chars=?, message_count=COALESCE(?, message_count),
      summarized_turn_count=COALESCE(?, summarized_turn_count),
      last_compressed_at=COALESCE(?, last_compressed_at),
      updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(
    pinned,
    recent,
    archive,
    tier,
    used,
    patch.message_count ?? null,
    patch.summarized_turn_count ?? null,
    patch.last_compressed_at ?? null,
    chatId
  );

  return getOrCreateChatMemory(chatId, userId, characterId, tier);
}
export function incrementMessageCount(chatId: number): number {
  const db = getDb();
  db.prepare(
    `UPDATE chat_memories SET message_count = message_count + 1, updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(chatId);
  const row = db
    .prepare(`SELECT message_count FROM chat_memories WHERE chat_id=?`)
    .get(chatId) as { message_count: number };
  return row.message_count;
}

/** @deprecated updateChatMemory + ensureLorebookWithinBudget (memory-manager) 사용 */
export function updateLorebook(
  chatId: number,
  userId: number,
  characterId: number,
  lorebook: string,
  tier: MemoryTier,
  memoryCapacity: number
): ChatMemoryRow {
  const budget = resolveMemoryBudgetFromCapacity(memoryCapacity).lorebook;
  void budget;
  return updateChatMemory(chatId, userId, characterId, { recent_summary: lorebook.trim(), membership_tier: tier });
}

export function clearChatMemory(chatId: number, userId: number, characterId: number, tier: MemoryTier): void {
  const db = getDb();
  db.prepare(
    `UPDATE chat_memories SET
      pinned_facts='', recent_summary='', archive_summary='',
      used_chars=0, message_count=0, summarized_turn_count=0, last_compressed_at=NULL, updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(chatId);
  clearBuffer(chatId);
  db.prepare(`UPDATE chats SET current_summary='', memory='' WHERE id=? AND user_id=?`).run(chatId, userId);
  getOrCreateChatMemory(chatId, userId, characterId, tier);
}
export function upgradeTierForUser(userId: number, tier: MemoryTier): void {
  const db = getDb();
  db.prepare(
    `UPDATE chat_memories SET membership_tier=?, updated_at=datetime('now') WHERE user_id=?`
  ).run(tier, userId);
  db.prepare(
    `UPDATE character_memories SET membership_tier=?, updated_at=datetime('now') WHERE user_id=?`
  ).run(tier, userId);
}
