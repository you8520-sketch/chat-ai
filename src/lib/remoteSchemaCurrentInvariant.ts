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

/** #774 — legacy memory_buffer table must be absent on current schema. */
export function hasMemoryBufferRetired(db: SchemaDatabase): boolean {
  return !tableExists(db, "memory_buffer");
}

/** #776 — legacy character_memories table must be absent on current schema. */
export function hasCharacterMemoriesRetired(db: SchemaDatabase): boolean {
  return !tableExists(db, "character_memories");
}

/**
 * #779 Phase 1 — no non-empty pinned_facts rows (matches global fold migration scan).
 * ACTUAL DATA STATE > FLAG: flag alone is not sufficient.
 */
export function hasPinnedFactsPhase1Clean(db: SchemaDatabase): boolean {
  if (!tableExists(db, "chat_memories")) return true;
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

/** Canonical current remote production schema = billing settlement + memory retirements. */
export function hasCurrentRemoteSchemaInvariant(db: SchemaDatabase): boolean {
  return (
    hasChatBillingSettlementSchema(db) &&
    hasMemoryRetirementsCurrentSchema(db)
  );
}
