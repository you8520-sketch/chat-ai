import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  notifyCharacterLiked,
  notifyPostCommentReceived,
  notifyProfileCommentReceived,
  notificationHref,
  notificationIcon,
  type UserNotificationRow,
} from "@/lib/userNotifications";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      nickname TEXT NOT NULL,
      notify_character_likes INTEGER NOT NULL DEFAULT 1,
      notify_profile_comments INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      creator_id INTEGER,
      emoji TEXT DEFAULT '✨',
      hue INTEGER DEFAULT 260
    );
    CREATE TABLE profile_comments (
      id INTEGER PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL
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
  `);
  db.prepare(
    "INSERT INTO users (id, nickname, notify_character_likes, notify_profile_comments) VALUES (1, '작가', 1, 1), (2, '유저', 1, 1)"
  ).run();
  db.prepare("INSERT INTO characters (id, name, creator_id) VALUES (10, '레온', 1)").run();
  return db;
}

describe("character like / comment notifications", () => {
  it("notifies creator on like when pref on", () => {
    const db = openDb();
    notifyCharacterLiked(db, {
      creatorId: 1,
      actorId: 2,
      actorNickname: "유저",
      characterId: 10,
      characterName: "레온",
    });
    const row = db
      .prepare("SELECT type, user_id, ref_id, title FROM user_notifications")
      .get() as { type: string; user_id: number; ref_id: number; title: string };
    assert.equal(row.type, "character_like");
    assert.equal(row.user_id, 1);
    assert.equal(row.ref_id, 10);
    assert.equal(notificationIcon("character_like"), "❤️");
  });

  it("skips like notify when pref off or self-like", () => {
    const db = openDb();
    db.prepare("UPDATE users SET notify_character_likes=0 WHERE id=1").run();
    notifyCharacterLiked(db, {
      creatorId: 1,
      actorId: 2,
      actorNickname: "유저",
      characterId: 10,
      characterName: "레온",
    });
    notifyCharacterLiked(db, {
      creatorId: 1,
      actorId: 1,
      actorNickname: "작가",
      characterId: 10,
      characterName: "레온",
    });
    const n = db.prepare("SELECT COUNT(*) AS c FROM user_notifications").get() as { c: number };
    assert.equal(n.c, 0);
  });

  it("notifies on profile comment when pref on", () => {
    const db = openDb();
    db.prepare(
      "INSERT INTO profile_comments (id, target_type, target_id) VALUES (5, 'character', 10)"
    ).run();
    notifyProfileCommentReceived(db, {
      recipientId: 1,
      actorId: 2,
      actorNickname: "유저",
      commentId: 5,
      targetType: "character",
      targetLabel: "레온",
      preview: "재밌어요",
    });
    const row = db
      .prepare("SELECT type, user_id, ref_id FROM user_notifications")
      .get() as { type: string; user_id: number; ref_id: number };
    assert.equal(row.type, "profile_comment");
    assert.equal(row.user_id, 1);
    assert.equal(row.ref_id, 5);
    const href = notificationHref({
      id: 1,
      user_id: 1,
      type: "profile_comment",
      ref_id: 5,
      actor_id: 2,
      title: "",
      body: "",
      created_at: "",
      read_at: null,
      emoji: null,
      hue: null,
      character_name: null,
      actor_nickname: "유저",
      comment_target_type: "character",
      comment_target_id: 10,
    } as UserNotificationRow);
    assert.equal(href, "/character/10");
  });

  it("skips comment notify when pref off", () => {
    const db = openDb();
    db.prepare("UPDATE users SET notify_profile_comments=0 WHERE id=1").run();
    notifyProfileCommentReceived(db, {
      recipientId: 1,
      actorId: 2,
      actorNickname: "유저",
      commentId: 9,
      targetType: "creator",
      targetLabel: "",
      preview: "hello",
    });
    const n = db.prepare("SELECT COUNT(*) AS c FROM user_notifications").get() as { c: number };
    assert.equal(n.c, 0);
  });

  it("notifies a post author when another user leaves a comment", () => {
    const db = openDb();
    notifyPostCommentReceived(db, {
      recipientId: 1,
      actorId: 2,
      actorNickname: "유저",
      postId: 31,
      postTitle: "업데이트 팁",
      preview: "좋은 정보 감사합니다.",
    });

    const row = db
      .prepare("SELECT type, user_id, ref_id, title FROM user_notifications")
      .get() as { type: string; user_id: number; ref_id: number; title: string };
    assert.equal(row.type, "post_comment");
    assert.equal(row.user_id, 1);
    assert.equal(row.ref_id, 31);
    assert.equal(row.title, "새 댓글");
    assert.equal(notificationIcon("post_comment"), "💬");
  });
});
