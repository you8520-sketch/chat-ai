import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  getPushSocialPrefs,
  notifyBroadcastInApp,
  notifyCharacterLiked,
  notifyPostCommentReceived,
  notifyProfileCommentReceived,
  notificationHref,
  notificationIcon,
  setPushSocialPrefs,
  type UserNotificationRow,
} from "@/lib/userNotifications";
import { resetWebPushVapidCache } from "@/lib/webPushVapid";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      nickname TEXT NOT NULL,
      notify_character_likes INTEGER NOT NULL DEFAULT 1,
      notify_profile_comments INTEGER NOT NULL DEFAULT 1,
      push_notify_likes INTEGER NOT NULL DEFAULT 0,
      push_notify_comments INTEGER NOT NULL DEFAULT 0
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

  it("keeps like/comment push prefs off by default", () => {
    const db = openDb();
    assert.deepEqual(getPushSocialPrefs(db, 1), {
      pushNotifyLikes: false,
      pushNotifyComments: false,
    });
  });

  it("does not queue like push when the push pref is off", () => {
    const db = openDb();
    db.exec(`
      CREATE TABLE web_push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL
      );
      CREATE TABLE web_push_user_events (
        user_id INTEGER NOT NULL,
        event_key TEXT NOT NULL,
        UNIQUE(user_id, event_key)
      );
      CREATE TABLE web_push_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        event_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE(subscription_id, event_key)
      );
    `);
    db.prepare(
      "INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://push.example/1', 'pk', 'ak')"
    ).run();
    notifyCharacterLiked(db, {
      creatorId: 1,
      actorId: 2,
      actorNickname: "유저",
      characterId: 10,
      characterName: "레온",
    });
    const outbox = db.prepare("SELECT COUNT(*) AS c FROM web_push_outbox").get() as { c: number };
    assert.equal(outbox.c, 0);
    db.close();
  });

  it("queues like push only after the user opts in", () => {
    const db = openDb();
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "test-public-key";
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "test-private-key";
    process.env.WEB_PUSH_SUBJECT = "mailto:test@example.com";
    process.env.DISABLE_WEB_PUSH_DELIVERY = "1";
    resetWebPushVapidCache();
    db.exec(`
      CREATE TABLE web_push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL
      );
      CREATE TABLE web_push_user_events (
        user_id INTEGER NOT NULL,
        event_key TEXT NOT NULL,
        UNIQUE(user_id, event_key)
      );
      CREATE TABLE web_push_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        event_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE(subscription_id, event_key)
      );
    `);
    db.prepare(
      "INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://push.example/1', 'pk', 'ak')"
    ).run();
    setPushSocialPrefs(db, 1, { pushNotifyLikes: true });
    notifyCharacterLiked(db, {
      creatorId: 1,
      actorId: 2,
      actorNickname: "유저",
      characterId: 10,
      characterName: "레온",
    });
    const outbox = db
      .prepare("SELECT payload_json FROM web_push_outbox")
      .get() as { payload_json: string };
    const payload = JSON.parse(outbox.payload_json) as { kind: string; url: string };
    assert.equal(payload.kind, "character_like");
    assert.equal(payload.url, "/character/10");
    db.close();
  });

  it("broadcasts notice and event rows to every user", () => {
    const db = openDb();
    assert.equal(
      notifyBroadcastInApp(db, {
        type: "notice",
        refId: 7,
        title: "새 공지: 점검",
        body: "오늘 밤 점검합니다.",
      }),
      2
    );
    assert.equal(
      notifyBroadcastInApp(db, {
        type: "event",
        refId: 1,
        title: "주말 이벤트",
        body: "보너스 포인트",
      }),
      2
    );
    const types = db
      .prepare("SELECT type FROM user_notifications ORDER BY id")
      .all() as { type: string }[];
    assert.deepEqual(
      types.map((row) => row.type),
      ["notice", "notice", "event", "event"]
    );
    assert.equal(notificationHref({ type: "notice" } as UserNotificationRow), "/board/notice");
    assert.equal(notificationHref({ type: "event" } as UserNotificationRow), "/");
    db.close();
  });
});
