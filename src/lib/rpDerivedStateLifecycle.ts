/**
 * RP derived-state integrity foundation (Phase B0).
 *
 * Shared lifecycle helpers for the derived-state chain:
 *   assistant generation → status snapshot → episodic facts → trigger events
 *   → regeneration → variant → edit → delete
 *
 * This module does NOT implement the numeric state system. It only hardens the
 * existing derived-state lifecycle so a future numeric reducer can sit on top.
 *
 * No prompt changes, no LLM calls.
 */
import type Database from "better-sqlite3";

/** Generation statuses that may anchor canonical derived state. */
export const CANONICAL_DERIVED_STATE_GENERATION_STATUSES = [
  "completed",
  "ok",
  "completed_with_postprocess_error",
] as const;

/**
 * Only `completed`, `ok`, `completed_with_postprocess_error` may produce new
 * durable derived state (episodic facts, trigger events, future numeric state).
 * `interrupted` / `failed_partial` / `failed` / `generating` / `submitted`
 * must NOT advance derived state.
 */
export function isCanonicalDerivedStateGenerationStatus(
  status: string | null | undefined
): boolean {
  if (!status) return false;
  return (CANONICAL_DERIVED_STATE_GENERATION_STATUSES as readonly string[]).includes(
    status
  );
}

/**
 * Does a later canonical assistant turn exist after the given assistant
 * message? Used to decide whether regeneration / variant switch / status edit
 * on a historical message would require downstream replay.
 *
 * Phase B0 only exposes the helper + tests; it does NOT change user-facing
 * behavior. Phase B1 numeric-state chats will use this to reject historical
 * regeneration.
 */
export function hasLaterCanonicalTurn(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM messages
       WHERE chat_id = ?
         AND role = 'assistant'
         AND model != 'greeting'
         AND id > ?
         AND generation_status IN ('completed', 'ok', 'completed_with_postprocess_error')
       LIMIT 1`
    )
    .get(chatId, assistantMessageId) as { id: number } | undefined;
  return Boolean(row);
}

/** Latest canonical (non-greeting, success-status) assistant message id. */
export function getLatestCanonicalAssistantMessageId(
  db: Database.Database,
  chatId: number
): number | null {
  const row = db
    .prepare(
      `SELECT id FROM messages
       WHERE chat_id = ?
         AND role = 'assistant'
         AND model != 'greeting'
         AND generation_status IN ('completed', 'ok', 'completed_with_postprocess_error')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(chatId) as { id: number } | undefined;
  return row ? row.id : null;
}

export function isLatestCanonicalAssistantMessage(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number
): boolean {
  return getLatestCanonicalAssistantMessageId(db, chatId) === assistantMessageId;
}

/**
 * Logical source-turn number for an assistant message = count of non-greeting
 * assistant messages with id <= this message. Used to re-evaluate triggers
 * on manual status edit / variant switch with a stable source_turn.
 */
export function getAssistantSourceTurn(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number
): number | null {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages
       WHERE chat_id = ?
         AND role = 'assistant'
         AND model != 'greeting'
         AND id <= ?`
    )
    .get(chatId, assistantMessageId) as { c: number } | undefined;
  return row ? Number(row.c) : null;
}

export type TriggerSupersessionReason =
  | "regeneration"
  | "variant_switch"
  | "manual_status_edit"
  | "turn_delete";

/**
 * Mark all active trigger events produced by the given source assistant
 * message as superseded. Superseded events are ignored by queued-prompt
 * loading, fire_once alreadyFired, and same-turn alreadyQueued checks.
 *
 * Preserves audit provenance (no destructive DELETE). Used on regeneration
 * and latest-message variant switch / manual status edit.
 */
export function supersedeStatusTriggerEventsForSourceMessage(
  db: Database.Database,
  chatId: number,
  sourceMessageId: number,
  reason: TriggerSupersessionReason
): number {
  const result = db
    .prepare(
      `UPDATE status_trigger_events
       SET is_superseded = 1,
           superseded_at = datetime('now'),
           superseded_reason = ?
       WHERE chat_id = ?
         AND source_message_id = ?
         AND is_superseded = 0`
    )
    .run(reason, chatId, sourceMessageId);
  return Number(result.changes) || 0;
}

/**
 * Mark all active trigger events for a (chat_id, source_turn) as superseded.
 * Fallback when source_message_id is unavailable; prefer the message-scoped
 * helper above (see tests).
 */
export function supersedeStatusTriggerEventsForSourceTurn(
  db: Database.Database,
  chatId: number,
  sourceTurn: number,
  reason: TriggerSupersessionReason
): number {
  const result = db
    .prepare(
      `UPDATE status_trigger_events
       SET is_superseded = 1,
           superseded_at = datetime('now'),
           superseded_reason = ?
       WHERE chat_id = ?
         AND source_turn = ?
         AND is_superseded = 0`
    )
    .run(reason, chatId, sourceTurn);
  return Number(result.changes) || 0;
}

/**
 * Physically delete trigger events produced by a deleted assistant message.
 * Used by last-turn delete: the turn itself is gone, so its derived queue is
 * removed (no audit provenance needed for a deleted turn).
 */
export function deleteStatusTriggerEventsForSourceMessage(
  db: Database.Database,
  chatId: number,
  sourceMessageId: number
): number {
  const result = db
    .prepare(
      `DELETE FROM status_trigger_events
       WHERE chat_id = ? AND source_message_id = ?`
    )
    .run(chatId, sourceMessageId);
  return Number(result.changes) || 0;
}
