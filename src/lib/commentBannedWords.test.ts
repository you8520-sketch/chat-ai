import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCommentTextForModeration } from "@/lib/commentTextNormalize";
import { matchCommentBannedWords } from "@/lib/commentBannedWords";
import Database from "better-sqlite3";

describe("comment moderation helpers", () => {
  it("matches seeded profanity after normalization", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE comment_banned_words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        match_type TEXT NOT NULL DEFAULT 'substring',
        ai_check INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(
      "INSERT INTO comment_banned_words (word, category) VALUES ('시발','profanity')"
    ).run();

    const { matches, normalized } = matchCommentBannedWords(db, "시. 발");
    assert.equal(normalized, "시발");
    assert.equal(matches.length, 1);
    db.close();
  });
});
