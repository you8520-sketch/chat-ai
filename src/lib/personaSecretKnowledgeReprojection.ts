/**
 * S4 variant projection — materialized observer knowledge owner.
 *
 * Reads effective persona_secret_evidence_events only (activation overlay applied).
 * Never reads canonical persona secret text for fact_snapshot wording.
 */

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type {
  PersonaSecretKnowledgeState,
  PersonaSecretObserverType,
} from "@/lib/personaSecretDiscoveryTypes";
import {
  getEvidenceActivation,
  ensurePersonaSecretEvidenceActivationSchema,
} from "@/lib/personaSecretEvidenceActivation";
import {
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { sanitizeRevealedFactForPrompt } from "@/lib/personaSecretReveal";
import { knowledgeStateRank } from "@/lib/visualDiscoveryCatalog";

type EvidenceRow = {
  id: string;
  turn_number: number;
  resulting_state: PersonaSecretKnowledgeState;
  revealed_fact_snapshot: string;
  created_at: string;
  method: string;
};

function resolveMergedState(
  existing: PersonaSecretKnowledgeState | "UNKNOWN",
  incoming: PersonaSecretKnowledgeState
): PersonaSecretKnowledgeState {
  if (knowledgeStateRank(incoming) > knowledgeStateRank(existing)) return incoming;
  if (existing === "UNKNOWN") return incoming;
  return existing === "CONFIRMED"
    ? "CONFIRMED"
    : existing === "SUSPECTED"
      ? "SUSPECTED"
      : incoming;
}

function isEvidenceEffective(db: Database.Database, evidenceId: string): boolean {
  const activation = getEvidenceActivation(evidenceId, db);
  if (!activation) return true;
  return activation.is_active === 1;
}

function listObserverEvidenceRows(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  observerType: PersonaSecretObserverType;
  observerId: string;
  db: Database.Database;
}): EvidenceRow[] {
  ensurePersonaSecretDiscoverySchema(opts.db);
  return opts.db
    .prepare(
      `SELECT id, turn_number, resulting_state, revealed_fact_snapshot, created_at, method
       FROM persona_secret_evidence_events
       WHERE chat_id=? AND persona_id=? AND secret_id=?
         AND observer_type=? AND observer_id=?
       ORDER BY turn_number ASC, created_at ASC, id ASC`
    )
    .all(
      opts.chatId,
      opts.personaId,
      opts.secretId,
      opts.observerType,
      opts.observerId
    ) as EvidenceRow[];
}

function pickWinningEvidence(
  effective: EvidenceRow[]
): { state: PersonaSecretKnowledgeState; evidence: EvidenceRow } | null {
  if (effective.length === 0) return null;

  let state: PersonaSecretKnowledgeState = "SUSPECTED";
  for (const row of effective) {
    state = resolveMergedState(state, row.resulting_state);
  }

  const targetRank = knowledgeStateRank(state);
  const atRank = effective.filter(
    (row) => knowledgeStateRank(row.resulting_state) === targetRank
  );
  atRank.sort((a, b) => {
    if (a.turn_number !== b.turn_number) return a.turn_number - b.turn_number;
    if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
    return a.id.localeCompare(b.id);
  });
  const winner = atRank[0];
  if (!winner) return null;
  return { state, evidence: winner };
}

function computeTurnBounds(
  effective: EvidenceRow[],
  finalState: PersonaSecretKnowledgeState
): { firstSuspectedTurn: number | null; confirmedTurn: number | null } {
  const suspectedOrConfirmed = effective.filter(
    (row) =>
      row.resulting_state === "SUSPECTED" || row.resulting_state === "CONFIRMED"
  );
  const firstSuspectedTurn =
    suspectedOrConfirmed.length > 0
      ? Math.min(...suspectedOrConfirmed.map((row) => row.turn_number))
      : null;

  const confirmedRows = effective.filter((row) => row.resulting_state === "CONFIRMED");
  const confirmedTurn =
    finalState === "CONFIRMED" && confirmedRows.length > 0
      ? Math.min(...confirmedRows.map((row) => row.turn_number))
      : null;

  return { firstSuspectedTurn, confirmedTurn };
}

