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

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function indexNames(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`)
      .all() as { name: string }[]
  ).map((row) => row.name);
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("memory_buffer schema retirement", () => {
  it("FRESH_DB_MEMORY_BUFFER_ABSENT", () => {
    getDb();
    const db = getDb();
    assert.equal(
      db
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='memory_buffer'`)
        .get().n,
      0
    );
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_memory_buffer_user_char'`
        )
        .get().n,
      0
    );
  });

  it("LEGACY_DB_MEMORY_BUFFER_DROPPED", () => {
    const db = new Database(":memory:");
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
    db.prepare(
      `INSERT INTO memory_buffer (user_id, character_id, role, content, message_index, chat_id)
       VALUES (1, 2, 'user', 'legacy fixture', 1, 99)`
    ).run();

    assert.ok(tableNames(db).includes("memory_buffer"));
    assert.ok(indexNames(db).includes("idx_memory_buffer_user_char"));
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS n FROM memory_buffer`).get() as { n: number }).n,
      1
    );

    dropLegacyMemoryBufferTableOnce(db);

    assert.equal(
      db
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='memory_buffer'`)
        .get().n,
      0
    );
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_memory_buffer_user_char'`
        )
        .get().n,
      0
    );

    dropLegacyMemoryBufferTableOnce(db);
    assert.equal(
      db
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='memory_buffer'`)
        .get().n,
      0
    );
  });
});
