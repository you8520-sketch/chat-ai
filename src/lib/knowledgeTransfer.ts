/**
 * PR-S4D — Turn-level knowledge transfer orchestrator.
 * Never parses assistant prose into transfers.
 *
 * Public chat body may supply `userActions` only. `authoritativeActions` must be
 * resolved internally (creator trigger / server scene engine / admin endpoint /
 * queued event) — never from HTTP chat body fields.
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
import { isPersonaSecretDiscoveryEnabled } from "@/lib/personaSecretBoundaryPolicy";

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
  /** Public-path USER_EXPLICIT_TRANSFER actions (source forced server-side). */
  userActions?: PersonaSecretTransferAction[];
  /**
   * Internal-only SERVER/CREATOR actions. Callers must not populate this from
   * `body.knowledgeTransferAuthoritativeActions`.
   */
  authoritativeActions?: KnowledgeTransferAuthoritativeAction[];
  userId?: number | null;
  db?: Database.Database;
}): KnowledgeTransferTurnResult {
  if (!isPersonaSecretDiscoveryEnabled({ userId: opts.userId })) {
    return { results: [], appliedCount: 0, changedCount: 0 };
  }
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
