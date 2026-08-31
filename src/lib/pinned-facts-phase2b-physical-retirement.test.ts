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
  dropPinnedFactsColumnOnce,
} from "@/lib/db";
import {
  ensureChatBillingSettlementSchema,
} from "@/lib/chatBillingSettlementSchema";
import { calcUsedChars } from "@/lib/memory/memory-used-chars";
import { migrateLegacyPinnedFactsIntoRecentSummary } from "@/lib/memory/pinned-facts-migration";
import {
  countDirtyPinnedRows,
  listBlockingPinnedFactsSchemaDependencies,
} from "@/lib/memory/pinned-facts-column-retirement";
import {
  hasCurrentRemoteSchemaInvariant,
  hasPinnedFactsDropCompatible,
  hasPinnedFactsPhase1Clean,
  hasPinnedFactsPhysicallyRetired,
} from "@/lib/remoteSchemaCurrentInvariant";
import {
  initializeRemoteSchema,
  REMOTE_SCHEMA_VERSION,
  REMOTE_SCHEMA_VERSION_PREVIOUS,
} from "@/lib/remoteSchemaBootstrap";

/** Frozen historical remote schema markers — do not import current REMOTE_SCHEMA_VERSION for legacy fixtures. */
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
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_chat_memories_user ON chat_memories(user_id);
    CREATE INDEX idx_chat_memories_character ON chat_memories(character_id);
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
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedHistoricalMarker(db: Database.Database, version: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _remote_schema_state (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR REPLACE INTO _remote_schema_state (version) VALUES ('${version}');
  `);
}

function seedV5CurrentMarker(db: Database.Database): void {
  seedHistoricalMarker(db, REMOTE_SCHEMA_VERSION);
}

function createLegacyMemoryBuffer(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      message_index INTEGER NOT NULL DEFAULT 0,
      chat_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function createLegacyCharacterMemories(db: Database.Database): void {
  db.exec(`
    CREATE TABLE character_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function runFullMemoryRetirementMigrations(db: Database.Database): void {
  dropLegacyMemoryBufferTableOnce(db);
  dropLegacyCharacterMemoriesTableOnce(db);
  migrateLegacyPinnedFactsIntoRecentSummary(db);
  dropPinnedFactsColumnOnce(db);
}

function hasPinnedColumn(db: Database.Database): boolean {
  const cols = db.prepare(`PRAGMA table_info(chat_memories)`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === "pinned_facts");
}

function readRecentSummary(db: Database.Database, chatId = 1): string {
  return (
    db.prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`).get(chatId) as
      | { recent_summary: string }
      | undefined
  )?.recent_summary ?? "";
}

function insertFullParityRow(db: Database.Database): void {
  db.prepare(
    `INSERT INTO chat_memories (
      chat_id, user_id, character_id, pinned_facts,
      recent_summary, archive_summary, membership_tier, used_chars,
      message_count, summarized_turn_count, memory_reset_after_message_id,
      memory_epoch, last_compressed_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    42,
    7,
    9,
    "",
    "recent body",
    "archive body",
    "premium",
    calcUsedChars({ recent_summary: "recent body", archive_summary: "archive body" }),
    11,
    5,
    100,
    2,
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
    "2026-01-02T00:00:00Z"
  );
}

type ParityRow = {
  id: number;
  chat_id: number;
  user_id: number;
  character_id: number;
  recent_summary: string;
  archive_summary: string;
  membership_tier: string;
  used_chars: number;
  message_count: number;
  summarized_turn_count: number;
  memory_reset_after_message_id: number | null;
  memory_epoch: number;
  last_compressed_at: string | null;
  created_at: string;
  updated_at: string;
};

function readParityRow(db: Database.Database): ParityRow {
  return db
    .prepare(
      `SELECT id, chat_id, user_id, character_id, recent_summary, archive_summary,
              membership_tier, used_chars, message_count, summarized_turn_count,
              memory_reset_after_message_id, memory_epoch, last_compressed_at,
              created_at, updated_at
       FROM chat_memories WHERE chat_id=42`
    )
    .get() as ParityRow;
}

describe("pinned_facts Phase 2B physical retirement invariant", () => {
  it("P2B-1 V5 requires chat_memories exists and pinned_facts absent", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("P2B-2 carrier present fails V5 physical retirement even when clean", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithPinned(db);
    ensureChatBillingSettlementSchema(db);
    seedProductionRemoteCoreTablesExceptChatMemories(db);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), false);
    db.close();
  });

  it("P2B-3 V5 marker + recreated pinned column is not current", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedV5CurrentMarker(db);
    db.exec(`ALTER TABLE chat_memories ADD COLUMN pinned_facts TEXT NOT NULL DEFAULT ''`);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    db.close();
  });
});

