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
  dropLastCompressedAtColumnOnce,
  dropPinnedFactsColumnOnce,
} from "@/lib/db";
import {
  ensureChatBillingSettlementSchema,
} from "@/lib/chatBillingSettlementSchema";
import { calcUsedChars } from "@/lib/memory/memory-used-chars";
import { migrateLegacyPinnedFactsIntoRecentSummary } from "@/lib/memory/pinned-facts-migration";
import {
  listBlockingLastCompressedAtSchemaDependencies,
} from "@/lib/memory/last-compressed-at-column-retirement";
import {
  hasCharacterMemoriesRetired,
  hasCurrentRemoteSchemaInvariant,
  hasLastCompressedAtPhysicallyRetired,
  hasMemoryBufferRetired,
  hasPinnedFactsPhysicallyRetired,
} from "@/lib/remoteSchemaCurrentInvariant";
import {
  initializeRemoteSchema,
  REMOTE_SCHEMA_VERSION,
  REMOTE_SCHEMA_VERSION_PREVIOUS,
} from "@/lib/remoteSchemaBootstrap";

/** Frozen historical remote schema markers — do not use current REMOTE_SCHEMA_VERSION for legacy fixtures. */
const HISTORICAL_REMOTE_SCHEMA_V2 = "turso-v2-chat-billing-settlement";
const HISTORICAL_REMOTE_SCHEMA_V3 = "turso-v3-current-schema";
const HISTORICAL_REMOTE_SCHEMA_V4 = "turso-v4-pinned-drop-compatible";
const HISTORICAL_REMOTE_SCHEMA_V5 = "turso-v5-pinned-column-retired";

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
    CREATE TABLE messages (request_id TEXT, memory_relationship_task_json TEXT);
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_chat_memories_user ON chat_memories(user_id);
    CREATE INDEX idx_chat_memories_character ON chat_memories(character_id);
  `);
}

function ensureChatMemoriesWithLastCompressedAt(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_memories (
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
  `);
}

function ensureChatMemoriesWithPinnedAndLastCompressed(db: Database.Database): void {
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

function hasLastCompressedColumn(db: Database.Database): boolean {
  const cols = db.prepare(`PRAGMA table_info(chat_memories)`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === "last_compressed_at");
}

function runFullMemoryRetirementMigrations(db: Database.Database): void {
  dropLegacyMemoryBufferTableOnce(db);
  dropLegacyCharacterMemoriesTableOnce(db);
  migrateLegacyPinnedFactsIntoRecentSummary(db);
  dropPinnedFactsColumnOnce(db);
  dropLastCompressedAtColumnOnce(db);
}

function ensureMemoryRelationshipTaskColumn(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === "memory_relationship_task_json")) {
    db.exec(`ALTER TABLE messages ADD COLUMN memory_relationship_task_json TEXT`);
  }
}

function runV6DirectUpgradeMigrations(db: Database.Database): void {
  runFullMemoryRetirementMigrations(db);
  ensureMemoryRelationshipTaskColumn(db);
}

function seedV2HistoricalProductionCore(db: Database.Database): void {
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
  `);
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
  created_at: string;
  updated_at: string;
};

function insertFullParityRow(db: Database.Database, lastCompressedAt: string | null): void {
  db.prepare(
    `INSERT INTO chat_memories (
      chat_id, user_id, character_id,
      recent_summary, archive_summary, membership_tier, used_chars,
      message_count, summarized_turn_count, memory_reset_after_message_id,
      memory_epoch, last_compressed_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    42,
    7,
    9,
    "recent body",
    "archive body",
    "premium",
    calcUsedChars({ recent_summary: "recent body", archive_summary: "archive body" }),
    11,
    5,
    100,
    2,
    lastCompressedAt,
    "2026-01-01T00:00:00Z",
    "2026-01-02T00:00:00Z"
  );
}

function readParityRow(db: Database.Database): ParityRow {
  return db
    .prepare(
      `SELECT id, chat_id, user_id, character_id, recent_summary, archive_summary,
              membership_tier, used_chars, message_count, summarized_turn_count,
              memory_reset_after_message_id, memory_epoch, created_at, updated_at
       FROM chat_memories WHERE chat_id=42`
    )
    .get() as ParityRow;
}

