/**
 * M2 — chats.memory physical retirement + remote V7 strict absent invariant.
 */
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { after, before, describe, it } from "node:test";
import {
  dropLegacyCharacterMemoriesTableOnce,
  dropLegacyMemoryBufferTableOnce,
  dropLastCompressedAtColumnOnce,
  dropPinnedFactsColumnOnce,
} from "@/lib/db";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import { createChatSession } from "@/lib/chatSessionCreate";
import { insertForkChatRow } from "@/lib/chatForkCreate";
import { hasChatsMemoryColumn } from "@/lib/memory/chats-memory-column-compat";
import { convergeLegacyChatsMemoryIntoCanonical } from "@/lib/memory/chats-memory-convergence";
import {
  dropChatsMemoryColumnOnce,
  listBlockingChatsMemorySchemaDependencies,
} from "@/lib/memory/chats-memory-column-retirement";
import {
  hasChatsMemoryPhysicallyRetired,
  hasCurrentRemoteSchemaInvariant,
  hasLastCompressedAtPhysicallyRetired,
  hasMemoryBufferRetired,
  hasCharacterMemoriesRetired,
  hasPinnedFactsPhysicallyRetired,
} from "@/lib/remoteSchemaCurrentInvariant";
import {
  initializeRemoteSchema,
  REMOTE_SCHEMA_VERSION,
  REMOTE_SCHEMA_VERSION_PREVIOUS,
} from "@/lib/remoteSchemaBootstrap";
import { migrateLegacyPinnedFactsIntoRecentSummary } from "@/lib/memory/pinned-facts-migration";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const HISTORICAL_REMOTE_SCHEMA_V2 = "turso-v2-chat-billing-settlement";
const HISTORICAL_REMOTE_SCHEMA_V3 = "turso-v3-current-schema";
const HISTORICAL_REMOTE_SCHEMA_V4 = "turso-v4-pinned-drop-compatible";
const HISTORICAL_REMOTE_SCHEMA_V5 = "turso-v5-pinned-column-retired";
const HISTORICAL_REMOTE_SCHEMA_V6 = "turso-v6-last-compressed-at-retired";

const CHAT_ID = 42;
const USER_ID = 7;
const CHARACTER_ID = 8;

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
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function ensureChatsWithMemoryColumn(db: Database.Database): void {
  if (!db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='chats'`).get()) {
    db.exec(`
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
  if (!hasChatsMemoryColumn(db)) {
    db.exec(`ALTER TABLE chats ADD COLUMN memory TEXT NOT NULL DEFAULT ''`);
  }
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

function runFullV7UpgradeMigrations(db: Database.Database): void {
  dropLegacyMemoryBufferTableOnce(db);
  dropLegacyCharacterMemoriesTableOnce(db);
  migrateLegacyPinnedFactsIntoRecentSummary(db);
  dropPinnedFactsColumnOnce(db);
  dropLastCompressedAtColumnOnce(db);
  convergeLegacyChatsMemoryIntoCanonical(db);
  dropChatsMemoryColumnOnce(db);
}

function hasMemoryColumn(db: Database.Database): boolean {
  return hasChatsMemoryColumn(db);
}

describe("chats.memory M2 V7 physical retirement invariant", () => {
  it("CM-V7-1 requires chats exists and memory absent", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasChatsMemoryPhysicallyRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("CM-V7-2 carrier present fails V7 physical retirement", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasChatsMemoryPhysicallyRetired(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    db.close();
  });

  it("CM-V7-3 version constants frozen", () => {
    assert.equal(REMOTE_SCHEMA_VERSION, "turso-v7-chats-memory-retired");
    assert.equal(REMOTE_SCHEMA_VERSION_PREVIOUS, HISTORICAL_REMOTE_SCHEMA_V6);
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V2, "turso-v2-chat-billing-settlement");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V3, "turso-v3-current-schema");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V4, "turso-v4-pinned-drop-compatible");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V5, "turso-v5-pinned-column-retired");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V6, "turso-v6-last-compressed-at-retired");
  });
});

describe("chats.memory M2 DROP helper", () => {
  it("CM1 table missing is no-op", () => {
    const db = new Database(":memory:");
    assert.doesNotThrow(() => dropChatsMemoryColumnOnce(db));
    db.close();
  });

  it("CM2 column absent is no-op", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    assert.doesNotThrow(() => dropChatsMemoryColumnOnce(db));
    assert.equal(hasMemoryColumn(db), false);
    db.close();
  });

  it("CM3 column present empty DROP passes", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, memory) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      ""
    );
    dropChatsMemoryColumnOnce(db);
    assert.equal(hasMemoryColumn(db), false);
    db.close();
  });

  it("CM4 column present nonempty DROP passes after convergence", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, current_summary, memory) VALUES (?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "ONLY SURVIVING LEGACY");

    convergeLegacyChatsMemoryIntoCanonical(db);
    dropChatsMemoryColumnOnce(db);

    assert.equal(hasMemoryColumn(db), false);
    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    const chat = db
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(CHAT_ID) as { current_summary: string };
    assert.equal(canonical.recent_summary, "ONLY SURVIVING LEGACY");
    assert.equal(chat.current_summary, "ONLY SURVIVING LEGACY");
    db.close();
  });

  it("CM5 blocking schema dependency refuses DROP", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    db.exec(`CREATE INDEX idx_chats_memory_carrier ON chats(memory)`);
    assert.throws(() => dropChatsMemoryColumnOnce(db), /Refusing to DROP/);
    assert.equal(hasMemoryColumn(db), true);
    db.close();
  });

  it("CM6 converge before drop ordering gate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, current_summary, memory) VALUES (?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "MEMORY ONLY");

    dropChatsMemoryColumnOnce(db);
    assert.equal(hasMemoryColumn(db), false);
    const orphan = db.prepare(`SELECT 1 AS ok FROM chat_memories WHERE chat_id=?`).get(CHAT_ID);
    assert.equal(orphan, undefined);

    db.exec(`ALTER TABLE chats ADD COLUMN memory TEXT NOT NULL DEFAULT ''`);
    db.prepare(`UPDATE chats SET memory=? WHERE id=?`).run("MEMORY ONLY", CHAT_ID);
    convergeLegacyChatsMemoryIntoCanonical(db);
    dropChatsMemoryColumnOnce(db);
    const row = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "MEMORY ONLY");
    db.close();
  });
});

