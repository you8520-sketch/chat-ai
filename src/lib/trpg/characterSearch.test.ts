import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { searchTrpgCharacters } from "./characterSearch";

describe("TRPG character search", () => {
  it("splits own characters from public TRPG-opt-in search", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tagline TEXT NOT NULL DEFAULT '',
        creator_id INTEGER,
        creator_name TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'public',
        moderation_status TEXT NOT NULL DEFAULT 'approved',
        official INTEGER NOT NULL DEFAULT 0,
        trpg_reuse_allowed INTEGER NOT NULL DEFAULT 0,
        emoji TEXT NOT NULL DEFAULT '✨',
        likes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(
      `INSERT INTO characters (name, tagline, creator_id, creator_name, official, trpg_reuse_allowed)
       VALUES ('내캐', 'mine', 1, '렌', 0, 0),
              ('공개', 'open', 2, '다른이', 0, 1),
              ('숨김', 'hidden', 3, '비밀', 0, 0)`
    ).run();
    const mine = searchTrpgCharacters(db, { viewerUserId: 1, scope: "mine" });
    assert.deepEqual(
      mine.map((c) => c.name),
      ["내캐"]
    );
    const found = searchTrpgCharacters(db, { viewerUserId: 1, scope: "search", query: "공개" });
    assert.deepEqual(
      found.map((c) => c.name),
      ["공개"]
    );
    const hidden = searchTrpgCharacters(db, { viewerUserId: 1, scope: "search", query: "숨김" });
    assert.equal(hidden.length, 0);
    db.close();
  });
});
