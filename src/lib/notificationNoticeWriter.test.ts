import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { createAdminBoardPost } from "./boardPosts";
import {
  getTotalUnreadCount,
  listRecentNoticesWithReadStatus,
  notifyBroadcastInApp,
} from "./userNotifications";
import { markSingleNoticeRead } from "./notices";

function createNoticeDb() {
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
      author_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE notice_reads (
      user_id INTEGER NOT NULL,
      notice_id INTEGER NOT NULL,
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, notice_id)
    );
    CREATE TABLE user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      actor_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );
  `);
  db.prepare("INSERT INTO users (id) VALUES (1)").run();
  return db;
}

/** Production-equivalent admin notice create path after mirror removal. */
function createNoticeProductionEquivalent(db: Database.Database, adminId: number) {
  return createAdminBoardPost(db, "notice", "테스트 공지", "본문", adminId);
}

describe("notice writer — no live mirror", () => {
  it("production notice create adds post only, not user_notifications mirror", () => {
    const db = createNoticeDb();
    const guestState = { watermarkId: 0, sparseReadIds: [] as number[] };
    const postsBefore = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE board='notice'").get() as { c: number };
    const noticeId = createNoticeProductionEquivalent(db, 1);
    const postsAfter = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE board='notice'").get() as { c: number };
    const mirrorCount = db
      .prepare("SELECT COUNT(*) AS c FROM user_notifications WHERE type='notice'")
      .get() as { c: number };

    assert.equal(postsAfter.c - postsBefore.c, 1);
    assert.equal(mirrorCount.c, 0);
    assert.equal(getTotalUnreadCount(db, 1, guestState), 1);
    assert.equal(listRecentNoticesWithReadStatus(db, 1, guestState, 50).filter((n) => n.unread).length, 1);

    markSingleNoticeRead(db, 1, noticeId, guestState);
    assert.equal(getTotalUnreadCount(db, 1, guestState), 0);
    db.close();
  });

  it("admin notice route keeps web push queue path without notifyBroadcastInApp notice mirror", () => {
    const route = fs.readFileSync("src/app/api/admin/posts/route.ts", "utf8");
    assert.match(route, /queueBroadcastWebPush/);
    assert.doesNotMatch(route, /notifyBroadcastInApp/);
  });

  it("event broadcast helper remains available for home popup notices", () => {
    const db = createNoticeDb();
    const inserted = notifyBroadcastInApp(db, {
      type: "event",
      refId: 1,
      title: "이벤트",
      body: "본문",
    });
    assert.equal(inserted, 1);
    const row = db
      .prepare("SELECT type FROM user_notifications WHERE user_id=1")
      .get() as { type: string };
    assert.equal(row.type, "event");
    db.close();
  });
});
