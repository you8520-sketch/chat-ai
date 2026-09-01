/**
 * C2 — chats.current_summary physical retirement + remote V8 strict absent invariant.
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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
import { hasChatsCurrentSummaryColumn, hasChatsMemoryColumn } from "@/lib/memory/chats-memory-column-compat";
import { convergeLegacyChatsMemoryIntoCanonical } from "@/lib/memory/chats-memory-convergence";
import {
  dropChatsCurrentSummaryColumnOnce,
  listBlockingChatsCurrentSummarySchemaDependencies,
  listLegacyCurrentSummaryRecoveryCandidates,
  verifyLegacyCurrentSummaryRecovery,
} from "@/lib/memory/chats-current-summary-column-retirement";
import {
  dropChatsMemoryColumnOnce,
} from "@/lib/memory/chats-memory-column-retirement";
import {
  hasChatsCurrentSummaryPhysicallyRetired,
  hasChatsMemoryPhysicallyRetired,
  hasCurrentRemoteSchemaInvariant,
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

const HISTORICAL_REMOTE_SCHEMA_V6 = "turso-v6-last-compressed-at-retired";
const HISTORICAL_REMOTE_SCHEMA_V7 = "turso-v7-chats-memory-retired";

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

function runFullV8UpgradeMigrations(db: Database.Database): void {
  dropLegacyMemoryBufferTableOnce(db);
  dropLegacyCharacterMemoriesTableOnce(db);
  migrateLegacyPinnedFactsIntoRecentSummary(db);
  dropPinnedFactsColumnOnce(db);
  dropLastCompressedAtColumnOnce(db);
  dropChatsCurrentSummaryColumnOnce(db);
  convergeLegacyChatsMemoryIntoCanonical(db);
  dropChatsMemoryColumnOnce(db);
}

describe("chats.current_summary C2 V8 physical retirement invariant", () => {
  it("CS-V8-1 requires chats exists and current_summary absent", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    db.exec(`ALTER TABLE chats DROP COLUMN current_summary`);
    assert.equal(hasChatsCurrentSummaryPhysicallyRetired(db), true);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("CS-V8-2 carrier present fails V8 physical retirement", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasChatsCurrentSummaryPhysicallyRetired(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    db.close();
  });

  it("CS-V8-3 version constants frozen", () => {
    assert.equal(REMOTE_SCHEMA_VERSION, "turso-v8-current-summary-retired");
    assert.equal(REMOTE_SCHEMA_VERSION_PREVIOUS, HISTORICAL_REMOTE_SCHEMA_V7);
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V6, "turso-v6-last-compressed-at-retired");
    assert.equal(HISTORICAL_REMOTE_SCHEMA_V7, "turso-v7-chats-memory-retired");
  });
});

describe("chats.current_summary C2 DROP helper", () => {
  it("CS1 table missing is no-op", () => {
    const db = new Database(":memory:");
    assert.doesNotThrow(() => dropChatsCurrentSummaryColumnOnce(db));
    db.close();
  });

  it("CS2 column absent is no-op", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec(`ALTER TABLE chats DROP COLUMN current_summary`);
    assert.doesNotThrow(() => dropChatsCurrentSummaryColumnOnce(db));
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    db.close();
  });

  it("CS3 blocking schema dependency refuses DROP", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec(`CREATE INDEX idx_chats_current_summary_carrier ON chats(current_summary)`);
    assert.throws(() => dropChatsCurrentSummaryColumnOnce(db), /Refusing to DROP/);
    assert.equal(hasChatsCurrentSummaryColumn(db), true);
    db.close();
  });
});

describe("chats.current_summary C2 migration matrix", () => {
  it("A clean C1-like: empty carrier, canonical valid → column absent unchanged", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars)
       VALUES (?,?,?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "KEEP", "", "free", 4);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      ""
    );

    dropChatsCurrentSummaryColumnOnce(db);

    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "KEEP");
    db.close();
  });

  it("B current-only orphan → canonical preserved, column absent", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "LEGACY_A"
    );

    dropChatsCurrentSummaryColumnOnce(db);

    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "LEGACY_A");
    db.close();
  });

  it("C canonical wins stale carrier", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars)
       VALUES (?,?,?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "NEW", "", "free", 3);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "OLD"
    );

    dropChatsCurrentSummaryColumnOnce(db);

    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "NEW");
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    db.close();
  });

  it("D empty canonical wins — no OLD resurrection", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars)
       VALUES (?,?,?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "", "free", 0);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "OLD"
    );

    dropChatsCurrentSummaryColumnOnce(db);

    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "");
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    db.close();
  });

  it("E historical chats.memory fallback when current_summary empty", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, current_summary, memory) VALUES (?,?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "MEMORY_OLD");

    dropChatsCurrentSummaryColumnOnce(db);
    convergeLegacyChatsMemoryIntoCanonical(db);
    dropChatsMemoryColumnOnce(db);

    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "MEMORY_OLD");
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    assert.equal(hasChatsMemoryColumn(db), false);
    db.close();
  });

  it("F already C2 repeated migration is idempotent", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec(`ALTER TABLE chats DROP COLUMN current_summary`);
    assert.doesNotThrow(() => dropChatsCurrentSummaryColumnOnce(db));
    assert.doesNotThrow(() => dropChatsCurrentSummaryColumnOnce(db));
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    db.close();
  });

  it("G recovery failure injection refuses DROP and keeps column", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "LEGACY_A"
    );

    const candidates = listLegacyCurrentSummaryRecoveryCandidates(db);
    assert.equal(candidates.length, 1);

    const originalPrepare = db.prepare.bind(db);
    let blocked = false;
    db.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (
        !blocked &&
        typeof sql === "string" &&
        sql.includes("INSERT INTO chat_memories") &&
        sql.includes("recent_summary")
      ) {
        blocked = true;
        const originalRun = statement.run.bind(statement);
        statement.run = (...args: unknown[]) => {
          throw new Error("simulated recovery failure");
        };
        return statement;
      }
      return statement;
    }) as typeof db.prepare;

    assert.throws(() => dropChatsCurrentSummaryColumnOnce(db), /simulated recovery failure/);
    assert.equal(hasChatsCurrentSummaryColumn(db), true);
    const orphan = db.prepare(`SELECT 1 AS ok FROM chat_memories WHERE chat_id=?`).get(CHAT_ID);
    assert.equal(orphan, undefined);
    db.close();
  });

  it("H DROP failure after recovery preserves canonical and allows retry", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "LEGACY_A"
    );

    const candidates = listLegacyCurrentSummaryRecoveryCandidates(db);
    convergeLegacyChatsMemoryIntoCanonical(db);
    verifyLegacyCurrentSummaryRecovery(db, candidates);

    const originalExec = db.exec.bind(db);
    let dropAttempted = false;
    db.exec = ((sql: string) => {
      if (!dropAttempted && sql.includes("DROP COLUMN current_summary")) {
        dropAttempted = true;
        throw new Error("simulated DROP failure");
      }
      return originalExec(sql);
    }) as typeof db.exec;

    assert.throws(() => dropChatsCurrentSummaryColumnOnce(db), /simulated DROP failure/);
    assert.equal(hasChatsCurrentSummaryColumn(db), true);
    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "LEGACY_A");

    db.exec = originalExec;
    dropChatsCurrentSummaryColumnOnce(db);
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    db.close();
  });
});

describe("chats.current_summary C2 fresh schema", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  it("CS-F1 fresh migrate has no current_summary column in DDL", () => {
    const ddl = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    assert.ok(!/addColumn\("chats", "current_summary"/.test(ddl));
  });

  it("CS-F2 normal create and fork insert on fresh C2 DB", () => {
    getDb();
    const db = getDb();
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    db.prepare(`DELETE FROM users WHERE id=?`).run(USER_ID);
    db.prepare(`DELETE FROM characters WHERE id=?`).run(CHARACTER_ID);
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
      USER_ID,
      "c2@test.local",
      "c2",
      "x"
    );
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

describe("chats.current_summary C2 remote V8 lifecycle", () => {
  it("CS-V8-4 V7 present carrier → V8 migrate", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatsWithMemoryColumn(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V7);
    assert.equal(hasChatsCurrentSummaryPhysicallyRetired(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      runFullV8UpgradeMigrations(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    assert.equal(hasChatsMemoryPhysicallyRetired(db), true);
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

  it("CS-V8-5 V7 absent carrier → V8 adopt", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec(`ALTER TABLE chats DROP COLUMN current_summary`);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, HISTORICAL_REMOTE_SCHEMA_V7);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });

    assert.equal(migrations, 0);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("CS-V8-6 V8 marker + recreated current_summary column repaired", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    seedHistoricalMarker(db, REMOTE_SCHEMA_VERSION);
    db.prepare(
      `INSERT OR IGNORE INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "LEGACY");
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      dropChatsCurrentSummaryColumnOnce(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });
});

describe("chats.current_summary C2 local SQLite boot matrix", () => {
  it("existing pre-C2 file DB migrates and boots", () => {
    const dir = mkdtempSync(join(tmpdir(), "c2-pre-"));
    const dbPath = join(dir, "app.db");
    const db = new Database(dbPath);
    seedProductionRemoteCore(db);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "BOOT LEGACY"
    );
    db.close();

    const reopened = new Database(dbPath);
    runFullV8UpgradeMigrations(reopened);
    assert.equal(hasChatsCurrentSummaryColumn(reopened), false);
    const canonical = reopened
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "BOOT LEGACY");
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("interrupted migration after convergence before DROP resumes safely", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.prepare(`INSERT INTO chats (id, user_id, character_id, current_summary) VALUES (?,?,?,?)`).run(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "RESUME ME"
    );

    const candidates = listLegacyCurrentSummaryRecoveryCandidates(db);
    convergeLegacyChatsMemoryIntoCanonical(db);
    verifyLegacyCurrentSummaryRecovery(db, candidates);
    assert.equal(hasChatsCurrentSummaryColumn(db), true);

    dropChatsCurrentSummaryColumnOnce(db);
    assert.equal(hasChatsCurrentSummaryColumn(db), false);
    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string };
    assert.equal(canonical.recent_summary, "RESUME ME");
    db.close();
  });
});

describe("chats.current_summary C2 production audit", () => {
  it("CS-A1 fresh DDL has zero current_summary column", () => {
    const ddl = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    assert.ok(!/addColumn\("chats", "current_summary"/.test(ddl));
  });

  it("CS-A2 no blocking production dependencies on chats.current_summary", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    assert.deepEqual(listBlockingChatsCurrentSummarySchemaDependencies(db), []);
    db.close();
  });
});
