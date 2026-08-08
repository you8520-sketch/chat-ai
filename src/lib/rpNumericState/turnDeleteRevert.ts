/**
 * Phase B1-D1 — last-turn numeric rollback (history restore, not reducer).
 *
 * Transaction-free core: outer DELETE /api/chat/turn owns BEGIN/COMMIT.
 * LLM calls: 0. Does not call reduceNumericStateProposal.
 */
import type Database from "better-sqlite3";
import {
  getNumericStateCurrent,
  getNumericStateEventById,
} from "./persistence";
import type { NumericStateEventRow } from "./types";

type Db = Database.Database;

export class NumericTurnDeleteChainNotReadyError extends Error {
  readonly code = "NUMERIC_STATE_TURN_DELETE_CHAIN_NOT_READY" as const;
  constructor(message = "NUMERIC_STATE_TURN_DELETE_CHAIN_NOT_READY") {
    super(message);
    this.name = "NumericTurnDeleteChainNotReadyError";
  }
}

export type NumericTurnDeleteRestoreRow = {
  stateKey: string;
  beforeDelete: number;
  restoredValue: number;
  deletedEventCount: number;
  predecessorEventId: number;
  tipEventId: number;
};

export type RevertNumericStateForDeletedAssistantResult = {
  affectedStateCount: number;
  restorations: NumericTurnDeleteRestoreRow[];
};

type PreparedRestore = {
  stateKey: string;
  tip: NumericStateEventRow;
  earliest: NumericStateEventRow;
  predecessor: NumericStateEventRow;
  currentValue: number;
  deletedEventCount: number;
};

function listDistinctStateKeysForAssistant(
  db: Db,
  chatId: number,
  assistantMessageId: number
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT state_key AS stateKey
       FROM rp_numeric_state_events
       WHERE chat_id=? AND assistant_message_id=?
       ORDER BY state_key ASC`
    )
    .all(chatId, assistantMessageId) as Array<{ stateKey: string }>;
  return rows.map((r) => r.stateKey);
}

function listEventsForAssistantState(
  db: Db,
  chatId: number,
  stateKey: string,
  assistantMessageId: number
): NumericStateEventRow[] {
  const ids = db
    .prepare(
      `SELECT id FROM rp_numeric_state_events
       WHERE chat_id=? AND state_key=? AND assistant_message_id=?
       ORDER BY id ASC`
    )
    .all(chatId, stateKey, assistantMessageId) as Array<{ id: number }>;
  const out: NumericStateEventRow[] = [];
  for (const { id } of ids) {
    const ev = getNumericStateEventById(db, id);
    if (!ev) {
      throw new NumericTurnDeleteChainNotReadyError(
        `missing numeric event id=${id}`
      );
    }
    out.push(ev);
  }
  return out;
}

function findPredecessorByRevisionAfter(
  db: Db,
  chatId: number,
  stateKey: string,
  revisionAfter: number
): NumericStateEventRow | null {
  const row = db
    .prepare(
      `SELECT id FROM rp_numeric_state_events
       WHERE chat_id=? AND state_key=? AND revision_after=?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(chatId, stateKey, revisionAfter) as { id: number } | undefined;
  if (!row) return null;
  return getNumericStateEventById(db, row.id);
}

function prepareRestoreForState(
  db: Db,
  chatId: number,
  stateKey: string,
  assistantMessageId: number
): PreparedRestore {
  const events = listEventsForAssistantState(
    db,
    chatId,
    stateKey,
    assistantMessageId
  );
  if (events.length === 0) {
    throw new NumericTurnDeleteChainNotReadyError(
      `no generation events for state_key=${stateKey}`
    );
  }

  const current = getNumericStateCurrent(db, chatId, stateKey);
  if (!current) {
    throw new NumericTurnDeleteChainNotReadyError(
      `missing current for state_key=${stateKey}`
    );
  }
  if (current.lastSourceMessageId !== assistantMessageId) {
    throw new NumericTurnDeleteChainNotReadyError(
      `current tip message mismatch for state_key=${stateKey}`
    );
  }
  if (current.lastEventId == null) {
    throw new NumericTurnDeleteChainNotReadyError(
      `current last_event_id missing for state_key=${stateKey}`
    );
  }

  const tip = getNumericStateEventById(db, current.lastEventId);
  if (
    !tip ||
    tip.chatId !== chatId ||
    tip.stateKey !== stateKey ||
    tip.assistantMessageId !== assistantMessageId
  ) {
    throw new NumericTurnDeleteChainNotReadyError(
      `active tip event missing/mismatch for state_key=${stateKey}`
    );
  }
  if (tip.beforeValue == null || !Number.isFinite(tip.beforeValue)) {
    throw new NumericTurnDeleteChainNotReadyError(
      `active tip before_value invalid for state_key=${stateKey}`
    );
  }

  const earliest = events[0]!;
  if (earliest.revisionBefore == null || !Number.isFinite(earliest.revisionBefore)) {
    throw new NumericTurnDeleteChainNotReadyError(
      `earliest deleted revision_before invalid for state_key=${stateKey}`
    );
  }

  const predecessor = findPredecessorByRevisionAfter(
    db,
    chatId,
    stateKey,
    earliest.revisionBefore
  );
  if (!predecessor) {
    throw new NumericTurnDeleteChainNotReadyError(
      `predecessor not found for state_key=${stateKey}`
    );
  }
  if (
    predecessor.afterValue == null ||
    !Number.isFinite(predecessor.afterValue)
  ) {
    throw new NumericTurnDeleteChainNotReadyError(
      `predecessor after_value invalid for state_key=${stateKey}`
    );
  }
  if (predecessor.afterValue !== tip.beforeValue) {
    throw new NumericTurnDeleteChainNotReadyError(
      `revision continuity broken for state_key=${stateKey}`
    );
  }
  if (
    predecessor.revisionAfter == null ||
    predecessor.revisionAfter !== earliest.revisionBefore
  ) {
    throw new NumericTurnDeleteChainNotReadyError(
      `predecessor revision_after mismatch for state_key=${stateKey}`
    );
  }

  return {
    stateKey,
    tip,
    earliest,
    predecessor,
    currentValue: current.numericValue,
    deletedEventCount: events.length,
  };
}

