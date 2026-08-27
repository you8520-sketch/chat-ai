/**
 * Persona-secret chat lifecycle cleanup — chat wipe + last-turn rewind.
 * Keeps evidence/knowledge/transfer/activation/scene/investigation rows
 * from outliving their owning chat or deleted last turn.
 */

import type Database from "better-sqlite3";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import { ensureObserverSchema } from "@/lib/observerSchema";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import { ensurePersonaSecretEvidenceActivationSchema } from "@/lib/personaSecretEvidenceActivation";
import type { PersonaSecretObserverType } from "@/lib/personaSecretDiscoveryTypes";
import { reprojectObserverSecretKnowledge } from "@/lib/personaSecretKnowledgeReprojection";
import { ensureChatPersonaSecretRevealsSchema } from "@/lib/personaSecretReveal";
import { ensureSceneEvidenceSchema } from "@/lib/sceneEvidenceSchema";

type ProjectionKey = {
  personaId: number;
  secretId: string;
  observerType: string;
  observerId: string;
};

function keyId(k: ProjectionKey): string {
  return `${k.personaId}\0${k.secretId}\0${k.observerType}\0${k.observerId}`;
}

function collectKeys(
  db: Database.Database,
  sql: string,
  params: unknown[]
): ProjectionKey[] {
  const rows = db.prepare(sql).all(...params) as Array<{
    persona_id: number;
    secret_id: string;
    observer_type: string;
    observer_id: string;
  }>;
  return rows.map((r) => ({
    personaId: r.persona_id,
    secretId: r.secret_id,
    observerType: r.observer_type,
    observerId: r.observer_id,
  }));
}

function reprojectKeys(
  db: Database.Database,
  chatId: number,
  keys: ProjectionKey[]
): void {
  const seen = new Set<string>();
  for (const key of keys) {
    const id = keyId(key);
    if (seen.has(id)) continue;
    seen.add(id);
    reprojectObserverSecretKnowledge({
      chatId,
      personaId: key.personaId,
      secretId: key.secretId,
      observerType: key.observerType as PersonaSecretObserverType,
      observerId: key.observerId,
      db,
    });
  }
}

/** Whole-chat wipe of persona-secret / scene / investigation derived rows. */
export function deletePersonaSecretRowsForChat(
  db: Database.Database,
  chatId: number
): void {
  ensurePersonaSecretDiscoverySchema(db);
  ensurePersonaSecretEvidenceActivationSchema(db);
  ensureKnowledgeTransferSchema(db);
  ensureSceneEvidenceSchema(db);
  ensureObserverSchema(db);
  ensureInvestigationSchema(db);
  ensureChatPersonaSecretRevealsSchema(db);

  db.prepare(
    `DELETE FROM persona_secret_evidence_activation WHERE chat_id=?`
  ).run(chatId);
  db.prepare(`DELETE FROM knowledge_transfer_events WHERE chat_id=?`).run(chatId);
  db.prepare(`DELETE FROM persona_secret_evidence_events WHERE chat_id=?`).run(
    chatId
  );
  db.prepare(`DELETE FROM chat_character_secret_knowledge WHERE chat_id=?`).run(
    chatId
  );
  db.prepare(`DELETE FROM chat_persona_secret_reveals WHERE chat_id=?`).run(
    chatId
  );
  db.prepare(`DELETE FROM scene_evidence_events WHERE chat_id=?`).run(chatId);
  db.prepare(`DELETE FROM scene_observer_presence WHERE chat_id=?`).run(chatId);
  db.prepare(`DELETE FROM chat_scenes WHERE chat_id=?`).run(chatId);
  db.prepare(`DELETE FROM chat_observers WHERE chat_id=?`).run(chatId);

  const chatOwnerId = String(chatId);
  const chatTargets = db
    .prepare(
      `SELECT id FROM investigation_targets
       WHERE owner_scope='CHAT' AND owner_id=?`
    )
    .all(chatOwnerId) as Array<{ id: string }>;
  if (chatTargets.length > 0) {
    const ids = chatTargets.map((t) => t.id);
    const ph = ids.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM investigation_results
       WHERE target_id IN (${ph})
          OR attempt_id IN (
            SELECT id FROM investigation_attempts WHERE target_id IN (${ph})
          )`
    ).run(...ids, ...ids);
    db.prepare(
      `DELETE FROM investigation_attempts WHERE target_id IN (${ph})`
    ).run(...ids);
    db.prepare(
      `DELETE FROM investigation_targets WHERE owner_scope='CHAT' AND owner_id=?`
    ).run(chatOwnerId);
  }

  // Chat-scoped attempts that never bound a target (or orphaned by chat_id).
  const orphanAttempts = db
    .prepare(`SELECT id FROM investigation_attempts WHERE chat_id=?`)
    .all(chatId) as Array<{ id: string }>;
  if (orphanAttempts.length > 0) {
    const ids = orphanAttempts.map((a) => a.id);
    const ph = ids.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM investigation_results WHERE attempt_id IN (${ph})`
    ).run(...ids);
    db.prepare(`DELETE FROM investigation_attempts WHERE chat_id=?`).run(chatId);
  }
}

