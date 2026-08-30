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
import { dropLegacyMemoryBufferTableOnce, getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

function memoryBufferTableExists(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='memory_buffer'`)
      .get()
  );
}

function memoryBufferIndexExists(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='index' AND name='idx_memory_buffer_user_char'`
      )
      .get()
  );
}

function retirementFlagExists(db: Database.Database): boolean {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_flags (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return Boolean(
    db
      .prepare("SELECT 1 AS ok FROM _schema_flags WHERE key='memory_buffer_dropped_v1'")
      .get()
  );
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
    CREATE INDEX idx_memory_buffer_user_char ON memory_buffer(user_id, character_id);
  `);
}

function insertSyntheticMemoryBufferRow(db: Database.Database): void {
  db.prepare(
    `INSERT INTO memory_buffer (user_id, character_id, role, content, message_index, chat_id)
     VALUES (1, 2, 'user', 'legacy fixture', 1, 99)`
  ).run();
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("memory_buffer schema retirement", () => {
  it("FRESH_DB_MEMORY_BUFFER_ABSENT", () => {
    getDb();
    const db = getDb();
    assert.equal(memoryBufferTableExists(db), false);
    assert.equal(memoryBufferIndexExists(db), false);
  });

  it("LEGACY_DB_MEMORY_BUFFER_DROPPED lifecycle", () => {
    const db = new Database(":memory:");

    // S1 — initial retirement
    createLegacyMemoryBuffer(db);
    insertSyntheticMemoryBufferRow(db);
    assert.equal(retirementFlagExists(db), false);
    assert.equal(memoryBufferTableExists(db), true);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS n FROM memory_buffer`).get() as { n: number }).n,
      1
    );

    dropLegacyMemoryBufferTableOnce(db);

    assert.equal(memoryBufferTableExists(db), false);
    assert.equal(memoryBufferIndexExists(db), false);
    assert.equal(retirementFlagExists(db), true);

    // S2 — idempotent rerun
    dropLegacyMemoryBufferTableOnce(db);
    assert.equal(memoryBufferTableExists(db), false);
    assert.equal(memoryBufferIndexExists(db), false);
    assert.equal(retirementFlagExists(db), true);

    // S3 — rollback recreation then current redeploy repair
    createLegacyMemoryBuffer(db);
    insertSyntheticMemoryBufferRow(db);
    assert.equal(retirementFlagExists(db), true);
    assert.equal(memoryBufferTableExists(db), true);
    assert.equal(memoryBufferIndexExists(db), true);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS n FROM memory_buffer`).get() as { n: number }).n,
      1
    );

    dropLegacyMemoryBufferTableOnce(db);

    assert.equal(memoryBufferTableExists(db), false);
    assert.equal(memoryBufferIndexExists(db), false);
    assert.equal(retirementFlagExists(db), true);
  });
});
