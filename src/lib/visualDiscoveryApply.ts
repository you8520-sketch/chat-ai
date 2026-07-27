import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type {
  PersonaSecretKnowledgeState,
  PersonaSecretObserverType,
} from "@/lib/personaSecretDiscoveryTypes";
import {
  getObserverSecretKnowledge,
  upsertObserverSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import { insertChatPersonaSecretReveal } from "@/lib/personaSecretReveal";
import { sanitizeRevealedFactForPrompt } from "@/lib/personaSecretReveal";
import { knowledgeStateRank } from "@/lib/visualDiscoveryCatalog";
import {
  buildVisualDiscoveryIdempotencyKey,
  type VisualDiscoveryMatch,
} from "@/lib/visualDiscoveryMatcher";

export type VisualDiscoveryApplyResult = {
  applied: Array<{
    secretId: string;
    knowledgeState: PersonaSecretKnowledgeState;
    changed: boolean;
    eventId: string | null;
  }>;
};

function resolveNextState(
  existing: PersonaSecretKnowledgeState | "UNKNOWN",
  incoming: PersonaSecretKnowledgeState
): PersonaSecretKnowledgeState {
  if (knowledgeStateRank(incoming) > knowledgeStateRank(existing)) return incoming;
  if (existing === "UNKNOWN") return incoming;
  return existing === "CONFIRMED" ? "CONFIRMED" : existing === "SUSPECTED" ? "SUSPECTED" : incoming;
}

/**
 * Apply visual discovery matches: evidence events + monotonic knowledge transitions.
 * Never stores canonical secret text in evidence JSON.
 */
export function applyVisualDiscoveryMatches(opts: {
  chatId: number;
  personaId: number;
  /** Main character id — used only for legacy reveal rows when observer is that CHARACTER. */
  characterId: number;
  observerType?: PersonaSecretObserverType;
  observerId?: string;
  turnNumber: number;
  sourceMessageId?: number | null;
  matches: VisualDiscoveryMatch[];
  db?: Database.Database;
}): VisualDiscoveryApplyResult {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  const observerType: PersonaSecretObserverType =
    opts.observerType ?? "CHARACTER";
  const observerId = opts.observerId ?? String(opts.characterId);
  const applied: VisualDiscoveryApplyResult["applied"] = [];

  const tx = db.transaction(() => {
    // Group by secret — apply highest state once for knowledge, keep each evidence row.
    const bySecret = new Map<string, VisualDiscoveryMatch[]>();
    for (const m of opts.matches) {
      const list = bySecret.get(m.secretId) ?? [];
      list.push(m);
      bySecret.set(m.secretId, list);
    }

    for (const [secretId, secretMatches] of bySecret) {
      let highest: PersonaSecretKnowledgeState = "SUSPECTED";
      for (const m of secretMatches) {
        highest =
          knowledgeStateRank(m.resultState) > knowledgeStateRank(highest)
            ? m.resultState
            : highest;
      }

      let lastEventId: string | null = null;
      let anyInserted = false;
      let revealedForState = "";

      for (const m of secretMatches) {
        const fact = sanitizeRevealedFactForPrompt(m.revealedFactText);
        if (!fact) continue;
        if (m.resultState === highest) revealedForState = fact;

        const idempotencyKey = buildVisualDiscoveryIdempotencyKey({
          sceneEvidenceEventId: m.sceneEvidenceEventId,
          discoveryRuleId: m.discoveryRuleId,
          observerType,
          observerId,
          matcherVersion: m.matcherVersion,
        });

        const eventId = randomUUID();
        const insert = db
          .prepare(
            `INSERT OR IGNORE INTO persona_secret_evidence_events (
               id, idempotency_key, chat_id, turn_number, source_message_id,
               persona_id, secret_id, discovery_rule_id,
               observer_type, observer_id, method, source_type, resulting_state,
               revealed_fact_snapshot, evidence_json
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            eventId,
            idempotencyKey,
            opts.chatId,
            opts.turnNumber,
            opts.sourceMessageId ?? null,
            opts.personaId,
            secretId,
            m.discoveryRuleId,
            observerType,
            observerId,
            "VISUAL_DISCOVERY",
            m.sourceType,
            m.resultState,
            fact,
            JSON.stringify({
              sceneEvidenceEventId: m.sceneEvidenceEventId,
              eventType: m.eventType,
              matchedAttributes: m.matchedAttributes,
              observerType,
              observerId,
              matcherVersion: m.matcherVersion,
            })
          );

        if (insert.changes > 0) {
          anyInserted = true;
          lastEventId = eventId;
        } else {
          const existingEvent = db
            .prepare(
              `SELECT id FROM persona_secret_evidence_events WHERE idempotency_key=?`
            )
            .get(idempotencyKey) as { id: string } | undefined;
          lastEventId = existingEvent?.id ?? lastEventId;
        }
      }

      const existing = getObserverSecretKnowledge({
        chatId: opts.chatId,
        personaId: opts.personaId,
        secretId,
        observerType,
        observerId,
        db,
      });
      const currentState: PersonaSecretKnowledgeState | "UNKNOWN" = existing
        ? existing.knowledge_state
        : "UNKNOWN";
      const nextState = resolveNextState(currentState, highest);

      // No downgrade; skip knowledge write if unchanged and no new evidence.
      if (
        existing &&
        existing.knowledge_state === nextState &&
        !anyInserted
      ) {
        applied.push({
          secretId,
          knowledgeState: nextState,
          changed: false,
          eventId: lastEventId,
        });
        continue;
      }

      if (!lastEventId && existing) {
        applied.push({
          secretId,
          knowledgeState: existing.knowledge_state,
          changed: false,
          eventId: existing.last_evidence_event_id,
        });
        continue;
      }
      if (!lastEventId) continue;

      const factSnapshot =
        sanitizeRevealedFactForPrompt(revealedForState) ||
        sanitizeRevealedFactForPrompt(existing?.fact_snapshot ?? "");
      if (!factSnapshot) continue;

      // Monotonic: never replace CONFIRMED fact with weaker SUSPECTED text.
      const storeFact =
        existing?.knowledge_state === "CONFIRMED" && nextState === "CONFIRMED"
          ? sanitizeRevealedFactForPrompt(existing.fact_snapshot) || factSnapshot
          : factSnapshot;

      upsertObserverSecretKnowledge({
        chatId: opts.chatId,
        personaId: opts.personaId,
        secretId,
        observerType,
        observerId,
        knowledgeState: nextState,
        confidence: nextState === "CONFIRMED" ? 100 : 70,
        factSnapshot: storeFact,
        firstSuspectedTurn:
          nextState === "SUSPECTED" || currentState === "UNKNOWN"
            ? opts.turnNumber
            : existing?.first_suspected_turn ?? opts.turnNumber,
        confirmedTurn: nextState === "CONFIRMED" ? opts.turnNumber : null,
        lastEvidenceEventId: lastEventId,
        db,
      });

      // USER_AUTHORED_DISCLOSURE compatibility reveal writes are Direct-Disclosure only.

      applied.push({
        secretId,
        knowledgeState: nextState,
        changed:
          !existing ||
          existing.knowledge_state !== nextState ||
          anyInserted,
        eventId: lastEventId,
      });
    }
  });

  tx();
  return { applied };
}
