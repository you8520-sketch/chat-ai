/**
 * Additive schema owner for the Main RP per-user generation lease.
 * One active row per user. Not a billing, refund, or generation_status store.
 */

import type Database from "better-sqlite3";

export const CHAT_GENERATION_LEASES_TABLE = "chat_generation_leases";

export const CHAT_GENERATION_LEASES_DDL = `
  CREATE TABLE IF NOT EXISTS chat_generation_leases (
    user_id INTEGER PRIMARY KEY,
    request_id TEXT NOT NULL,
    chat_id INTEGER,
    assistant_message_id INTEGER,
    lease_token TEXT NOT NULL,
    acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
    heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
`;

export function ensureChatGenerationLeaseSchema(
  db: Pick<Database.Database, "exec" | "prepare">
): void {
  db.exec(CHAT_GENERATION_LEASES_DDL);
}
