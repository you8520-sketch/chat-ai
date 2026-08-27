import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensureObserverSchema } from "@/lib/observerSchema";
import { ensurePersonaSecretEvidenceActivationSchema } from "@/lib/personaSecretEvidenceActivation";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";

/** Runtime twin of boot migration — safe for handlers/tests. */
export function ensureKnowledgeTransferSchema(
  db: Database.Database = getDb()
): void {
  ensurePersonaSecretDiscoverySchema(db);
  ensureObserverSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_transfer_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,

      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      source_message_id INTEGER,

      persona_id INTEGER NOT NULL,
      secret_id TEXT NOT NULL,

      sender_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,

      receiver_type TEXT NOT NULL,
      receiver_id TEXT NOT NULL,

      sender_state_snapshot TEXT NOT NULL,
      resulting_state TEXT NOT NULL,
      fact_snapshot TEXT NOT NULL,

      transfer_type TEXT NOT NULL,
      source_type TEXT NOT NULL,

      channel_type TEXT NOT NULL DEFAULT 'DIRECT',
      evidence_json TEXT NOT NULL DEFAULT '{}',

      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_transfer_receiver
    ON knowledge_transfer_events(
      chat_id,
      receiver_type,
      receiver_id,
      created_at
    );
  `);
  ensurePersonaSecretEvidenceActivationSchema(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_transfer_variant_provenance
    ON knowledge_transfer_events(
      chat_id,
      source_assistant_message_id,
      source_generation_sequence
    );
  `);
}
