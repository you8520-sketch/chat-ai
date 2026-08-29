import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  canAdoptExistingRemoteSchema,
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
    CREATE TABLE messages (request_id TEXT);
    CREATE TABLE users (comment_report_restricted_until TEXT);
    CREATE TABLE profile_comments (delete_reason TEXT);
    CREATE TABLE characters (id INTEGER, total_turns INTEGER);
    INSERT INTO characters (id, total_turns) VALUES (1, 0);
  `);
}

describe("remote schema bootstrap", () => {
  it("runs migration only once after recording the schema version", () => {
    const db = new Database(":memory:");
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
      INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION_PREVIOUS}');
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
      INSERT INTO _remote_schema_state (version) VALUES ('${REMOTE_SCHEMA_VERSION_PREVIOUS}');
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

  it("v2 marker + valid settlement schema → migration skipped", () => {
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

  it("CURRENT_MARKER_WITH_BROKEN_UNIQUE_CAN_REPORT_CURRENT: false", () => {
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
    initializeRemoteSchema(db, migrate);
    assert.equal(migrations, 1);
    assert.equal(hasChatBillingSettlementSchema(db), false);

    initializeRemoteSchema(db, migrate);
    assert.equal(migrations, 2);
    db.close();
  });
});
