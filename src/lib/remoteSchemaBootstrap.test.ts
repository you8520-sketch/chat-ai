import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  canAdoptExistingRemoteSchema,
  initializeRemoteSchema,
} from "./remoteSchemaBootstrap.ts";

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
    db.close();
  });

  it("adopts a completed pre-version Turso schema without rerunning migrations", () => {
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
    `);
    assert.equal(canAdoptExistingRemoteSchema(db), true);

    let migrations = 0;
    initializeRemoteSchema(db, () => {
      migrations += 1;
    });
    assert.equal(migrations, 0);
    db.close();
  });
});