/**
 * Last-turn delete rewind: remove evidence/transfers/activations tied to the
 * deleted messages, then reproject affected observer knowledge.
 */
export function rewindPersonaSecretStateForDeletedMessages(
  db: Database.Database,
  input: {
    chatId: number;
    messageIds: number[];
    assistantMessageId?: number | null;
  }
): void {
  const messageIds = input.messageIds.filter(
    (id) => Number.isFinite(id) && id > 0
  );
  if (messageIds.length === 0 && input.assistantMessageId == null) return;

  ensurePersonaSecretDiscoverySchema(db);
  ensurePersonaSecretEvidenceActivationSchema(db);
  ensureKnowledgeTransferSchema(db);
  ensureSceneEvidenceSchema(db);

  const keys: ProjectionKey[] = [];
  const msgPh = messageIds.map(() => "?").join(",");

  if (messageIds.length > 0) {
    keys.push(
      ...collectKeys(
        db,
        `SELECT DISTINCT persona_id, secret_id, observer_type, observer_id
         FROM persona_secret_evidence_events
         WHERE chat_id=? AND source_message_id IN (${msgPh})`,
        [input.chatId, ...messageIds]
      )
    );
    keys.push(
      ...collectKeys(
        db,
        `SELECT DISTINCT persona_id, secret_id, receiver_type AS observer_type,
                receiver_id AS observer_id
         FROM knowledge_transfer_events
         WHERE chat_id=? AND source_message_id IN (${msgPh})`,
        [input.chatId, ...messageIds]
      )
    );
  }

  if (input.assistantMessageId != null) {
    keys.push(
      ...collectKeys(
        db,
        `SELECT DISTINCT e.persona_id, e.secret_id, e.observer_type, e.observer_id
         FROM persona_secret_evidence_events e
         INNER JOIN persona_secret_evidence_activation a
           ON a.evidence_id = e.id
         WHERE a.chat_id=? AND a.assistant_message_id=?`,
        [input.chatId, input.assistantMessageId]
      )
    );
    keys.push(
      ...collectKeys(
        db,
        `SELECT DISTINCT persona_id, secret_id, receiver_type AS observer_type,
                receiver_id AS observer_id
         FROM knowledge_transfer_events
         WHERE chat_id=? AND source_assistant_message_id=?`,
        [input.chatId, input.assistantMessageId]
      )
    );
  }

  if (input.assistantMessageId != null) {
    db.prepare(
      `DELETE FROM persona_secret_evidence_activation
       WHERE chat_id=? AND assistant_message_id=?`
    ).run(input.chatId, input.assistantMessageId);
    db.prepare(
      `DELETE FROM knowledge_transfer_events
       WHERE chat_id=? AND source_assistant_message_id=?`
    ).run(input.chatId, input.assistantMessageId);
  }

  if (messageIds.length > 0) {
    db.prepare(
      `DELETE FROM knowledge_transfer_events
       WHERE chat_id=? AND source_message_id IN (${msgPh})`
    ).run(input.chatId, ...messageIds);
    db.prepare(
      `DELETE FROM persona_secret_evidence_events
       WHERE chat_id=? AND source_message_id IN (${msgPh})`
    ).run(input.chatId, ...messageIds);
    db.prepare(
      `DELETE FROM scene_evidence_events
       WHERE chat_id=? AND source_message_id IN (${msgPh})`
    ).run(input.chatId, ...messageIds);
  }

  reprojectKeys(db, input.chatId, keys);
}

/** Persona hard-delete: drop activation rows before evidence wipe. */
export function deletePersonaSecretActivationRowsForPersona(
  db: Database.Database,
  personaId: number
): void {
  ensurePersonaSecretEvidenceActivationSchema(db);
  ensurePersonaSecretDiscoverySchema(db);
  db.prepare(
    `DELETE FROM persona_secret_evidence_activation
     WHERE evidence_id IN (
       SELECT id FROM persona_secret_evidence_events WHERE persona_id=?
     )`
  ).run(personaId);
  db.prepare(
    `DELETE FROM persona_secret_evidence_activation
     WHERE chat_id IN (
       SELECT DISTINCT chat_id FROM chat_character_secret_knowledge WHERE persona_id=?
     )`
  ).run(personaId);
}
