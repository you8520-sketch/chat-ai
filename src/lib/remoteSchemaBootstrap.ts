import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { hasChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";

export const REMOTE_SCHEMA_VERSION = "turso-v2-chat-billing-settlement";
export const REMOTE_SCHEMA_VERSION_PREVIOUS = "turso-v1";

const LOCK_STALE_AFTER_MS = 5 * 60_000;
const WAIT_ATTEMPTS = 360;
const WAIT_MS = 250;

type SchemaDatabase = Pick<Database.Database, "exec" | "prepare">;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ensureControlTables(db: SchemaDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _remote_schema_state (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS _remote_schema_lock (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      owner TEXT NOT NULL,
      acquired_at_ms INTEGER NOT NULL
    );
  `);
}

function isCurrent(db: SchemaDatabase): boolean {
  return Boolean(
    db.prepare("SELECT 1 AS ok FROM _remote_schema_state WHERE version=?").get(
      REMOTE_SCHEMA_VERSION
    )
  );
}

function markCurrent(db: SchemaDatabase): void {
  db.prepare("INSERT OR REPLACE INTO _remote_schema_state (version) VALUES (?)").run(
    REMOTE_SCHEMA_VERSION
  );
}

function hasColumn(db: SchemaDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

/** Adopt databases that already contain the full production schema including settlement UNIQUE owner. */
export function canAdoptExistingRemoteSchema(db: SchemaDatabase): boolean {
  try {
    if (!hasChatBillingSettlementSchema(db)) return false;

    const tables = db
      .prepare(
        `SELECT COUNT(*) AS c FROM sqlite_master
         WHERE type='table' AND name IN (
           'web_push_outbox',
           'create_migration_event_applications',
           'beta_free_point_applications',
           'portone_checkouts'
         )`
      )
      .get() as { c: number };
    if (Number(tables.c) !== 4) return false;

    const flags = db
      .prepare(
        `SELECT COUNT(*) AS c FROM _schema_flags
         WHERE key IN (
           'board_posts_dedupe_v1',
           'target_response_chars_unified_3200',
           'memory_capacity_fixed_10000',
           'character_adult_status_metadata_v1'
         )`
      )
      .get() as { c: number };
    if (Number(flags.c) !== 4) return false;

    const characters = db.prepare("SELECT COUNT(*) AS c FROM characters").get() as { c: number };
    return (
      Number(characters.c) > 0 &&
      hasColumn(db, "messages", "request_id") &&
      hasColumn(db, "users", "comment_report_restricted_until") &&
      hasColumn(db, "profile_comments", "delete_reason") &&
      hasColumn(db, "characters", "total_turns")
    );
  } catch {
    return false;
  }
}

function tryAcquireLock(db: SchemaDatabase, owner: string): boolean {
  db.prepare("DELETE FROM _remote_schema_lock WHERE acquired_at_ms < ?").run(
    Date.now() - LOCK_STALE_AFTER_MS
  );
  db.prepare(
    "INSERT OR IGNORE INTO _remote_schema_lock (id, owner, acquired_at_ms) VALUES (1, ?, ?)"
  ).run(owner, Date.now());
  const lock = db.prepare("SELECT owner FROM _remote_schema_lock WHERE id=1").get() as
    | { owner: string }
    | undefined;
  return lock?.owner === owner;
}

function releaseLock(db: SchemaDatabase, owner: string): void {
  db.prepare("DELETE FROM _remote_schema_lock WHERE id=1 AND owner=?").run(owner);
}

export function initializeRemoteSchema(db: SchemaDatabase, migrate: () => void): void {
  ensureControlTables(db);
  if (isCurrent(db)) return;
  if (canAdoptExistingRemoteSchema(db)) {
    markCurrent(db);
    return;
  }

  const owner = randomUUID();
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    if (isCurrent(db)) return;
    if (tryAcquireLock(db, owner)) {
      try {
        migrate();
        markCurrent(db);
        return;
      } finally {
        releaseLock(db, owner);
      }
    }
    sleepSync(WAIT_MS);
  }
  throw new Error("Timed out waiting for the remote database schema migration lock.");
}
