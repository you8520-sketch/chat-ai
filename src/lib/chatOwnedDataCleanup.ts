import type Database from "better-sqlite3";
import { ensureMemorySummaryMigrationsTable } from "@/lib/memory/memory-summary-migration-schema";
import { deletePersonaSecretRowsForChat } from "@/lib/personaSecretLifecycleCleanup";

/** Whole-chat derived-data wipe. Caller owns the surrounding transaction. */
export function deleteChatOwnedDerivedRows(
  db: Database.Database,
  chatId: number,
  userId?: number
): void {
  ensureMemorySummaryMigrationsTable(db);
  db.prepare(
    `DELETE FROM bookmarks
     WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)`
  ).run(chatId);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM memory_summary_migrations WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM status_widget_triggers WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM status_trigger_events WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM rp_numeric_state_events WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM rp_numeric_state_current WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM lorebook_active_entries WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM message_feedback WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM message_generations WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM preference_events WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM reports WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM report_refunds WHERE chat_id=?").run(chatId);
  deletePersonaSecretRowsForChat(db, chatId);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  if (userId != null) {
    db.prepare("DELETE FROM chats WHERE id=? AND user_id=?").run(chatId, userId);
  } else {
    db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
  }
}
