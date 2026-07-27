/**
 * PR-S4D — Turn-level knowledge transfer orchestrator.
 * Never parses assistant prose into transfers.
 */

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { applyKnowledgeTransferAction } from "@/lib/knowledgeTransferApply";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import type {
  KnowledgeTransferApplyResult,
  KnowledgeTransferAuthoritativeAction,
  PersonaSecretTransferAction,
} from "@/lib/knowledgeTransferTypes";

export type KnowledgeTransferTurnResult = {
  results: KnowledgeTransferApplyResult[];
  appliedCount: number;
  changedCount: number;
};

export function runKnowledgeTransfersForTurn(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  /** Parsed USER_EXPLICIT_TRANSFER actions (body.knowledgeTransferActions). */
  userActions?: PersonaSecretTransferAction[];
  /** Parsed SERVER/CREATOR actions (body.knowledgeTransferAuthoritativeActions). */
  authoritativeActions?: KnowledgeTransferAuthoritativeAction[];
  db?: Database.Database;
}): KnowledgeTransferTurnResult {
  const db = opts.db ?? getDb();
  ensureKnowledgeTransferSchema(db);

  const results: KnowledgeTransferApplyResult[] = [];

  for (const action of opts.userActions ?? []) {
    results.push(
      applyKnowledgeTransferAction({
        chatId: opts.chatId,
        personaId: opts.personaId,
        characterId: opts.characterId,
        turnNumber: opts.turnNumber,
        sourceType: "USER_EXPLICIT_TRANSFER",
        action,
        db,
      })
    );
  }

  for (const action of opts.authoritativeActions ?? []) {
    results.push(
      applyKnowledgeTransferAction({
        chatId: opts.chatId,
        personaId: opts.personaId,
        characterId: opts.characterId,
        turnNumber: opts.turnNumber,
        sourceType: action.sourceType,
        action,
        db,
      })
    );
  }

  return {
    results,
    appliedCount: results.filter((r) => r.ok && r.transferEventId).length,
    changedCount: results.filter((r) => r.ok && r.changed).length,
  };
}
