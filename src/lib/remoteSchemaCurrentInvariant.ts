import type Database from "better-sqlite3";
import { hasChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";

export type SchemaDatabase = Pick<Database.Database, "exec" | "prepare">;

function tableExists(db: SchemaDatabase, name: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name)
  );
}

function hasColumn(db: SchemaDatabase, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

/** #774 — legacy memory_buffer table must be absent on current schema. */
export function hasMemoryBufferRetired(db: SchemaDatabase): boolean {
  return !tableExists(db, "memory_buffer");
}

/** #776 — legacy character_memories table must be absent on current schema. */
export function hasCharacterMemoriesRetired(db: SchemaDatabase): boolean {
  return !tableExists(db, "character_memories");
}

/**
 * #779 Phase 1 — chat_memories + pinned_facts carrier exist and no dirty rows.
 * Fail-closed: missing table/column is not clean.
 * ACTUAL DATA STATE > FLAG.
 */
export function hasPinnedFactsPhase1Clean(db: SchemaDatabase): boolean {
  if (!tableExists(db, "chat_memories")) return false;
  if (!hasColumn(db, "chat_memories", "pinned_facts")) return false;
  return !Boolean(
    db
      .prepare(
        `SELECT 1 AS ok FROM chat_memories
         WHERE COALESCE(pinned_facts, '') <> ''
         LIMIT 1`
      )
      .get()
  );
}

export function hasMemoryRetirementsCurrentSchema(db: SchemaDatabase): boolean {
  return (
    hasMemoryBufferRetired(db) &&
    hasCharacterMemoriesRetired(db) &&
    hasPinnedFactsPhase1Clean(db)
  );
}

/** Production remote schema tables/flags/columns required for safe adoption. */
export function hasRequiredProductionRemoteSchema(db: SchemaDatabase): boolean {
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

  if (!tableExists(db, "_schema_flags")) return false;
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

  if (!tableExists(db, "characters")) return false;
  const characters = db.prepare("SELECT COUNT(*) AS c FROM characters").get() as { c: number };
  if (Number(characters.c) <= 0) return false;

  return (
    hasColumn(db, "messages", "request_id") &&
    hasColumn(db, "users", "comment_report_restricted_until") &&
    hasColumn(db, "profile_comments", "delete_reason") &&
    hasColumn(db, "characters", "total_turns")
  );
}

/** Canonical current remote production schema — single owner for isCurrent/adopt/post-assert. */
export function hasCurrentRemoteSchemaInvariant(db: SchemaDatabase): boolean {
  try {
    return (
      hasChatBillingSettlementSchema(db) &&
      hasMemoryRetirementsCurrentSchema(db) &&
      hasRequiredProductionRemoteSchema(db)
    );
  } catch {
    return false;
  }
}
