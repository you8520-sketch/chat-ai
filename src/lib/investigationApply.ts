import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  buildInvestigationDiscoveryIdempotencyKey,
  type InvestigationDiscoveryMatch,
} from "@/lib/investigationMatcher";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type { PersonaSecretKnowledgeState } from "@/lib/personaSecretDiscoveryTypes";
import {
  getCharacterSecretKnowledge,
  upsertCharacterSecretKnowledge,
} from "@/lib/personaSecretKnowledge";
import {
  insertChatPersonaSecretReveal,
  sanitizeRevealedFactForPrompt,
} from "@/lib/personaSecretReveal";
import { knowledgeStateRank } from "@/lib/visualDiscoveryCatalog";

export type InvestigationDiscoveryApplyResult = {
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
  return existing === "CONFIRMED"
    ? "CONFIRMED"
    : existing === "SUSPECTED"
      ? "SUSPECTED"
      : incoming;
}

/**
 * Apply investigation discovery matches — evidence events + monotonic knowledge.
 * Never stores canonical secret text in evidence JSON.
 */
export function applyInvestigationDiscoveryMatches(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  matches: InvestigationDiscoveryMatch[];
  db?: Database.Database;
}): InvestigationDiscoveryApplyResult {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  const observerId = String(opts.characterId);
  const applied: InvestigationDiscoveryApplyResult["applied"] = [];

  const tx = db.transaction(() => {
    const bySecret = new Map<string, InvestigationDiscoveryMatch[]>();
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

        const idempotencyKey = buildInvestigationDiscoveryIdempotencyKey({
          investigationResultId: m.investigationResultId,
          discoveryRuleId: m.discoveryRuleId,
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
            "CHARACTER",
            observerId,
            "INVESTIGATION_DISCOVERY",
            m.sourceType,
            m.resultState,
            fact,
            JSON.stringify({
              investigationAttemptId: m.attemptId,
              investigationResultId: m.investigationResultId,
              targetId: m.targetId,
              resultType: m.resultType,
              matchedTags: m.matchedTags,
              observerType: "CHARACTER",
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

      const existing = getCharacterSecretKnowledge({
        chatId: opts.chatId,
        personaId: opts.personaId,
        secretId,
        characterId: opts.characterId,
        db,
      });
      const currentState: PersonaSecretKnowledgeState | "UNKNOWN" = existing
        ? existing.knowledge_state
        : "UNKNOWN";
      const nextState = resolveNextState(currentState, highest);

      if (existing && existing.knowledge_state === nextState && !anyInserted) {
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

      const storeFact =
        existing?.knowledge_state === "CONFIRMED" && nextState === "CONFIRMED"
          ? sanitizeRevealedFactForPrompt(existing.fact_snapshot) || factSnapshot
          : factSnapshot;

      upsertCharacterSecretKnowledge({
        chatId: opts.chatId,
        personaId: opts.personaId,
        secretId,
        characterId: opts.characterId,
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

      if (nextState === "CONFIRMED") {
        const secret = db
          .prepare(`SELECT secret_key FROM persona_secrets WHERE id=?`)
          .get(secretId) as { secret_key: string } | undefined;
        if (secret?.secret_key) {
          insertChatPersonaSecretReveal(
            {
              chatId: opts.chatId,
              personaId: opts.personaId,
              secretKey: secret.secret_key,
              revealedFactText: storeFact,
              revealedAtTurn: opts.turnNumber,
              source: "USER_AUTHORED_DISCLOSURE",
            },
            db
          );
        }
      }

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
