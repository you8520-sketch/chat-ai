import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  getNoticeById,
  getUnreadNoticeCount,
  isNoticeRead,
  markSingleNoticeRead,
  markNoticesRead,
} from "./notices";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      notice_last_read_id INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '운영팀',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE notice_reads (
      user_id INTEGER NOT NULL,
      notice_id INTEGER NOT NULL,
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, notice_id)
    );
  `);
  db.prepare("INSERT INTO users (id, notice_last_read_id) VALUES (1, 0)").run();
  db.prepare("INSERT INTO posts (board, title, content) VALUES ('notice', 'A', 'body-a')").run();
  db.prepare("INSERT INTO posts (board, title, content) VALUES ('notice', 'B', 'body-b')").run();
  db.prepare("INSERT INTO posts (board, title, content) VALUES ('faq', 'FAQ', 'faq-body')").run();
  return db;
}

describe("notices canonical read + detail", () => {
  it("returns notice detail only for notice board rows", () => {
    const db = createDb();
    const notice = getNoticeById(db, 1);
    assert.ok(notice);
    assert.equal(notice?.title, "A");
    assert.equal(getNoticeById(db, 3), undefined);
    db.close();
  });

  it("marks a single notice read without marking others", () => {
    const db = createDb();
    const guestState = { watermarkId: 0, sparseReadIds: [] as number[] };
    markSingleNoticeRead(db, 1, 1, guestState);
    assert.equal(isNoticeRead(db, 1, 1, guestState), true);
    assert.equal(isNoticeRead(db, 1, 2, guestState), false);
    assert.equal(getUnreadNoticeCount(db, 1, guestState), 1);
    db.close();
  });

  it("mark all still marks every notice for logged-in users", () => {
    const db = createDb();
    const guestState = { watermarkId: 0, sparseReadIds: [] as number[] };
    markNoticesRead(db, 1, 2);
    assert.equal(getUnreadNoticeCount(db, 1, guestState), 0);
    db.close();
  });
});
