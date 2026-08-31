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
} from "@/lib/remoteSchemaCurrentInvariant";
import {
  initializeRemoteSchema,
  REMOTE_SCHEMA_VERSION,
  REMOTE_SCHEMA_VERSION_PREVIOUS,
} from "@/lib/remoteSchemaBootstrap";

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

function seedV3LegacyMarker(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _remote_schema_state (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR REPLACE INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION_PREVIOUS}');
  `);
}

function seedV4CurrentMarker(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _remote_schema_state (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR REPLACE INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION}');
  `);
}

describe("pinned_facts Phase 2A drop-compatible", () => {
  it("P2A-1 FAIL-BEFORE: missing pinned column breaks unguarded SQL and v3 Phase1 invariant", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec("DROP TABLE chat_memories");
    createChatMemoriesWithoutPinnedColumn(db);
    ensureChatBillingSettlementSchema(db);
    seedV4CurrentMarker(db);

    assert.throws(
      () => {
        db.prepare(`SELECT pinned_facts FROM chat_memories`).all();
      },
      /no such column/
    );
    assert.equal(hasPinnedFactsPhase1Clean(db), false);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
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
    db.close();
  });

  it("P2A-4 carrier absent satisfies drop-compatible invariant", () => {
    const db = new Database(":memory:");
    createChatMemoriesWithoutPinnedColumn(db);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
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

function runMemoryRetirementMigrations(db: Database.Database): void {
  dropLegacyMemoryBufferTableOnce(db);
  dropLegacyCharacterMemoriesTableOnce(db);
  migrateLegacyPinnedFactsIntoRecentSummary(db);
}

describe("pinned_facts Phase 2A remote lifecycle", () => {
  it("V3 dirty carrier migrates, folds legacy content, and marks V4", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedV3LegacyMarker(db);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'legacy', 'recent', '', 0)`
    ).run();
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    const row = db
      .prepare(`SELECT pinned_facts, recent_summary FROM chat_memories WHERE chat_id=1`)
      .get() as { pinned_facts: string; recent_summary: string };
    assert.equal(row.pinned_facts, "");
    assert.equal(row.recent_summary, "legacy\n\nrecent");
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    assert.equal(
      (
        db
          .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
          .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined
      )?.version,
      REMOTE_SCHEMA_VERSION
    );
    db.close();
  });

  it("V3 clean carrier adopts V4 without migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedV3LegacyMarker(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });

    assert.equal(migrations, 0);
    assert.equal(
      (
        db
          .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
          .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined
      )?.version,
      REMOTE_SCHEMA_VERSION
    );
    db.close();
  });

  it("V4 + carrier absent is current with migrate skipped", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec("DROP TABLE chat_memories");
    createChatMemoriesWithoutPinnedColumn(db);
    ensureChatBillingSettlementSchema(db);
    seedV4CurrentMarker(db);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });

    assert.equal(migrations, 0);
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
