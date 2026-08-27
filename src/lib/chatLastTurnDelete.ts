/**
 * Phase B1-D1 — last playable turn delete transaction body.
 * Used by DELETE /api/chat/turn and unit tests (atomicity hooks).
 *
 * LLM calls: 0.
 */
import type Database from "better-sqlite3";
import {
  countAssistantGenerationTurns,
  incrementCharacterTotalTurns,
} from "@/lib/characterEngagementStats";
import { deleteEpisodicMemoryFactsByAssistantMessageIds } from "@/lib/episodicMemoryFacts";
import { rewindPersonaSecretStateForDeletedMessages } from "@/lib/personaSecretLifecycleCleanup";
import { deleteStatusTriggerEventsForSourceMessage } from "@/lib/rpDerivedStateLifecycle";
import {
  NumericTurnDeleteChainNotReadyError,
  revertNumericStateForDeletedAssistantCore,
} from "@/lib/rpNumericState/turnDeleteRevert";
import { recomputeAndPersistUserCoauthorMode } from "@/lib/userCoauthorState";

type Db = Database.Database;

export type ExecuteLastTurnDeleteInput = {
  chatId: number;
  characterId: number;
  userMessageId: number;
  assistantMessageId: number | null;
  /** When true, run numeric revert for assistantMessageId (may no-op if no events). */
  revertNumeric: boolean;
  /** @internal test-only — throw after numeric restore, before message deletes */
  __testThrowAfterNumericRestore?: boolean;
  /** @internal test-only — throw after persona/S3/S4 rewind, before message deletes */
  __testThrowAfterPersonaSecretRewind?: boolean;
  /** @internal test-only — throw after message deletes start failing mid-way */
  __testThrowAfterMessageDelete?: boolean;
};

export type ExecuteLastTurnDeleteResult = {
  deletedIds: number[];
  engagementDelta: number;
  numericAffectedStateCount: number;
};

/**
 * Single SQLite transaction owner for last-turn delete.
 * Throws NumericTurnDeleteChainNotReadyError on broken numeric chain (full rollback).
 */
export function executeLastTurnDeleteTransaction(
  db: Db,
  input: ExecuteLastTurnDeleteInput
): ExecuteLastTurnDeleteResult {
  const idsToDelete = [input.userMessageId];
  if (input.assistantMessageId != null) {
    idsToDelete.push(input.assistantMessageId);
  }

  let engagementDelta = input.userMessageId != null ? 1 : 0;
  if (input.assistantMessageId != null) {
    const assistantRow = db
      .prepare("SELECT content, alternates FROM messages WHERE id=? AND chat_id=?")
      .get(input.assistantMessageId, input.chatId) as
      | { content: string; alternates: string | null }
      | undefined;
    if (assistantRow) {
      const gens = countAssistantGenerationTurns(
        assistantRow.alternates,
        assistantRow.content
      );
      engagementDelta =
        input.userMessageId != null ? Math.max(1, gens) : gens;
    }
  }

  const run = db.transaction(() => {
    let numericAffectedStateCount = 0;
    if (input.revertNumeric && input.assistantMessageId != null) {
      const reverted = revertNumericStateForDeletedAssistantCore(db, {
        chatId: input.chatId,
        assistantMessageId: input.assistantMessageId,
      });
      numericAffectedStateCount = reverted.affectedStateCount;
    }

    if (input.__testThrowAfterNumericRestore) {
      throw new Error("TEST_THROW_AFTER_NUMERIC_RESTORE");
    }

    for (const id of idsToDelete) {
      db.prepare("DELETE FROM bookmarks WHERE message_id=?").run(id);
    }
    if (input.assistantMessageId != null) {
      deleteEpisodicMemoryFactsByAssistantMessageIds(db, input.chatId, [
        input.assistantMessageId,
      ]);
      // Must not swallow: trigger cleanup failure must abort the whole
      // last-turn delete transaction (numeric + messages + episodic + engagement).
      deleteStatusTriggerEventsForSourceMessage(
        db,
        input.chatId,
        input.assistantMessageId
      );
    }
    // Rewind persona-secret worldline before messages disappear so
    // source_message_id / assistant provenance still resolve.
    rewindPersonaSecretStateForDeletedMessages(db, {
      chatId: input.chatId,
      messageIds: idsToDelete,
      assistantMessageId: input.assistantMessageId,
    });
    if (input.__testThrowAfterPersonaSecretRewind) {
      throw new Error("TEST_THROW_AFTER_PERSONA_SECRET_REWIND");
    }
    for (const id of idsToDelete) {
      db.prepare("DELETE FROM messages WHERE id=? AND chat_id=?").run(
        id,
        input.chatId
      );
      if (input.__testThrowAfterMessageDelete) {
        throw new Error("TEST_THROW_AFTER_MESSAGE_DELETE");
      }
    }
    if (engagementDelta > 0) {
      incrementCharacterTotalTurns(db, input.characterId, -engagementDelta);
    }
    recomputeAndPersistUserCoauthorMode(db, input.chatId);
    return { deletedIds: idsToDelete, engagementDelta, numericAffectedStateCount };
  });

  return run.immediate();
}

export { NumericTurnDeleteChainNotReadyError };
