import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { reviewReportedComment } from "./adminCommentReports";

process.env.DISABLE_WEB_PUSH = "1";

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      comment_banned INTEGER NOT NULL DEFAULT 0,
      comment_report_trust INTEGER NOT NULL DEFAULT 100,
      comment_report_restricted_until TEXT
    );
    CREATE TABLE profile_comments (
      id INTEGER PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_blinded INTEGER NOT NULL DEFAULT 1,
      report_count INTEGER NOT NULL DEFAULT 10,
      moderation_status TEXT NOT NULL DEFAULT 'blinded',
      normalized_content TEXT NOT NULL DEFAULT '',
      delete_reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE profile_comment_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      reporter_id INTEGER NOT NULL,
      resolution TEXT,
      resolved_at TEXT
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
    INSERT INTO users (id) VALUES (1), (2), (3), (4);
    INSERT INTO profile_comments (id, target_type, target_id, author_id, author_name, content)
      VALUES (10, 'character', 20, 1, '작성자', '신고된 댓글');
    INSERT INTO profile_comment_reports (comment_id, reporter_id) VALUES (10, 2), (10, 3), (10, 4);
  `);
  return db;
}

describe("reported comment admin review", () => {
  it("restores a comment and penalizes only unresolved reporters", () => {
    const db = setup();
    const result = reviewReportedComment(db, 99, 10, "restore", "위반 없음");
    assert.deepEqual(result, { ok: true, banned: false });
    const comment = db.prepare("SELECT moderation_status, is_blinded, report_count FROM profile_comments WHERE id=10").get() as Record<string, number | string>;
    assert.equal(comment.moderation_status, "visible");
    assert.equal(comment.is_blinded, 0);
    assert.equal(comment.report_count, 0);
    const trusts = db.prepare("SELECT comment_report_trust FROM users WHERE id IN (2,3,4) ORDER BY id").all() as { comment_report_trust: number }[];
    assert.deepEqual(trusts.map((row) => row.comment_report_trust), [88, 88, 88]);
    const unresolved = db.prepare("SELECT COUNT(*) AS c FROM profile_comment_reports WHERE resolved_at IS NULL").get() as { c: number };
    assert.equal(unresolved.c, 0);
  });

  it("counts an admin deletion as a strike and bans on the third strike", () => {
    const db = setup();
    db.prepare("INSERT INTO profile_comment_moderation_logs (user_id, event_type, action) VALUES (1,'post','blocked_post'),(1,'post','blocked_post')").run();
    const result = reviewReportedComment(db, 99, 10, "delete", "운영 정책 위반");
    assert.deepEqual(result, { ok: true, banned: true });
    const user = db.prepare("SELECT comment_banned FROM users WHERE id=1").get() as { comment_banned: number };
    assert.equal(user.comment_banned, 1);
    const notification = db.prepare("SELECT type FROM user_notifications WHERE user_id=1").get() as { type: string };
    assert.equal(notification.type, "comment_moderation");
  });
});