function restoreCurrentFromPredecessor(
  db: Db,
  chatId: number,
  prepared: PreparedRestore
): void {
  const pred = prepared.predecessor;
  const isBootstrap =
    pred.sourceKind === "definition_initial" ||
    pred.sourceKind === "legacy_bootstrap" ||
    pred.outcome === "INITIALIZED";

  const revision = pred.revisionAfter;
  if (revision == null || !Number.isFinite(revision)) {
    throw new NumericTurnDeleteChainNotReadyError(
      `predecessor revision_after invalid for state_key=${prepared.stateKey}`
    );
  }

  db.prepare(
    `UPDATE rp_numeric_state_current
     SET numeric_value = ?,
         revision = ?,
         last_event_id = ?,
         last_source_turn = ?,
         last_source_message_id = ?,
         last_request_id = ?,
         last_generation_sequence = ?,
         updated_at = datetime('now')
     WHERE chat_id = ? AND state_key = ?`
  ).run(
    pred.afterValue,
    revision,
    pred.id,
    isBootstrap ? null : pred.sourceTurn,
    isBootstrap ? null : pred.assistantMessageId,
    isBootstrap ? null : pred.requestId,
    isBootstrap ? null : pred.generationSequence,
    chatId,
    prepared.stateKey
  );
}

/**
 * Preflight + restore currents + delete generation events for one assistant.
 * Does not open its own transaction.
 */
export function revertNumericStateForDeletedAssistantCore(
  db: Db,
  input: {
    chatId: number;
    assistantMessageId: number;
  }
): RevertNumericStateForDeletedAssistantResult {
  const chatId = input.chatId;
  const assistantMessageId = input.assistantMessageId;
  if (
    !Number.isSafeInteger(chatId) ||
    chatId <= 0 ||
    !Number.isSafeInteger(assistantMessageId) ||
    assistantMessageId <= 0
  ) {
    throw new NumericTurnDeleteChainNotReadyError("invalid chat/assistant id");
  }

  const stateKeys = listDistinctStateKeysForAssistant(
    db,
    chatId,
    assistantMessageId
  );
  if (stateKeys.length === 0) {
    return { affectedStateCount: 0, restorations: [] };
  }

  const prepared: PreparedRestore[] = [];
  for (const stateKey of stateKeys) {
    prepared.push(
      prepareRestoreForState(db, chatId, stateKey, assistantMessageId)
    );
  }

  const restorations: NumericTurnDeleteRestoreRow[] = [];
  for (const row of prepared) {
    restoreCurrentFromPredecessor(db, chatId, row);
    restorations.push({
      stateKey: row.stateKey,
      beforeDelete: row.currentValue,
      restoredValue: row.predecessor.afterValue!,
      deletedEventCount: row.deletedEventCount,
      predecessorEventId: row.predecessor.id,
      tipEventId: row.tip.id,
    });
  }

  const deleted = db
    .prepare(
      `DELETE FROM rp_numeric_state_events
       WHERE chat_id=? AND assistant_message_id=?`
    )
    .run(chatId, assistantMessageId);
  const deletedCount = Number(deleted.changes) || 0;
  const expectedDeleted = prepared.reduce(
    (n, r) => n + r.deletedEventCount,
    0
  );
  if (deletedCount !== expectedDeleted) {
    throw new NumericTurnDeleteChainNotReadyError(
      `deleted event count mismatch expected=${expectedDeleted} actual=${deletedCount}`
    );
  }

  try {
    console.info("[rp-numeric-state] turn-delete revert", {
      chatId,
      assistantMessageId,
      affectedStateCount: restorations.length,
      restorations: restorations.map((r) => ({
        stateKey: r.stateKey,
        beforeDelete: r.beforeDelete,
        restoredValue: r.restoredValue,
        deletedEventCount: r.deletedEventCount,
        predecessorEventId: r.predecessorEventId,
      })),
    });
  } catch {
    /* ignore log failures */
  }

  return {
    affectedStateCount: restorations.length,
    restorations,
  };
}

/** BEGIN IMMEDIATE wrapper for standalone callers / tests. */
export function revertNumericStateForDeletedAssistant(
  db: Db,
  input: {
    chatId: number;
    assistantMessageId: number;
  }
): RevertNumericStateForDeletedAssistantResult {
  const tx = db.transaction(() =>
    revertNumericStateForDeletedAssistantCore(db, input)
  );
  return tx.immediate();
}
