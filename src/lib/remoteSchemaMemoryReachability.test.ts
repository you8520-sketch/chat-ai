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
import { after, before, describe, it } from "node:test";
import {
  dropLegacyCharacterMemoriesTableOnce,
  dropLegacyMemoryBufferTableOnce,
  dropLastCompressedAtColumnOnce,
  dropPinnedFactsColumnOnce,
} from "@/lib/db";
import {
  ensureChatBillingSettlementSchema,
  hasChatBillingSettlementSchema,
} from "@/lib/chatBillingSettlementSchema";
import {
  hasCharacterMemoriesRetired,
  hasCurrentRemoteSchemaInvariant,
  hasLastCompressedAtPhysicallyRetired,
  hasMemoryBufferRetired,
  hasPinnedFactsDropCompatible,
  hasPinnedFactsPhase1Clean,
  hasPinnedFactsPhysicallyRetired,
} from "@/lib/remoteSchemaCurrentInvariant";
import {
  canAdoptExistingRemoteSchema,
  initializeRemoteSchema,
  REMOTE_SCHEMA_VERSION,
} from "@/lib/remoteSchemaBootstrap";
import { migrateLegacyPinnedFactsIntoRecentSummary } from "@/lib/memory/pinned-facts-migration";
import { convergeLegacyChatsMemoryIntoCanonical } from "@/lib/memory/chats-memory-convergence";
import { dropChatsCurrentSummaryColumnOnce } from "@/lib/memory/chats-current-summary-column-retirement";
import { dropChatsMemoryColumnOnce } from "@/lib/memory/chats-memory-column-retirement";

const HISTORICAL_REMOTE_SCHEMA_V2 = "turso-v2-chat-billing-settlement";
const HISTORICAL_REMOTE_SCHEMA_V3 = "turso-v3-current-schema";
const HISTORICAL_REMOTE_SCHEMA_V4 = "turso-v4-pinned-drop-compatible";
const HISTORICAL_REMOTE_SCHEMA_V5 = "turso-v5-pinned-column-retired";
const HISTORICAL_REMOTE_SCHEMA_V6 = "turso-v6-last-compressed-at-retired";

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
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'safe',
      current_summary TEXT NOT NULL DEFAULT '',
      memory_meta TEXT NOT NULL DEFAULT '{}',
      memory_pending TEXT NOT NULL DEFAULT '[]',
      memory_archived_turns INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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

function seedStaleRemoteMarker(db: Database.Database, version: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _remote_schema_state (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR REPLACE INTO _remote_schema_state (version) VALUES ('${version}');
  `);
}

function seedV5HistoricalMarker(db: Database.Database): void {
  seedStaleRemoteMarker(db, HISTORICAL_REMOTE_SCHEMA_V5);
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

function createChatMemoriesWithDirtyPinned(db: Database.Database): void {
  db.exec("DROP TABLE IF EXISTS chat_memories");
  ensureChatMemoriesWithPinned(db);
  db.prepare(
    `INSERT OR REPLACE INTO chat_memories
      (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
     VALUES (1, 1, 2, ?, ?, '', 0)`
  ).run("legacy", "recent");
}

function runMemoryRetirementMigrations(db: Database.Database): void {
  dropLegacyMemoryBufferTableOnce(db);
  dropLegacyCharacterMemoriesTableOnce(db);
  migrateLegacyPinnedFactsIntoRecentSummary(db);
  dropPinnedFactsColumnOnce(db);
  dropLastCompressedAtColumnOnce(db);
  dropChatsCurrentSummaryColumnOnce(db);
  convergeLegacyChatsMemoryIntoCanonical(db);
  dropChatsMemoryColumnOnce(db);
}

function ensureMemoryRelationshipTaskColumn(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === "memory_relationship_task_json")) {
    db.exec(`ALTER TABLE messages ADD COLUMN memory_relationship_task_json TEXT`);
  }
}

function runV6DirectUpgradeMigrations(db: Database.Database): void {
  runMemoryRetirementMigrations(db);
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
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'safe',
      current_summary TEXT NOT NULL DEFAULT '',
      memory_meta TEXT NOT NULL DEFAULT '{}',
      memory_pending TEXT NOT NULL DEFAULT '[]',
      memory_archived_turns INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function readRecentSummary(db: Database.Database): string {
  return (
    db.prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=1`).get() as
      | { recent_summary: string }
      | undefined
  )?.recent_summary ?? "";
}