describe("last_compressed_at V6 physical retirement invariant", () => {
  it("LC-V6-1 V6 requires chat_memories exists and last_compressed_at absent", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("LC-V6-2 carrier present fails V6 physical retirement", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithLastCompressedAt(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    db.close();
  });

  it("LC-V6-3 V6 marker + recreated last_compressed_at column is not current", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, REMOTE_SCHEMA_VERSION);
    db.exec(`ALTER TABLE chat_memories ADD COLUMN last_compressed_at TEXT`);
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    db.close();
  });
});

describe("last_compressed_at V6 DROP helper", () => {
  it("LC1 already absent is no-op", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    assert.doesNotThrow(() => dropLastCompressedAtColumnOnce(db));
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), true);
    db.close();
  });

  it("LC2 column present with NULL values DROP passes", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithLastCompressedAt(db);
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, last_compressed_at)
       VALUES (1, 1, 2, NULL)`
    ).run();

    dropLastCompressedAtColumnOnce(db);
    assert.equal(hasLastCompressedColumn(db), false);
    db.close();
  });

  it("LC3 column present with NON_NULL historical values DROP passes", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithLastCompressedAt(db);
    insertFullParityRow(db, "2026-01-01T00:00:00Z");
    const before = readParityRow(db);

    dropLastCompressedAtColumnOnce(db);
    const after = readParityRow(db);

    assert.equal(hasLastCompressedColumn(db), false);
    assert.deepEqual(after, before);
    db.close();
  });

  it("LC4 blocking schema dependency refuses DROP and preserves column", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithLastCompressedAt(db);
    db.exec(`
      CREATE INDEX idx_last_compressed_at_carrier
        ON chat_memories(last_compressed_at);
    `);

    assert.throws(() => dropLastCompressedAtColumnOnce(db), /Refusing to DROP/);
    assert.equal(hasLastCompressedColumn(db), true);
    db.close();
  });

  it("LC5 chat_memories missing is no-op and does not invent table", () => {
    const db = new Database(":memory:");
    assert.doesNotThrow(() => dropLastCompressedAtColumnOnce(db));
    assert.equal(
      Boolean(
        db
          .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='chat_memories'`)
          .get()
      ),
      false
    );
    db.close();
  });
});