export type ReprojectObserverSecretKnowledgeResult = {
  state: PersonaSecretKnowledgeState | "UNKNOWN";
  changed: boolean;
  removed: boolean;
  lastEvidenceEventId: string | null;
};

/**
 * Rebuild chat_character_secret_knowledge for one observer+secret from effective evidence.
 */
export function reprojectObserverSecretKnowledge(opts: {
  chatId: number;
  personaId: number;
  secretId: string;
  observerType: PersonaSecretObserverType;
  observerId: string;
  db?: Database.Database;
}): ReprojectObserverSecretKnowledgeResult {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  ensurePersonaSecretEvidenceActivationSchema(db);

  const rows = listObserverEvidenceRows({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: opts.secretId,
    observerType: opts.observerType,
    observerId: opts.observerId,
    db,
  });
  const effective = rows.filter((row) => isEvidenceEffective(db, row.id));
  const picked = pickWinningEvidence(effective);

  const existing = getObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: opts.secretId,
    observerType: opts.observerType,
    observerId: opts.observerId,
    db,
  });

  if (!picked) {
    if (existing) {
      db.prepare(
        `DELETE FROM chat_character_secret_knowledge
         WHERE chat_id=? AND persona_id=? AND secret_id=?
           AND observer_type=? AND observer_id=?`
      ).run(
        opts.chatId,
        opts.personaId,
        opts.secretId,
        opts.observerType,
        opts.observerId
      );
      return {
        state: "UNKNOWN",
        changed: true,
        removed: true,
        lastEvidenceEventId: null,
      };
    }
    return {
      state: "UNKNOWN",
      changed: false,
      removed: false,
      lastEvidenceEventId: null,
    };
  }

  const factSnapshot = sanitizeRevealedFactForPrompt(picked.evidence.revealed_fact_snapshot);
  if (!factSnapshot) {
    if (existing) {
      db.prepare(
        `DELETE FROM chat_character_secret_knowledge
         WHERE chat_id=? AND persona_id=? AND secret_id=?
           AND observer_type=? AND observer_id=?`
      ).run(
        opts.chatId,
        opts.personaId,
        opts.secretId,
        opts.observerType,
        opts.observerId
      );
      return {
        state: "UNKNOWN",
        changed: true,
        removed: true,
        lastEvidenceEventId: null,
      };
    }
    return {
      state: "UNKNOWN",
      changed: false,
      removed: false,
      lastEvidenceEventId: null,
    };
  }

  const { firstSuspectedTurn, confirmedTurn } = computeTurnBounds(effective, picked.state);
  const confidence = picked.state === "CONFIRMED" ? 100 : 70;

  const unchanged =
    existing &&
    existing.knowledge_state === picked.state &&
    sanitizeRevealedFactForPrompt(existing.fact_snapshot) === factSnapshot &&
    existing.last_evidence_event_id === picked.evidence.id &&
    existing.confirmed_turn === confirmedTurn &&
    existing.first_suspected_turn === firstSuspectedTurn;

  if (unchanged) {
    return {
      state: picked.state,
      changed: false,
      removed: false,
      lastEvidenceEventId: picked.evidence.id,
    };
  }

  upsertObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: opts.secretId,
    observerType: opts.observerType,
    observerId: opts.observerId,
    knowledgeState: picked.state,
    confidence,
    factSnapshot,
    firstSuspectedTurn,
    confirmedTurn,
    lastEvidenceEventId: picked.evidence.id,
    db,
  });

  return {
    state: picked.state,
    changed: true,
    removed: false,
    lastEvidenceEventId: picked.evidence.id,
  };
}
