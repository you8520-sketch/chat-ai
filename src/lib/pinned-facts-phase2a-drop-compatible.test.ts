import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  dropLegacyCharacterMemoriesTableOnce,
  dropLegacyMemoryBufferTableOnce,
} from "@/lib/db";
import {
  ensureChatBillingSettlementSchema,
} from "@/lib/chatBillingSettlementSchema";
import { migrateLegacyPinnedFactsIntoRecentSummary } from "@/lib/memory/pinned-facts-migration";
import {
  hasCurrentRemoteSchemaInvariant,
  hasPinnedFactsDropCompatible,
  hasPinnedFactsPhase1Clean,
  hasPinnedFactsPhysicallyRetired,
} from "@/lib/remoteSchemaCurrentInvariant";

/** Frozen historical remote schema markers for Phase 2A contract tests. */
const HISTORICAL_REMOTE_SCHEMA_V3 = "turso-v3-current-schema";
const HISTORICAL_REMOTE_SCHEMA_V4 = "turso-v4-pinned-drop-compatible";

function seedProductionRemoteCore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE web_push_outbox (id INTEGER);
    CREATE TABLE create_migration_event_applications (id INTEGER);
    CREATE TABLE beta_free_point_applications (id INTEGER);
    CREATE TABLE portone_checkouts (id INTEGER);
    CREATE TABLE _schema_flags (key TEXT PRIMARY KEY);
    INSERT INTO _schema_flags (key) VALUES
      ('board_posts_dedupe_v1'),
      ('target_response_chars_unified_3200'),
      ('memory_capacity_fixed_10000'),
      ('character_adult_status_metadata_v1');
    CREATE TABLE messages (request_id TEXT);
    CREATE TABLE users (comment_report_restricted_until TEXT);
    CREATE TABLE profile_comments (delete_reason TEXT);
    CREATE TABLE characters (id INTEGER, total_turns INTEGER);
    INSERT INTO characters (id, total_turns) VALUES (1, 0);
    CREATE TABLE chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function ensureChatMemoriesWithPinned(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function createChatMemoriesWithoutPinnedColumn(db: Database.Database): void {
  db.exec(`
    CREATE TABLE chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("pinned_facts Phase 2A drop-compatible (historical V4 contract)", () => {
  it("P2A-1 FAIL-BEFORE: missing pinned column breaks unguarded SQL and v3 Phase1 invariant", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec("DROP TABLE chat_memories");
    createChatMemoriesWithoutPinnedColumn(db);
    ensureChatBillingSettlementSchema(db);

    assert.throws(
      () => {
        db.prepare(`SELECT pinned_facts FROM chat_memories`).all();
      },
      /no such column/
    );
    assert.equal(hasPinnedFactsPhase1Clean(db), false);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    db.close();
  });

  it("P2A-2 migration is safe no-op when pinned_facts column is absent", () => {
    const db = new Database(":memory:");
    createChatMemoriesWithoutPinnedColumn(db);
    assert.doesNotThrow(() => migrateLegacyPinnedFactsIntoRecentSummary(db));
    db.close();
  });

  it("P2A-3 carrier present and clean satisfies drop-compatible invariant", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithPinned(db);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), false);
    db.close();
  });

  it("P2A-4 carrier absent satisfies drop-compatible invariant", () => {
    const db = new Database(":memory:");
    createChatMemoriesWithoutPinnedColumn(db);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    db.close();
  });

  it("P2A-5 carrier present and dirty fails drop-compatible invariant", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithPinned(db);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'dirty', 'recent', '', 0)`
    ).run();
    assert.equal(hasPinnedFactsDropCompatible(db), false);
    db.close();
  });

  it("P2A-6 chat_memories absent fails drop-compatible invariant", () => {
    const db = new Database(":memory:");
    assert.equal(hasPinnedFactsDropCompatible(db), false);
    db.close();
  });
});

describe("pinned_facts Phase 2A fold migration (historical)", () => {
  it("V3 dirty carrier folds legacy content via Phase 1 migration", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'legacy', 'recent', '', 0)`
    ).run();

    migrateLegacyPinnedFactsIntoRecentSummary(db);

    const row = db
      .prepare(`SELECT pinned_facts, recent_summary FROM chat_memories WHERE chat_id=1`)
      .get() as { pinned_facts: string; recent_summary: string };
    assert.equal(row.pinned_facts, "");
    assert.equal(row.recent_summary, "legacy\n\nrecent");
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    db.close();
  });

  it("V3 clean carrier remains drop-compatible after fold no-op", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    migrateLegacyPinnedFactsIntoRecentSummary(db);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    db.close();
  });

  it("V4 historical absent-column satisfied drop-compatible (not Phase1 clean)", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec("DROP TABLE chat_memories");
    createChatMemoriesWithoutPinnedColumn(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasPinnedFactsPhase1Clean(db), false);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    db.close();
  });
});

describe("DROP COLUMN capability audit (read-only)", () => {
  it("reports native DROP COLUMN support on current test driver", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE drop_audit (keep TEXT NOT NULL DEFAULT '', drop_me TEXT NOT NULL DEFAULT '')`);
    db.exec(`ALTER TABLE drop_audit DROP COLUMN drop_me`);
    const cols = db.prepare(`PRAGMA table_info(drop_audit)`).all() as Array<{ name: string }>;
    assert.equal(cols.some((c) => c.name === "keep"), true);
    assert.equal(cols.some((c) => c.name === "drop_me"), false);
    db.close();
  });
});

describe("historical remote schema version literals frozen", () => {
  it("V3/V4 markers remain stable for reachability fixtures", () => {
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V3, "turso-v3-current-schema");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V4, "turso-v4-pinned-drop-compatible");
  });
});