function seedProductionRemoteCoreTablesExceptChatMemories(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_push_outbox (id INTEGER);
    CREATE TABLE IF NOT EXISTS create_migration_event_applications (id INTEGER);
    CREATE TABLE IF NOT EXISTS beta_free_point_applications (id INTEGER);
    CREATE TABLE IF NOT EXISTS portone_checkouts (id INTEGER);
    CREATE TABLE IF NOT EXISTS _schema_flags (key TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO _schema_flags (key) VALUES
      ('board_posts_dedupe_v1'),
      ('target_response_chars_unified_3200'),
      ('memory_capacity_fixed_10000'),
      ('character_adult_status_metadata_v1');
    CREATE TABLE IF NOT EXISTS messages (request_id TEXT);
    CREATE TABLE IF NOT EXISTS users (comment_report_restricted_until TEXT);
    CREATE TABLE IF NOT EXISTS profile_comments (delete_reason TEXT);
    CREATE TABLE IF NOT EXISTS characters (id INTEGER, total_turns INTEGER);
    INSERT OR IGNORE INTO characters (id, total_turns) VALUES (1, 0);
  `);
}

describe("pinned_facts Phase 2B DROP helper fail-closed", () => {
  it("P2B-4 dirty direct DROP refused — column and data preserved", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithPinned(db);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'dirty legacy', 'recent', '', 0)`
    ).run();

    assert.throws(() => dropPinnedFactsColumnOnce(db), /Refusing to DROP/);
    assert.equal(hasPinnedColumn(db), true);
    assert.equal(countDirtyPinnedRows(db), 1);
    assert.equal(readRecentSummary(db), "recent");
    db.close();
  });

  it("P2B-5 full migration fold then DROP passes for dirty row", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithPinned(db);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'legacy', 'recent', '', 0)`
    ).run();

    migrateLegacyPinnedFactsIntoRecentSummary(db);
    dropPinnedFactsColumnOnce(db);

    assert.equal(hasPinnedColumn(db), false);
    assert.equal(readRecentSummary(db), "legacy\n\nrecent");
    db.close();
  });

  it("P2B-6 already absent is no-op", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    assert.doesNotThrow(() => dropPinnedFactsColumnOnce(db));
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    db.close();
  });

  it("P2B-7 chat_memories missing is no-op", () => {
    const db = new Database(":memory:");
    assert.doesNotThrow(() => dropPinnedFactsColumnOnce(db));
    db.close();
  });
});

describe("pinned_facts Phase 2B data and index parity", () => {
  it("P2B-8 non-pinned fields preserved across DROP", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithPinned(db);
    insertFullParityRow(db);
    const before = readParityRow(db);

    dropPinnedFactsColumnOnce(db);
    const after = readParityRow(db);

    assert.equal(hasPinnedColumn(db), false);
    assert.equal(after.id, before.id);
    assert.equal(after.chat_id, before.chat_id);
    assert.equal(after.user_id, before.user_id);
    assert.equal(after.character_id, before.character_id);
    assert.equal(after.recent_summary, before.recent_summary);
    assert.equal(after.archive_summary, before.archive_summary);
    assert.equal(after.membership_tier, before.membership_tier);
    assert.equal(after.used_chars, before.used_chars);
    assert.equal(after.message_count, before.message_count);
    assert.equal(after.summarized_turn_count, before.summarized_turn_count);
    assert.equal(after.memory_reset_after_message_id, before.memory_reset_after_message_id);
    assert.equal(after.memory_epoch, before.memory_epoch);
    assert.equal(after.last_compressed_at, before.last_compressed_at);
    assert.equal(after.created_at, before.created_at);
    assert.equal(after.updated_at, before.updated_at);
    db.close();
  });

  it("P2B-9 indexes and UNIQUE(chat_id) preserved; post-drop insert enforces uniqueness", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithPinned(db);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_memories_user ON chat_memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_memories_character ON chat_memories(character_id);
    `);
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, pinned_facts) VALUES (1, 1, 2, '')`
    ).run();

    dropPinnedFactsColumnOnce(db);

    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='index' AND tbl_name='chat_memories' AND name NOT LIKE 'sqlite_autoindex%'`
      )
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name).sort();
    assert.deepEqual(indexNames, ["idx_chat_memories_character", "idx_chat_memories_user"]);

    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id) VALUES (2, 1, 2)`
    ).run();
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO chat_memories (chat_id, user_id, character_id) VALUES (1, 3, 4)`
        ).run(),
      /UNIQUE constraint failed/
    );
    db.close();
  });
});

