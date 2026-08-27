/**
 * S4 variant projection — evidence activation overlay.
 *
 * persona_secret_evidence_events remains append-only history.
 * Variant-scoped S4 transfer evidence gets an activation row; S1/S2/S3 and
 * legacy unscoped S4 have no row and are always effective.
 */

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

export type PersonaSecretEvidenceActivationRow = {
  evidence_id: string;
  chat_id: number;
  assistant_message_id: number;
  generation_sequence: number;
  is_active: number;
  updated_at: string;
};

export type ObserverSecretProjectionKey = {
  personaId: number;
  secretId: string;
  observerType: string;
  observerId: string;
};

/** Idempotent runtime + boot migration twin for activation overlay. */
export function ensurePersonaSecretEvidenceActivationSchema(
  db: Database.Database = getDb()
): void {
  const addColumn = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };

  const tableInfo = db.prepare(`PRAGMA table_info(knowledge_transfer_events)`).all() as {
    name: string;
  }[];
  if (tableInfo.length > 0) {
    addColumn("knowledge_transfer_events", "source_assistant_message_id", "INTEGER");
    addColumn("knowledge_transfer_events", "source_generation_sequence", "INTEGER");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS persona_secret_evidence_activation (
      evidence_id TEXT PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      assistant_message_id INTEGER NOT NULL,
      generation_sequence INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_secret_evidence_activation_assistant
      ON persona_secret_evidence_activation(chat_id, assistant_message_id, generation_sequence);
  `);
}

export function insertVariantScopedEvidenceActivation(opts: {
  evidenceId: string;
  chatId: number;
  assistantMessageId: number;
  generationSequence: number;
  isActive: boolean;
  db?: Database.Database;
}): void {
  const db = opts.db ?? getDb();
  ensurePersonaSecretEvidenceActivationSchema(db);
  db.prepare(
    `INSERT INTO persona_secret_evidence_activation (
       evidence_id, chat_id, assistant_message_id, generation_sequence, is_active, updated_at
     ) VALUES (?,?,?,?,?,datetime('now'))
     ON CONFLICT(evidence_id) DO UPDATE SET
       is_active=excluded.is_active,
       generation_sequence=excluded.generation_sequence,
       updated_at=datetime('now')`
  ).run(
    opts.evidenceId,
    opts.chatId,
    opts.assistantMessageId,
    opts.generationSequence,
    opts.isActive ? 1 : 0
  );
}

export function getEvidenceActivation(
  evidenceId: string,
  db: Database.Database = getDb()
): PersonaSecretEvidenceActivationRow | null {
  ensurePersonaSecretEvidenceActivationSchema(db);
  const row = db
    .prepare(`SELECT * FROM persona_secret_evidence_activation WHERE evidence_id=?`)
    .get(evidenceId) as PersonaSecretEvidenceActivationRow | undefined;
  return row ?? null;
}

/** Variant-scoped S4 transfer evidence exists for this assistant message. */
export function hasVariantScopedS4EvidenceOnAssistant(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number
): boolean {
  ensurePersonaSecretEvidenceActivationSchema(db);
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM persona_secret_evidence_activation
       WHERE chat_id=? AND assistant_message_id=?
       LIMIT 1`
    )
    .get(chatId, assistantMessageId) as { ok: number } | undefined;
  return Boolean(row);
}

export function listProjectionKeysForAssistantActivations(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number
): ObserverSecretProjectionKey[] {
  ensurePersonaSecretEvidenceActivationSchema(db);
  return db
    .prepare(
      `SELECT DISTINCT
         e.persona_id AS personaId,
         e.secret_id AS secretId,
         e.observer_type AS observerType,
         e.observer_id AS observerId
       FROM persona_secret_evidence_activation a
       JOIN persona_secret_evidence_events e ON e.id = a.evidence_id
       WHERE a.chat_id=? AND a.assistant_message_id=?`
    )
    .all(chatId, assistantMessageId) as ObserverSecretProjectionKey[];
}

/**
 * Set active generation for variant-scoped S4 evidence on one assistant message.
 * Returns observer/secret keys that require knowledge reprojection.
 */
export function syncVariantScopedS4ActivationsForAssistantMessage(
  db: Database.Database,
  input: {
    chatId: number;
    assistantMessageId: number;
    activeGenerationSequence: number;
  }
): ObserverSecretProjectionKey[] {
  ensurePersonaSecretEvidenceActivationSchema(db);
  db.prepare(
    `UPDATE persona_secret_evidence_activation
     SET is_active = CASE WHEN generation_sequence = ? THEN 1 ELSE 0 END,
         updated_at = datetime('now')
     WHERE chat_id = ? AND assistant_message_id = ?`
  ).run(input.activeGenerationSequence, input.chatId, input.assistantMessageId);

  return listProjectionKeysForAssistantActivations(
    db,
    input.chatId,
    input.assistantMessageId
  );
}
