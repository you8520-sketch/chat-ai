import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  addGuestSparseNoticeRead,
  isGuestNoticeRead,
  markAllGuestNoticesRead,
  readGuestNoticeReadState,
} from "./noticeGuestReadCookies";
import {
  getUnreadNoticeCount,
  isNoticeRead,
  markAllGuestNoticeReads,
  markNoticesRead,
  markSingleNoticeRead,
} from "./notices";
import { shouldPanelOwnNotificationPolling } from "./notificationFeedClient";
import {
  getTotalUnreadCount,
  getUnreadUserNotificationCount,
  listRecentNoticesWithReadStatus,
  notifyBroadcastInApp,
} from "./userNotifications";

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

function createNoticeWithBroadcast(db: Database.Database, userId: number) {
  const result = db
    .prepare("INSERT INTO posts (board, title, content, author_name) VALUES ('notice', ?, ?, '운영팀')")
    .run("테스트 공지", "본문");
  const noticeId = Number(result.lastInsertRowid);
  notifyBroadcastInApp(db, {
    type: "notice",
    refId: noticeId,
    title: "새 공지: 테스트 공지",
    body: "본문",
  });
  return noticeId;
}

/** Legacy prefix-only guest semantics that caused BLOCKER 2. */
function legacyPrefixGuestIsRead(noticeId: number, cookieReadId: number): boolean {
  return noticeId <= cookieReadId;
}

describe("notification read-state correction", () => {
  it("CASE A — logged-in notice counts +1 then single read returns 0 without activity duplicate", () => {
    const db = createNoticeDb();
    const guestState = { watermarkId: 0, sparseReadIds: [] as number[] };
    createNoticeWithBroadcast(db, 1);

    const mirroredNoticeRows = db
      .prepare("SELECT COUNT(*) AS c FROM user_notifications WHERE user_id=1 AND type='notice' AND read_at IS NULL")
      .get() as { c: number };
    assert.equal(mirroredNoticeRows.c, 1);
    assert.equal(getUnreadUserNotificationCount(db, 1), 0);
    assert.equal(getTotalUnreadCount(db, 1, guestState), 1);

    const feed = listRecentNoticesWithReadStatus(db, 1, guestState, 50);
    assert.equal(feed.filter((notice) => notice.unread).length, 1);
    assert.equal(getUnreadUserNotificationCount(db, 1) + feed.filter((notice) => notice.unread).length, 1);

    markSingleNoticeRead(db, 1, feed[0]!.id, guestState);
    assert.equal(getTotalUnreadCount(db, 1, guestState), 0);
    db.close();
  });

  it("CASE B — guest sparse read keeps older notices unread (legacy prefix would fail)", () => {
    const db = createNoticeDb();
    db.prepare("INSERT INTO posts (board, title, content) VALUES ('notice', 'A', 'a')").run();
    db.prepare("INSERT INTO posts (board, title, content) VALUES ('notice', 'B', 'b')").run();
    db.prepare("INSERT INTO posts (board, title, content) VALUES ('notice', 'C', 'c')").run();
    const ids = (db.prepare("SELECT id FROM posts WHERE board='notice' ORDER BY id ASC").all() as { id: number }[]).map(
      (row) => row.id
    );
    const [idA, idB, idC] = ids;
    assert.equal(ids.length, 3);

    const legacyCookie = idC;
    assert.equal(legacyPrefixGuestIsRead(idA, legacyCookie), true);
    assert.equal(legacyPrefixGuestIsRead(idB, legacyCookie), true);
    assert.equal(legacyPrefixGuestIsRead(idC, legacyCookie), true);

    let guestState = readGuestNoticeReadState({});
    guestState = markSingleNoticeRead(db, null, idC, guestState);
    assert.equal(isNoticeRead(db, null, idC, guestState), true);
    assert.equal(isNoticeRead(db, null, idA, guestState), false);
    assert.equal(isNoticeRead(db, null, idB, guestState), false);
    assert.equal(getUnreadNoticeCount(db, null, guestState), 2);
    db.close();
  });

  it("CASE C — mark-all then new notice is the only unread (guest + logged-in)", () => {
    const db = createNoticeDb();
    db.prepare("INSERT INTO posts (board, title, content) VALUES ('notice', 'old', 'x')").run();
    const oldId = (
      db.prepare("SELECT id FROM posts WHERE board='notice' ORDER BY id ASC LIMIT 1").get() as { id: number }
    ).id;

    markNoticesRead(db, 1, oldId);
    let guestState = markAllGuestNoticeReads(oldId);
    assert.equal(getTotalUnreadCount(db, 1, guestState), 0);
    assert.equal(getUnreadNoticeCount(db, null, guestState), 0);

    createNoticeWithBroadcast(db, 1);
    assert.equal(getTotalUnreadCount(db, 1, guestState), 1);
    assert.equal(getUnreadNoticeCount(db, null, guestState), 1);
    db.close();
  });

  it("CASE D — single Bell polling owner; panel does not own interval fetch", () => {
    assert.equal(shouldPanelOwnNotificationPolling(), false);
    const bell = fs.readFileSync("src/components/NotificationBell.tsx", "utf8");
    const panel = fs.readFileSync("src/components/NotificationCenterPanel.tsx", "utf8");
    assert.match(bell, /NOTIFICATION_FEED_REFRESH_MS/);
    assert.match(bell, /setInterval/);
    assert.match(bell, /fetchNotificationFeed/);
    assert.doesNotMatch(panel, /setInterval/);
    assert.doesNotMatch(panel, /fetch\("\/api\/notifications"/);
    assert.match(panel, /onRefresh/);
  });

  it("parses malformed sparse cookie tokens safely", () => {
    const state = readGuestNoticeReadState({
      watermarkRaw: "5",
      sparseRaw: "10,abc,10,20,,30",
    });
    assert.deepEqual(state.sparseReadIds, [10, 20, 30]);
    assert.equal(isGuestNoticeRead(10, state), true);
    assert.equal(isGuestNoticeRead(15, state), false);
  });

  it("compacts sparse ids above watermark and enforces max size", () => {
    let state = markAllGuestNoticesRead(100);
    for (let id = 101; id <= 160; id += 1) {
      state = addGuestSparseNoticeRead(state, id);
    }
    assert.equal(state.sparseReadIds.length, 50);
    assert.ok(state.sparseReadIds[0]! >= 111);
    assert.equal(isGuestNoticeRead(110, state), false);
    assert.equal(isGuestNoticeRead(160, state), true);
  });
});
