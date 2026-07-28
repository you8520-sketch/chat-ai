import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

/** Runtime twin of boot migration — safe to call from handlers/tests. */
export function ensurePersonaSecretDiscoverySchema(
  db: Database.Database = getDb()
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS persona_secrets (
      id TEXT PRIMARY KEY,
      persona_id INTEGER NOT NULL,
      secret_key TEXT NOT NULL,
      owner_title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'OTHER',
      importance TEXT NOT NULL DEFAULT 'NORMAL',
      canonical_secret_text TEXT NOT NULL,
      suspected_fact_text TEXT NOT NULL DEFAULT '',
      confirmed_fact_text TEXT NOT NULL,
      discoverability TEXT NOT NULL DEFAULT 'DISCOVERABLE',
      chat_scope_policy TEXT NOT NULL DEFAULT 'CHAT_ONLY',
      is_active INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(persona_id, secret_key)
    );
    CREATE INDEX IF NOT EXISTS idx_persona_secrets_persona
      ON persona_secrets(persona_id, is_active);

    CREATE TABLE IF NOT EXISTS persona_secret_discovery_rules (
      id TEXT PRIMARY KEY,
      secret_id TEXT NOT NULL,
      method TEXT NOT NULL,
      rule_key TEXT NOT NULL,
      result_state TEXT NOT NULL,
      revealed_fact_text TEXT NOT NULL,
      conditions_json TEXT NOT NULL DEFAULT '{}',
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(secret_id, rule_key)
    );
    CREATE INDEX IF NOT EXISTS idx_secret_discovery_rules_secret
      ON persona_secret_discovery_rules(secret_id, method, enabled);

    CREATE TABLE IF NOT EXISTS persona_secret_evidence_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      source_message_id INTEGER,
      persona_id INTEGER NOT NULL,
      secret_id TEXT NOT NULL,
      discovery_rule_id TEXT,
      observer_type TEXT NOT NULL,
      observer_id TEXT NOT NULL,
      method TEXT NOT NULL,
      source_type TEXT NOT NULL,
      resulting_state TEXT NOT NULL,
      revealed_fact_snapshot TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_secret_evidence_chat_observer
      ON persona_secret_evidence_events(chat_id, observer_type, observer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_secret_evidence_secret
      ON persona_secret_evidence_events(secret_id, chat_id);

    CREATE TABLE IF NOT EXISTS chat_character_secret_knowledge (
      chat_id INTEGER NOT NULL,
      persona_id INTEGER NOT NULL,
      secret_id TEXT NOT NULL,
      observer_type TEXT NOT NULL,
      observer_id TEXT NOT NULL,
      knowledge_state TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 0,
      fact_snapshot TEXT NOT NULL,
      first_suspected_turn INTEGER,
      confirmed_turn INTEGER,
      last_evidence_event_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, persona_id, secret_id, observer_type, observer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_secret_knowledge_runtime
      ON chat_character_secret_knowledge(
        chat_id, observer_type, observer_id, knowledge_state
      );
  `);
}
