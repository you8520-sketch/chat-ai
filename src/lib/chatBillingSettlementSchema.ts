/**
 * Canonical schema owner for chat_billing_settlements.
 * Imported by db.ts migrate() and chatBillingSettlement.ts — no points/db imports.
 */

import type Database from "better-sqlite3";

export const CHAT_BILLING_SETTLEMENTS_TABLE = "chat_billing_settlements";

export const CHAT_BILLING_SETTLEMENT_UNIQUE_COLUMNS = [
  "user_id",
  "chat_id",
  "request_id",
  "charge_kind",
] as const;

export const CHAT_BILLING_SETTLEMENTS_DDL = `
  CREATE TABLE IF NOT EXISTS chat_billing_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    charge_kind TEXT NOT NULL DEFAULT 'chat_turn',
    assistant_message_id INTEGER,
    requested_points INTEGER NOT NULL,
    settled_points INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    deduction_slices_json TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'native',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, chat_id, request_id, charge_kind)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_billing_settlements_message
    ON chat_billing_settlements(assistant_message_id);
`;

const REQUIRED_COLUMNS = [
  "user_id",
  "chat_id",
  "request_id",
  "charge_kind",
  "assistant_message_id",
  "requested_points",
  "settled_points",
  "outcome",
  "deduction_slices_json",
  "reason",
  "source",
] as const;

export function ensureChatBillingSettlementSchema(db: Pick<Database.Database, "exec">): void {
  db.exec(CHAT_BILLING_SETTLEMENTS_DDL);
}

function tableExists(db: Pick<Database.Database, "prepare">, table: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`
    )
    .get(table) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

function hasColumn(db: Pick<Database.Database, "prepare">, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function hasCanonicalUniqueIndex(db: Pick<Database.Database, "prepare">): boolean {
  const indexes = db
    .prepare(`PRAGMA index_list(${CHAT_BILLING_SETTLEMENTS_TABLE})`)
    .all() as Array<{ name: string; unique: number }>;

  for (const index of indexes) {
    if (!index.unique) continue;
    const columns = db
      .prepare(`PRAGMA index_info(${index.name})`)
      .all() as Array<{ name: string; seqno: number }>;
    const names = columns.sort((a, b) => a.seqno - b.seqno).map((col) => col.name);
    if (
      names.length === CHAT_BILLING_SETTLEMENT_UNIQUE_COLUMNS.length &&
      CHAT_BILLING_SETTLEMENT_UNIQUE_COLUMNS.every((col, idx) => names[idx] === col)
    ) {
      return true;
    }
  }
  return false;
}

/** Source-backed verifier — table, identity columns, and canonical UNIQUE must all exist. */
export function hasChatBillingSettlementSchema(
  db: Pick<Database.Database, "prepare">
): boolean {
  if (!tableExists(db, CHAT_BILLING_SETTLEMENTS_TABLE)) return false;
  for (const column of REQUIRED_COLUMNS) {
    if (!hasColumn(db, CHAT_BILLING_SETTLEMENTS_TABLE, column)) return false;
  }
  return hasCanonicalUniqueIndex(db);
}