function hasPinnedColumn(db: Database.Database): boolean {
  const cols = db.prepare(`PRAGMA table_info(chat_memories)`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === "pinned_facts");
}

import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("remote schema memory reachability", () => {
  it("R1/R2/R3 FAIL-BEFORE class: stale v4 marker no longer skips memory retirements", () => {
    for (const setup of [
      {
        name: "memory_buffer",
        arrange: (db: Database.Database) => createLegacyMemoryBuffer(db),
        assertFixed: (db: Database.Database) => assert.equal(hasMemoryBufferRetired(db), true),
      },
      {
        name: "character_memories",
        arrange: (db: Database.Database) => createLegacyCharacterMemories(db),
        assertFixed: (db: Database.Database) =>
          assert.equal(hasCharacterMemoriesRetired(db), true),
      },
      {
        name: "dirty pinned_facts",
        arrange: (db: Database.Database) => {
          db.exec("DROP TABLE chat_memories");
          createChatMemoriesWithDirtyPinned(db);
        },
        assertFixed: (db: Database.Database) => {
          assert.equal(hasPinnedColumn(db), false);
          assert.equal(readRecentSummary(db), "legacy\n\nrecent");
        },
      },
    ] as const) {
      const db = new Database(":memory:");
      seedStaleRemoteMarker(db, HISTORICAL_REMOTE_SCHEMA_V4);
      seedProductionRemoteCore(db);
      ensureChatBillingSettlementSchema(db);
      setup.arrange(db);

      let migrations = 0;
      initializeRemoteSchema(db, () => {
        migrations += 1;
        runMemoryRetirementMigrations(db);
      });

      assert.equal(migrations, 1, `${setup.name}: migrate must run once`);
      setup.assertFixed(db);
      const v6 = db
        .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
        .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
      assert.equal(v6?.version, REMOTE_SCHEMA_VERSION, `${setup.name}: v6 marker recorded`);
      db.close();
    }
  });

  it("R4 V3 legacy stack direct → V6 convergence", () => {
    const db = new Database(":memory:");
    seedStaleRemoteMarker(db, HISTORICAL_REMOTE_SCHEMA_V3);
    seedProductionRemoteCore(db);
    db.exec("DROP TABLE chat_memories");
    createLegacyMemoryBuffer(db);
    createLegacyCharacterMemories(db);
    createChatMemoriesWithDirtyPinned(db);
    ensureChatBillingSettlementSchema(db);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasMemoryBufferRetired(db), true);
    assert.equal(hasCharacterMemoriesRetired(db), true);
    assert.equal(hasPinnedColumn(db), false);
    assert.equal(readRecentSummary(db), "legacy\n\nrecent");
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

  it("R4b V2 legacy stack direct → V6 convergence", () => {
    const db = new Database(":memory:");
    seedStaleRemoteMarker(db, HISTORICAL_REMOTE_SCHEMA_V2);
    seedV2HistoricalProductionCore(db);
    db.exec("DROP TABLE IF EXISTS chat_memories");
    createLegacyMemoryBuffer(db);
    createLegacyCharacterMemories(db);
    createChatMemoriesWithDirtyPinned(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runV6DirectUpgradeMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasMemoryBufferRetired(db), true);
    assert.equal(hasCharacterMemoriesRetired(db), true);
    assert.equal(hasPinnedColumn(db), false);
    assert.equal(readRecentSummary(db), "legacy\n\nrecent");
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

  it("R5 structurally current V6 without marker adopts without migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    assert.equal(canAdoptExistingRemoteSchema(db), true);

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

  it("R6 v5 marker + recreated memory_buffer triggers repair migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV5HistoricalMarker(db);
    createLegacyMemoryBuffer(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasMemoryBufferRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("R7 v5 marker + recreated character_memories triggers repair migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV5HistoricalMarker(db);
    createLegacyCharacterMemories(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasCharacterMemoriesRetired(db), true);
    db.close();
  });

  it("R8 v5 marker + recreated dirty pinned carrier triggers fold+drop repair", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV5HistoricalMarker(db);
    db.prepare(`INSERT INTO chat_memories (chat_id, user_id, character_id) VALUES (1, 1, 2)`).run();
    db.exec(`ALTER TABLE chat_memories ADD COLUMN pinned_facts TEXT NOT NULL DEFAULT ''`);
    db.prepare(`UPDATE chat_memories SET pinned_facts=?, recent_summary=? WHERE chat_id=1`).run(
      "rollback pinned",
      "recent"
    );
    assert.equal(hasPinnedFactsPhysicallyRetired(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasPinnedColumn(db), false);
    assert.match(readRecentSummary(db), /rollback pinned/);
    db.close();
  });

  it("R9 fully current v6 DB skips migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedStaleRemoteMarker(db, REMOTE_SCHEMA_VERSION);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });

    assert.equal(migrations, 0);
    db.close();
  });
});

describe("fail-closed memory base", () => {
  it("M1 chat_memories absent is not Phase1 clean or current", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec("DROP TABLE chat_memories");
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasMemoryBufferRetired(db), true);
    assert.equal(hasCharacterMemoriesRetired(db), true);
    assert.equal(hasPinnedFactsPhase1Clean(db), false);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    db.close();
  });

  it("M2 chat_memories without pinned_facts column satisfies V6 pinned retirement", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsPhase1Clean(db), false);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("M3 physical pinned_facts carrier present fails V5 physical retirement", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec("DROP TABLE chat_memories");
    ensureChatMemoriesWithPinned(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsPhase1Clean(db), true);
    assert.equal(hasPinnedFactsPhysicallyRetired(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    db.close();
  });
});

describe("one current remote schema owner", () => {
  it("C1 v5 marker + missing required production table is not current and runs migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV5HistoricalMarker(db);
    db.exec("DROP TABLE web_push_outbox");
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      db.exec("CREATE TABLE web_push_outbox (id INTEGER)");
    });

    assert.equal(migrations, 1);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("C2 v5 marker + missing required production column is not current and runs migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV5HistoricalMarker(db);
    db.exec(`
      CREATE TABLE messages_new (id INTEGER);
      INSERT INTO messages_new (id) VALUES (1);
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
    `);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      db.exec(`
        ALTER TABLE messages ADD COLUMN request_id TEXT;
        ALTER TABLE messages ADD COLUMN memory_relationship_task_json TEXT;
      `);
    });

    assert.equal(migrations, 1);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("C3 full V6 structure without marker adopts without migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    assert.equal(canAdoptExistingRemoteSchema(db), true);

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
});

describe("current schema invariant owner", () => {
  it("isCurrent requires v6 marker and full invariant (not billing-only)", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedV5HistoricalMarker(db);
    createLegacyMemoryBuffer(db);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    db.close();
  });
});

describe("remote schema version chain", () => {
  it("V2/V3/V4/V5 historical literals remain stable; V6 is current", () => {
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V2, "turso-v2-chat-billing-settlement");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V3, "turso-v3-current-schema");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V4, "turso-v4-pinned-drop-compatible");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V5, "turso-v5-pinned-column-retired");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V6, "turso-v6-last-compressed-at-retired");
    assert.equal(REMOTE_SCHEMA_VERSION, "turso-v8-current-summary-retired");
  });
});

describe("last_compressed_at V6 reachability", () => {
  it("R10 v5 marker + last_compressed_at carrier triggers drop repair", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV5HistoricalMarker(db);
    db.exec(`ALTER TABLE chat_memories ADD COLUMN last_compressed_at TEXT`);
    db.prepare(`UPDATE chat_memories SET last_compressed_at=? WHERE chat_id IS NOT NULL`).run(
      "2025-01-01T00:00:00Z"
    );
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      dropLastCompressedAtColumnOnce(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasLastCompressedAtPhysicallyRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("R11 v5 marker structurally V6 current adopts without migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedV5HistoricalMarker(db);
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
});