describe("chats.memory M2 convergence data-loss gates", () => {
  it("CM-D1 memory-only orphan preserved before DROP", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, current_summary, memory) VALUES (?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "ONLY SURVIVING LEGACY");

    runFullV7UpgradeMigrations(db);

    assert.equal(hasMemoryColumn(db), false);
    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    const chat = db
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(CHAT_ID) as { current_summary: string };
    assert.equal(canonical.recent_summary, "ONLY SURVIVING LEGACY");
    assert.equal(chat.current_summary, "ONLY SURVIVING LEGACY");
    db.close();
  });

  it("CM-D2 existing canonical never overwritten", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars)
       VALUES (?,?,?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "NEW", "", "free", 3);
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, current_summary, memory) VALUES (?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "OLD", "OLDER");

    runFullV7UpgradeMigrations(db);

    const row = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(row.recent_summary, "NEW");
    db.close();
  });

  it("CM-D3 current_summary wins over memory", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, current_summary, memory) VALUES (?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "CURRENT MIRROR", "OLDER MEMORY");

    runFullV7UpgradeMigrations(db);

    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    const chat = db
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(CHAT_ID) as { current_summary: string };
    assert.equal(canonical.recent_summary, "CURRENT MIRROR");
    assert.equal(chat.current_summary, "CURRENT MIRROR");
    assert.equal(hasMemoryColumn(db), false);
    db.close();
  });
});

describe("chats.memory M2 fresh schema", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  it("CM-F1 fresh migrate has no memory column in DDL", () => {
    const db = new Database(":memory:");
    const ddl = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    assert.ok(!/CREATE TABLE IF NOT EXISTS chats[\s\S]*?memory TEXT NOT NULL DEFAULT ''/.test(ddl));
    db.close();
  });

  it("CM-F2 normal create and fork insert on fresh M2 DB", () => {
    getDb();
    const db = getDb();
    assert.equal(hasMemoryColumn(db), false);
    db.prepare(`DELETE FROM users WHERE id=?`).run(USER_ID);
    db.prepare(`DELETE FROM characters WHERE id=?`).run(CHARACTER_ID);
    db.prepare(
      `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
    ).run(USER_ID, "m2@test.local", "m2", "x");
    db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHARACTER_ID, "c");
    const chatId = createChatSession({ userId: USER_ID, characterId: CHARACTER_ID });
    assert.ok(chatId > 0);
    const forkId = insertForkChatRow(db, {
      userId: USER_ID,
      characterId: CHARACTER_ID,
      mode: "safe",
      memoryPending: "[]",
      memoryMeta: "{}",
      memoryArchivedTurns: 0,
      currentSummary: "",
      geminiModel: "",
      userNote: "",
      selectedPersonaId: null,
      userImpersonation: 0,
      targetResponseChars: 700,
      title: "fork",
      writingStyleOverride: "",
      memoryCapacity: 4000,
      narrativePov: "third_person",
      povCharacterName: "",
    });
    assert.ok(forkId > 0);
  });
});

describe("chats.memory M2 remote V7 lifecycle", () => {
  it("CM-V7-4 V6 present carrier → V7 migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V6);
    assert.equal(hasChatsMemoryPhysicallyRetired(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullV7UpgradeMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasMemoryColumn(db), false);
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

  it("CM-V7-5 V6 absent carrier → V7 adopt", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V6);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });

    assert.equal(migrations, 0);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("CM-V7-6 V7 marker + recreated memory column repaired", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, REMOTE_SCHEMA_VERSION);
    db.exec(`ALTER TABLE chats ADD COLUMN memory TEXT NOT NULL DEFAULT ''`);
    db.prepare(
      `INSERT OR IGNORE INTO chats (id, user_id, character_id, memory) VALUES (?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "LEGACY");
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      convergeLegacyChatsMemoryIntoCanonical(db);
      dropChatsMemoryColumnOnce(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasMemoryColumn(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });
});

describe("chats.memory M2 production audit", () => {
  it("CM-A1 fresh DDL has zero memory column", () => {
    const ddl = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    assert.ok(!/CREATE TABLE IF NOT EXISTS chats[\s\S]*?memory TEXT/.test(ddl));
  });

  it("CM-A2 no blocking production dependencies on chats.memory", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    assert.deepEqual(listBlockingChatsMemorySchemaDependencies(db), []);
    db.close();
  });
});
