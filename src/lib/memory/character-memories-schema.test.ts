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
import { dropLegacyCharacterMemoriesTableOnce, getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

function characterMemoriesTableExists(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='character_memories'`)
      .get()
  );
}

function characterMemoriesIndexExists(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='index' AND name='idx_character_memories_user'`
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
      .prepare("SELECT 1 AS ok FROM _schema_flags WHERE key='character_memories_dropped_v1'")
      .get()
  );
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
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, character_id)
    );
    CREATE INDEX idx_character_memories_user ON character_memories(user_id);
  `);
}

function insertSyntheticCharacterMemoryRow(db: Database.Database): void {
  db.prepare(
    `INSERT INTO character_memories
      (user_id, character_id, recent_summary, used_chars, message_count, summarized_turn_count)
     VALUES (1, 2, 'legacy fixture', 12, 3, 0)`
  ).run();
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("character_memories schema retirement", () => {
  it("FRESH_DB_CHARACTER_MEMORIES_ABSENT", () => {
    getDb();
    const db = getDb();
    assert.equal(characterMemoriesTableExists(db), false);
    assert.equal(characterMemoriesIndexExists(db), false);
  });

  it("LEGACY_DB_CHARACTER_MEMORIES_DROPPED lifecycle", () => {
    const db = new Database(":memory:");

    // S1 — initial retirement
    createLegacyCharacterMemories(db);
    insertSyntheticCharacterMemoryRow(db);
    assert.equal(retirementFlagExists(db), false);
    assert.equal(characterMemoriesTableExists(db), true);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS n FROM character_memories`).get() as { n: number }).n,
      1
    );

    dropLegacyCharacterMemoriesTableOnce(db);

    assert.equal(characterMemoriesTableExists(db), false);
    assert.equal(characterMemoriesIndexExists(db), false);
    assert.equal(retirementFlagExists(db), true);

    // S2 — idempotent rerun
    dropLegacyCharacterMemoriesTableOnce(db);
    assert.equal(characterMemoriesTableExists(db), false);
    assert.equal(characterMemoriesIndexExists(db), false);
    assert.equal(retirementFlagExists(db), true);

    // S3 — rollback recreation then current redeploy repair
    createLegacyCharacterMemories(db);
    insertSyntheticCharacterMemoryRow(db);
    assert.equal(retirementFlagExists(db), true);
    assert.equal(characterMemoriesTableExists(db), true);
    assert.equal(characterMemoriesIndexExists(db), true);

    dropLegacyCharacterMemoriesTableOnce(db);

    assert.equal(characterMemoriesTableExists(db), false);
    assert.equal(characterMemoriesIndexExists(db), false);
    assert.equal(retirementFlagExists(db), true);
  });
});