describe("pinned_facts Phase 2B remote lifecycle", () => {
  it("P2B-10 V4 clean carrier → V5 migrate drops column", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCoreTablesExceptChatMemories(db);
    ensureChatMemoriesWithPinned(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V4);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
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

  it("P2B-11 V4 absent carrier → V5 adopt without migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V4);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
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

  it("P2B-12 V4 dirty carrier → fold + DROP preserves legacy in recent_summary", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCoreTablesExceptChatMemories(db);
    ensureChatMemoriesWithPinned(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V4);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'legacy', 'recent', '', 0)`
    ).run();

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasPinnedColumn(db), false);
    assert.equal(readRecentSummary(db), "legacy\n\nrecent");
    db.close();
  });

  it("P2B-13 V3 direct → V5 fold + drop", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCoreTablesExceptChatMemories(db);
    ensureChatMemoriesWithPinned(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V3);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'v3 legacy', 'recent', '', 0)`
    ).run();

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasPinnedColumn(db), false);
    assert.match(readRecentSummary(db), /v3 legacy/);
    db.close();
  });

  it("P2B-14 V2 legacy stack direct → V5 convergence", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCoreTablesExceptChatMemories(db);
    ensureChatMemoriesWithPinned(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V3);
    createLegacyMemoryBuffer(db);
    createLegacyCharacterMemories(db);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
       VALUES (1, 1, 2, 'legacy', 'recent', '', 0)`
    ).run();

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(
      Boolean(
        db
          .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='memory_buffer'`)
          .get()
      ),
      false
    );
    assert.equal(
      Boolean(
        db
          .prepare(
            `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='character_memories'`
          )
          .get()
      ),
      false
    );
    assert.equal(hasPinnedColumn(db), false);
    assert.equal(readRecentSummary(db), "legacy\n\nrecent");
    db.close();
  });

  it("P2B-15 V5 recreated clean carrier → repair drop", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runFullMemoryRetirementMigrations(db);
    seedV5CurrentMarker(db);
    db.exec(`ALTER TABLE chat_memories ADD COLUMN pinned_facts TEXT NOT NULL DEFAULT ''`);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasPinnedColumn(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("P2B-16 V5 recreated dirty carrier → fold + drop preserves content", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runFullMemoryRetirementMigrations(db);
    seedV5CurrentMarker(db);
    db.prepare(`INSERT INTO chat_memories (chat_id, user_id, character_id) VALUES (1, 1, 2)`).run();
    db.exec(`ALTER TABLE chat_memories ADD COLUMN pinned_facts TEXT NOT NULL DEFAULT ''`);
    db.prepare(`UPDATE chat_memories SET pinned_facts=?, recent_summary=? WHERE chat_id=1`).run(
      "rollback legacy",
      "recent"
    );

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasPinnedColumn(db), false);
    assert.match(readRecentSummary(db), /rollback legacy/);
    db.close();
  });

  it("P2B-17 fresh V5 remote DB: no-op migrations + invariant + marker", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 0);
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
});

describe("pinned_facts Phase 2B rollback contract (documentation)", () => {
  it("P2B-18 V5 → V4 rollback safe (missing column); V3 shim not added", () => {
    assert.equal(REMOTE_SCHEMA_VERSION, "turso-v5-pinned-column-retired");
    assert.equal(REMOTE_SCHEMA_VERSION_PREVIOUS, HISTORICAL_REMOTE_SCHEMA_V4);
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    db.close();
  });
});

describe("pinned_facts Phase 2B schema dependency audit", () => {
  it("P2B-19 production-like fixture has no blocking pinned_facts dependencies", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithPinned(db);
    assert.deepEqual(listBlockingPinnedFactsSchemaDependencies(db), []);
    db.close();
  });
});
