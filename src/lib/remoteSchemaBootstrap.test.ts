import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  canAdoptExistingRemoteSchema,
  hasCurrentRemoteSchemaInvariant,
  initializeRemoteSchema,
  REMOTE_SCHEMA_VERSION,
  REMOTE_SCHEMA_VERSION_PREVIOUS,
} from "./remoteSchemaBootstrap.ts";
import {
  ensureChatBillingSettlementSchema,
  hasChatBillingSettlementSchema,
} from "./chatBillingSettlementSchema.ts";

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

describe("remote schema bootstrap", () => {
  it("runs migration only once after recording the schema version", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    let migrations = 0;
    const migrate = () => {
      migrations += 1;
      ensureChatBillingSettlementSchema(db);
    };
    initializeRemoteSchema(db, migrate);
    initializeRemoteSchema(db, migrate);
    assert.equal(migrations, 1);
    assert.equal(hasChatBillingSettlementSchema(db), true);
    const current = db
      .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
      .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
    assert.equal(current?.version, REMOTE_SCHEMA_VERSION);
    db.close();
  });

  it("OLD_REMOTE_V1_DB_UPGRADE_PASS: turso-v1 production DB without settlement receives schema on bootstrap", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE _remote_schema_state (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _remote_schema_state (version) VALUES ('turso-v1');
    `);
    seedProductionRemoteCore(db);
    assert.equal(hasChatBillingSettlementSchema(db), false);
    assert.equal(canAdoptExistingRemoteSchema(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      ensureChatBillingSettlementSchema(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasChatBillingSettlementSchema(db), true);
    const current = db
      .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
      .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
    assert.equal(current?.version, REMOTE_SCHEMA_VERSION);
    db.close();
  });

  it("REMOTE_SCHEMA_REAPPLY_SAFE: second bootstrap is idempotent", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE _remote_schema_state (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _remote_schema_state (version) VALUES ('turso-v1');
    `);
    seedProductionRemoteCore(db);

    let migrations = 0;
    const migrate = () => {
      migrations += 1;
      ensureChatBillingSettlementSchema(db);
    };
    initializeRemoteSchema(db, migrate);
    initializeRemoteSchema(db, migrate);

    assert.equal(migrations, 1);
    assert.equal(hasChatBillingSettlementSchema(db), true);
    db.close();
  });

  it("adopts a completed schema with settlement table without rerunning migrations", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(canAdoptExistingRemoteSchema(db), true);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });
    assert.equal(migrations, 0);
    const current = db
      .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
      .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
    assert.equal(current?.version, REMOTE_SCHEMA_VERSION);
    db.close();
  });

  it("does not adopt production schema missing chat_billing_settlements", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    assert.equal(canAdoptExistingRemoteSchema(db), false);
    db.close();
  });

  it("REMOTE_CURRENT_MARKER_WITH_MISSING_SETTLEMENT_TABLE_CAN_SKIP_UPGRADE: false", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE _remote_schema_state (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION}');
    `);
    seedProductionRemoteCore(db);
    assert.equal(hasChatBillingSettlementSchema(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      ensureChatBillingSettlementSchema(db);
    });

    assert.equal(migrations, 1);
    assert.equal(hasChatBillingSettlementSchema(db), true);
    const current = db
      .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
      .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
    assert.equal(current?.version, REMOTE_SCHEMA_VERSION);
    db.close();
  });

  it("v5 marker + valid full current invariant → migration skipped", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE _remote_schema_state (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION}');
    `);
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasChatBillingSettlementSchema(db), true);

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

  it("v4 legacy marker + structurally current V5 schema adopts v5 without migrate", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE _remote_schema_state (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION_PREVIOUS}');
    `);
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });

    assert.equal(migrations, 0);
    const current = db
      .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
      .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
    assert.equal(current?.version, REMOTE_SCHEMA_VERSION);
    db.close();
  });

  it("BROKEN_SETTLEMENT_UNIQUE_CAN_BOOT_APPLICATION: false — post-migration validation throws", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE _remote_schema_state (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION}');
    `);
    seedProductionRemoteCore(db);
    db.exec(`
      CREATE TABLE chat_billing_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        charge_kind TEXT NOT NULL DEFAULT 'chat_turn',
        assistant_message_id INTEGER,
        requested_points INTEGER NOT NULL,
        settled_points INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        deduction_slices_json TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'native',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    assert.equal(hasChatBillingSettlementSchema(db), false);

    let migrations = 0;
    const migrate = () => {
      migrations += 1;
      ensureChatBillingSettlementSchema(db);
    };

    assert.throws(
      () => initializeRemoteSchema(db, migrate),
      /canonical current production schema/
    );
    assert.equal(migrations, 1);
    assert.equal(hasChatBillingSettlementSchema(db), false);

    assert.throws(
      () => initializeRemoteSchema(db, migrate),
      /canonical current production schema/
    );
    assert.equal(migrations, 2);
    db.close();
  });

  it("S1 current marker + memory_relationship_task_json missing runs migrate once then current", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE _remote_schema_state (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION}');
    `);
    seedProductionRemoteCore(db);
    db.exec(`
      CREATE TABLE messages_legacy (request_id TEXT);
      INSERT INTO messages_legacy (request_id) VALUES ('req-1');
      DROP TABLE messages;
      ALTER TABLE messages_legacy RENAME TO messages;
    `);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    assert.equal(canAdoptExistingRemoteSchema(db), false);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
      db.exec("ALTER TABLE messages ADD COLUMN memory_relationship_task_json TEXT");
    });

    assert.equal(migrations, 1);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    const current = db
      .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
      .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
    assert.equal(current?.version, REMOTE_SCHEMA_VERSION);
    db.close();
  });

  it("S2 current marker + memory_relationship_task_json present skips migrate", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE _remote_schema_state (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION}');
    `);
    seedProductionRemoteCore(db);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });

    assert.equal(migrations, 0);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    db.close();
  });

  it("S3 adoption requires memory_relationship_task_json column", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec(`
      CREATE TABLE messages_legacy (request_id TEXT);
      INSERT INTO messages_legacy (request_id) VALUES ('req-1');
      DROP TABLE messages;
      ALTER TABLE messages_legacy RENAME TO messages;
    `);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    assert.equal(canAdoptExistingRemoteSchema(db), false);

    db.exec("ALTER TABLE messages ADD COLUMN memory_relationship_task_json TEXT");
    assert.equal(hasCurrentRemoteSchemaInvariant(db), true);
    assert.equal(canAdoptExistingRemoteSchema(db), true);
    db.close();
  });

  it("S4 post-migration assert fail-closed when memory_relationship_task_json not created", () => {
    const db = new Database(":memory:");
    seedProductionRemoteCore(db);
    db.exec(`
      CREATE TABLE messages_legacy (request_id TEXT);
      INSERT INTO messages_legacy (request_id) VALUES ('req-1');
      DROP TABLE messages;
      ALTER TABLE messages_legacy RENAME TO messages;
    `);
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);

    let migrations = 0;
    const migrate = () => {
      migrations += 1;
    };

    assert.throws(
      () => initializeRemoteSchema(db, migrate),
      /canonical current production schema/
    );
    assert.equal(migrations, 1);
    assert.equal(hasCurrentRemoteSchemaInvariant(db), false);
    const current = db
      .prepare("SELECT version FROM _remote_schema_state WHERE version=?")
      .get(REMOTE_SCHEMA_VERSION) as { version: string } | undefined;
    assert.equal(current, undefined, "markCurrent must not run when invariant fails");
    db.close();
  });
});
