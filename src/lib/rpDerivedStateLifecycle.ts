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
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";
import {
  deleteEpisodicMemoryFactsByAssistantMessageIds,
  replaceEpisodicMemoryFactsForCanonicalMutation,
} from "@/lib/episodicMemoryFacts";

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

/* ------------------------------------------------------------------ */
/* Phase B0.1 — atomic canonical mutation core                         */
/* ------------------------------------------------------------------ */

/**
 * Inputs for an atomic latest-variant canonical switch.
 *
 * The caller supplies the already-resolved selected-variant row fields plus
 * the canonical status snapshot (if any) and the selected variant's
 * extracted_facts. The core performs, in ONE SQLite transaction:
 *
 *   1. message content/model/usage/active_variant/status snapshot UPDATE
 *   2. old active trigger events supersession
 *   3. episodic facts replace/invalidate for the selected canonical variant
 *
 * All three succeed together or roll back together. After this returns,
 * the caller performs best-effort trigger re-evaluation (§6).
 */
export type AtomicVariantSwitchInput = {
  chatId: number;
  messageId: number;
  /** Selected variant row fields (content/model/usage). */
  content: string;
  model: string;
  /** Serialized usage JSON (or null). */
  usageJson: string | null;
  /** Serialized adult route meta JSON ("" when none). */
  adultRouteMetaJson: string;
  /** Re-serialized variants array (all variants, with new active). */
  variantsJson: string;
  variantIndex: number;
  /** Canonical status snapshot for the selected variant, if any. */
  statusWidgetValuesJson: string | undefined;
  statusWidgetTurnActive: boolean | undefined;
  /** Selected variant source-turn facts (may be empty — valid success). */
  sourceTurn: number;
  characterId?: number | null;
  userId?: number | null;
  selectedFacts: ExtractedStatusFact[] | null | undefined;
  selectedRequestId: string | null;
  selectedGenerationSequence: number | null;
};

/**
 * Execute the atomic canonical variant-switch core. Throws on any DB failure
 * so the caller's HTTP layer can surface a 500; no partial mutation is left
 * behind (SQLite rolls back the whole transaction).
 */
export function executeAtomicVariantSwitchCore(
  db: Database.Database,
  input: AtomicVariantSwitchInput
): void {
  const tx = db.transaction(() => {
    if (input.statusWidgetValuesJson !== undefined) {
      db.prepare(
        "UPDATE messages SET content=?, model=?, usage=?, adult_route_meta_json=?, alternates=?, active_variant=?, status_widget_values_json=?, status_widget_turn_active=? WHERE id=?"
      ).run(
        input.content,
        input.model,
        input.usageJson,
        input.adultRouteMetaJson,
        input.variantsJson,
        input.variantIndex,
        input.statusWidgetValuesJson,
        input.statusWidgetTurnActive ? 1 : 0,
        input.messageId
      );
    } else {
      db.prepare(
        "UPDATE messages SET content=?, model=?, usage=?, adult_route_meta_json=?, alternates=?, active_variant=? WHERE id=?"
      ).run(
        input.content,
        input.model,
        input.usageJson,
        input.adultRouteMetaJson,
        input.variantsJson,
        input.variantIndex,
        input.messageId
      );
    }

    supersedeStatusTriggerEventsForSourceMessage(
      db,
      input.chatId,
      input.messageId,
      "variant_switch"
    );

    replaceEpisodicMemoryFactsForCanonicalMutation(db, {
      chatId: input.chatId,
      characterId: input.characterId,
      userId: input.userId,
      sourceTurn: input.sourceTurn,
      facts: input.selectedFacts,
      metadata: {
        assistant_message_id: input.messageId,
        request_id: input.selectedRequestId,
        variant_switch: true,
        variant_index: input.variantIndex,
      },
    });
  });
  tx();
}

/**
 * Inputs for an atomic manual assistant edit.
 *
 * `materialProseChange` selects the embedded-facts contract:
 *   true  → embedded extracted_facts are cleared (stale memory > wrong memory)
 *   false → existing extracted_facts are preserved (format/status-only edit)
 *
 * `supersedeTriggers` is an explicit caller policy (Phase B0.2). Recommended:
 *   supersedeTriggers = hasWidgetPatch && isLatest
 * Material prose without a widget patch must NOT supersede triggers — status
 * values did not change. Historical widget edits also pass false (display-only).
 */
export type AtomicManualEditInput = {
  chatId: number;
  messageId: number;
  content: string;
  alternatesJson: string;
  /** Final canonical status_widget_values_json to store. */
  statusWidgetValuesJson: string;
  materialProseChange: boolean;
  /** Source turn for episodic invalidation (material edit only). */
  sourceTurn: number | null;
  /**
   * When true, previous active trigger events for this source message are
   * superseded inside the same transaction as the message/status UPDATE.
   */
  supersedeTriggers?: boolean;
  /** Required when supersedeTriggers is true. */
  triggerSupersessionReason?: TriggerSupersessionReason;
};

/**
 * Execute the atomic manual-edit core. In ONE transaction:
 *
 *   1. message content / alternates / active_variant / status_widget_values_json UPDATE
 *   2. (material edit only) episodic_memory_facts invalidation for this assistant message
 *   3. (supersedeTriggers) previous active trigger events supersession
 *
 * Throws on DB failure so no partial state survives:
 *   - "new prose + old memory"
 *   - "new status + old trigger"
 *
 * Trigger re-evaluation is intentionally OUTSIDE this core (best-effort after
 * commit). Prefer a briefly missing new trigger over a stale rejected one.
 */
export function executeAtomicManualEditCore(
  db: Database.Database,
  input: AtomicManualEditInput
): void {
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE messages SET content=?, alternates=?, active_variant=?, status_widget_values_json=? WHERE id=?"
    ).run(
      input.content,
      input.alternatesJson,
      0,
      input.statusWidgetValuesJson,
      input.messageId
    );

    if (input.materialProseChange) {
      deleteEpisodicMemoryFactsByAssistantMessageIds(db, input.chatId, [
        input.messageId,
      ]);
    }

    if (input.supersedeTriggers) {
      const reason = input.triggerSupersessionReason ?? "manual_status_edit";
      supersedeStatusTriggerEventsForSourceMessage(
        db,
        input.chatId,
        input.messageId,
        reason
      );
    }
  });
  tx();
}
