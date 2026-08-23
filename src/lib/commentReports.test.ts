import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { reportProfileComment } from "./commentReports";

process.env.DISABLE_WEB_PUSH = "1";

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '2020-01-01 00:00:00',
      is_admin INTEGER NOT NULL DEFAULT 0,
      comment_report_trust INTEGER NOT NULL DEFAULT 100,
      comment_report_restricted_until TEXT
    );
    CREATE TABLE point_logs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, delta REAL NOT NULL);
    CREATE TABLE profile_comments (
      id INTEGER PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_blinded INTEGER NOT NULL DEFAULT 0,
      report_count INTEGER NOT NULL DEFAULT 0,
      moderation_status TEXT NOT NULL DEFAULT 'visible',
      normalized_content TEXT NOT NULL DEFAULT '',
      delete_reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE profile_comment_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      reporter_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolution TEXT,
      resolved_at TEXT,
      UNIQUE(comment_id, reporter_id)
    );
    CREATE TABLE profile_comment_moderation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      original_content TEXT NOT NULL DEFAULT '',
      normalized_content TEXT NOT NULL DEFAULT '',
      matched_words_json TEXT NOT NULL DEFAULT '[]',
      report_count INTEGER,
      ai_verdict TEXT,
      ai_reason TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      delete_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      actor_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );
    CREATE TABLE web_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL
    );
    CREATE TABLE web_push_user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE web_push_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(subscription_id, event_key)
    );
    INSERT INTO users (id, is_admin) VALUES (1,0),(50,1),(100,0);
    INSERT INTO profile_comments (id, target_type, target_id, author_id, author_name, content)
      VALUES (10, 'creator', 100, 1, '작성자', '검토 대상 댓글');
  `);
  const insertUser = db.prepare("INSERT INTO users (id) VALUES (?)");
  const insertSpend = db.prepare("INSERT INTO point_logs (user_id, delta) VALUES (?, -500)");
  for (let id = 2; id <= 11; id += 1) {
    insertUser.run(id);
    insertSpend.run(id);
  }
  return db;
}

describe("profile comment reports", () => {
  it("blinds at ten unresolved reports and alerts every admin", async () => {
    const db = setup();
    for (let reporterId = 2; reporterId <= 11; reporterId += 1) {
      const result = await reportProfileComment(db, reporterId, 10);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.blinded, reporterId === 11);
    }
    const comment = db.prepare("SELECT is_blinded, moderation_status, report_count FROM profile_comments WHERE id=10").get() as Record<string, number | string>;
    assert.equal(comment.is_blinded, 1);
    assert.equal(comment.moderation_status, "blinded");
    assert.equal(comment.report_count, 10);
    const alert = db.prepare("SELECT type, ref_id FROM user_notifications WHERE user_id=50").get() as { type: string; ref_id: number };
    assert.equal(alert.type, "admin_comment_review");
    assert.equal(alert.ref_id, 10);
  });
});