describe("last_compressed_at V6 data and index parity", () => {
  it("LC-V6-4 non-carrier fields preserved across DROP with historical timestamp", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithLastCompressedAt(db);
    insertFullParityRow(db, "2020-06-15T12:00:00.000Z");
    const before = readParityRow(db);

    dropLastCompressedAtColumnOnce(db);
    const after = readParityRow(db);

    assert.equal(hasLastCompressedColumn(db), false);
    assert.deepEqual(after, before);
    db.close();
  });

  it("LC-V6-5 indexes and UNIQUE(chat_id) preserved; post-drop insert enforces uniqueness", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithLastCompressedAt(db);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_memories_user ON chat_memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_memories_character ON chat_memories(character_id);
    `);
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, last_compressed_at)
       VALUES (1, 1, 2, '2020-01-01T00:00:00Z')`
    ).run();

    dropLastCompressedAtColumnOnce(db);

    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='index' AND tbl_name='chat_memories' AND name NOT LIKE 'sqlite_autoindex%'`
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      indexes.map((i) => i.name).sort(),
      ["idx_chat_memories_character", "idx_chat_memories_user"]
    );

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

describe("last_compressed_at V6 remote lifecycle", () => {
  it("LC-V6-6 V5 present carrier → V6 migrate drops column", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithLastCompressedAt(db);
    ensureChatBillingSettlementSchema(db);
    seedProductionRemoteCoreTablesExceptChatMemories(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V5);
    insertFullParityRow(db, "2026-01-01T00:00:00Z");
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runV6DirectUpgradeMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasLastCompressedColumn(db), false);
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

  it("LC-V6-7 V5 absent carrier → V6 adopt without migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V5);
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), true);
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

  it("LC-V6-8 V6 recreated NULL carrier → repair drop", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runFullMemoryRetirementMigrations(db);
    seedHistoricalMarker(db, REMOTE_SCHEMA_VERSION);
    db.exec(`ALTER TABLE chat_memories ADD COLUMN last_compressed_at TEXT`);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      dropLastCompressedAtColumnOnce(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasLastCompressedColumn(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("LC-V6-9 V6 recreated NON_NULL carrier → repair drop", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runFullMemoryRetirementMigrations(db);
    seedHistoricalMarker(db, REMOTE_SCHEMA_VERSION);
    db.exec(`ALTER TABLE chat_memories ADD COLUMN last_compressed_at TEXT`);
    db.prepare(`INSERT INTO chat_memories (chat_id, user_id, character_id, last_compressed_at) VALUES (1,1,2,?)`).run(
      "rollback timestamp"
    );

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      dropLastCompressedAtColumnOnce(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasLastCompressedColumn(db), false);
    db.close();
  });

  it("LC-V6-10 V4 direct → V6 drops last_compressed_at", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCoreTablesExceptChatMemories(db);
    ensureChatMemoriesWithLastCompressedAt(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V4);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runV6DirectUpgradeMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasLastCompressedColumn(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("LC-V6-11 V3 direct → V6 convergence", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCoreTablesExceptChatMemories(db);
    ensureChatMemoriesWithPinnedAndLastCompressed(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V3);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars, last_compressed_at)
       VALUES (1, 1, 2, 'v3 legacy', 'recent', '', 0, '2025-01-01T00:00:00Z')`
    ).run();

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runV6DirectUpgradeMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasLastCompressedColumn(db), false);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("LC-V6-12 V2 legacy stack direct → V6 convergence", () => {
    const db = new Database(":memory:");
    seedV2HistoricalProductionCore(db);
    ensureChatMemoriesWithPinnedAndLastCompressed(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V2);
    createLegacyMemoryBuffer(db);
    createLegacyCharacterMemories(db);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars, last_compressed_at)
       VALUES (1, 1, 2, 'legacy', 'recent', '', 0, '2024-06-01T00:00:00Z')`
    ).run();
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runV6DirectUpgradeMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasMemoryBufferRetired(db), true);
    assert.equal(hasCharacterMemoriesRetired(db), true);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    assert.equal(hasLastCompressedColumn(db), false);
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

  it("LC-V6-13 fresh V6 remote DB: no-op migrations + invariant + marker", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), true);

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

  it("LC-V6-14 missing memory_relationship_task_json fails V6 current", () => {
    const db = new Database(":memory:");
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
        chat_id INTEGER PRIMARY KEY,
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), true);
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
    CREATE TABLE IF NOT EXISTS messages (request_id TEXT, memory_relationship_task_json TEXT);
    CREATE TABLE IF NOT EXISTS users (comment_report_restricted_until TEXT);
    CREATE TABLE IF NOT EXISTS profile_comments (delete_reason TEXT);
    CREATE TABLE IF NOT EXISTS characters (id INTEGER, total_turns INTEGER);
    INSERT OR IGNORE INTO characters (id, total_turns) VALUES (1, 0);
  `);
}

describe("last_compressed_at V6 rollback contract (documentation)", () => {
  it("LC-V6-15 V6 → #789/V5 rollback safe; pre-#789 unsupported; no compat shim", () => {
    assert.equal(REMOTE_SCHEMA_VERSION, "turso-v6-last-compressed-at-retired");
    assert.equal(REMOTE_SCHEMA_VERSION_PREVIOUS, HISTORICAL_REMOTE_SCHEMA_V5);
    const ROLLBACK_FLOOR = "#789";
    assert.equal(ROLLBACK_FLOOR, "#789");
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), true);
    db.close();
  });
});

describe("last_compressed_at V6 schema dependency audit", () => {
  it("LC-V6-16 production-like fixture has no blocking last_compressed_at dependencies", () => {
    const db = new Database(":memory:");
    ensureChatMemoriesWithLastCompressedAt(db);
    assert.deepEqual(listBlockingLastCompressedAtSchemaDependencies(db), []);
    db.close();
  });
});
