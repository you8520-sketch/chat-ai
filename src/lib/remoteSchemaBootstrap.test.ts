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
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });
    assert.equal(migrations, 1);
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
});
