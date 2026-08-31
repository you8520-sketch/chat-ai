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
} from "@/lib/db";
import {
  ensureChatBillingSettlementSchema,
  hasChatBillingSettlementSchema,
} from "@/lib/chatBillingSettlementSchema";
import {
  hasCharacterMemoriesRetired,
  hasCurrentRemoteSchemaInvariant,
  hasMemoryBufferRetired,
  hasPinnedFactsDropCompatible,
  hasPinnedFactsPhase1Clean,
} from "@/lib/remoteSchemaCurrentInvariant";
import {
  canAdoptExistingRemoteSchema,
  initializeRemoteSchema,
  REMOTE_SCHEMA_VERSION,
  REMOTE_SCHEMA_VERSION_PREVIOUS,
} from "@/lib/remoteSchemaBootstrap";
import { migrateLegacyPinnedFactsIntoRecentSummary } from "@/lib/memory/pinned-facts-migration";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

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

function seedV2CurrentMarker(db: Database.Database): void {
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

function seedV3LegacyMarker(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _remote_schema_state (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR REPLACE INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION_PREVIOUS}');
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

function ensureEmptyChatMemories(db: Database.Database): void {
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
  ensureEmptyChatMemories(db);
  db.prepare(
    `INSERT OR REPLACE INTO chat_memories
      (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary, used_chars)
     VALUES (1, 1, 2, ?, ?, '', 0)`
  ).run("legacy", "recent");
}

function runMemoryRetirementMigrations(db: Database.Database): void {
  ensureEmptyChatMemories(db);
  dropLegacyMemoryBufferTableOnce(db);
  dropLegacyCharacterMemoriesTableOnce(db);
  migrateLegacyPinnedFactsIntoRecentSummary(db);
}

function readPinnedRecent(db: Database.Database) {
  return db
    .prepare(`SELECT pinned_facts, recent_summary FROM chat_memories WHERE chat_id=1`)
    .get() as { pinned_facts: string; recent_summary: string };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("remote schema memory reachability", () => {
  it("R1/R2/R3 FAIL-BEFORE class: v2 current marker no longer skips memory retirements", () => {
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
        arrange: (db: Database.Database) => createChatMemoriesWithDirtyPinned(db),
        assertFixed: (db: Database.Database) => {
          const row = readPinnedRecent(db);
          assert.equal(row.pinned_facts, "");
          assert.equal(row.recent_summary, "legacy\n\nrecent");
        },
      },
    ] as const) {
      const db = new Database(":memory:");
      seedV2CurrentMarker(db);
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
      const v3 = db
        .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
        .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
      assert.equal(v3?.version, REMOTE_SCHEMA_VERSION, `${setup.name}: v4 marker recorded`);
      db.close();
    }
  });

  it("R4 V2_TO_NEW combined #774/#776/#779 convergence", () => {
    const db = new Database(":memory:");
    seedV2CurrentMarker(db);
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    createLegacyMemoryBuffer(db);
    createLegacyCharacterMemories(db);
    createChatMemoriesWithDirtyPinned(db);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasMemoryBufferRetired(db), true);
    assert.equal(hasCharacterMemoriesRetired(db), true);
    const row = readPinnedRecent(db);
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

  it("R5 structurally current without new marker adopts v3 without migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasPinnedFactsPhase1Clean(db), true);
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

  it("R6 v4 marker + recreated memory_buffer triggers repair migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV4CurrentMarker(db);
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

  it("R7 v4 marker + recreated character_memories triggers repair migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV4CurrentMarker(db);
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

  it("R8 v4 marker + dirty pinned reintroduced triggers repair migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    createChatMemoriesWithDirtyPinned(db);
    runMemoryRetirementMigrations(db);
    seedV4CurrentMarker(db);
    db.prepare(`UPDATE chat_memories SET pinned_facts=? WHERE chat_id=1`).run("rollback pinned");
    assert.equal(hasPinnedFactsPhase1Clean(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runMemoryRetirementMigrations(db);
    });

    assert.equal(migrations, 1);
    const row = readPinnedRecent(db);
    assert.equal(row.pinned_facts, "");
    assert.match(row.recent_summary, /rollback pinned/);
    db.close();
  });

  it("R9 fully current v4 DB skips migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV4CurrentMarker(db);
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
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    db.close();
  });

  it("M2 chat_memories without pinned_facts column is Phase1-not-clean but drop-compatible", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec("DROP TABLE chat_memories");
    db.exec(`
      CREATE TABLE chat_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        recent_summary TEXT NOT NULL DEFAULT '',
        archive_summary TEXT NOT NULL DEFAULT '',
        membership_tier TEXT NOT NULL DEFAULT 'free',
        used_chars INTEGER NOT NULL DEFAULT 0
      );
    `);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsPhase1Clean(db), false);
    assert.equal(hasPinnedFactsDropCompatible(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("M3 physical pinned_facts carrier present and all empty is Phase1 clean", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasPinnedFactsPhase1Clean(db), true);
    db.close();
  });
});

describe("one current remote schema owner", () => {
  it("C1 v4 marker + missing required production table is not current and runs migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV4CurrentMarker(db);
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

  it("C2 v4 marker + missing required production column is not current and runs migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    runMemoryRetirementMigrations(db);
    seedV4CurrentMarker(db);
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

  it("C3 full structure without v4 marker adopts without migrate", () => {
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
  it("isCurrent requires v4 marker and full invariant (not billing-only)", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedV4CurrentMarker(db);
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
