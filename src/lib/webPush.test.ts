import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  queueBroadcastWebPush,
  queueExpiringPointPushes,
  queueUserWebPush,
  saveWebPushSubscription,
} from "./webPush";
import { resetWebPushVapidCache } from "./webPushVapid";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE web_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE web_push_user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, event_key)
    );
    CREATE TABLE web_push_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(subscription_id, event_key)
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

const payload = {
  title: "Test",
  body: "Test notification",
  url: "/notifications",
  tag: "test",
  kind: "notice" as const,
};

test.before(() => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "test-public-key";
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "test-private-key";
  process.env.WEB_PUSH_SUBJECT = "mailto:test@example.com";
  process.env.DISABLE_WEB_PUSH_DELIVERY = "1";
  resetWebPushVapidCache();
});

test.after(() => {
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_SUBJECT;
  delete process.env.DISABLE_WEB_PUSH_DELIVERY;
  resetWebPushVapidCache();
});

test("queues a user event once for every current device", () => {
  const db = createDb();
  saveWebPushSubscription(db, 7, {
    endpoint: "https://push.example/a",
    p256dh: "public-key-a",
    auth: "auth-key-a",
  });
  saveWebPushSubscription(db, 7, {
    endpoint: "https://push.example/b",
    p256dh: "public-key-b",
    auth: "auth-key-b",
  });

  assert.equal(queueUserWebPush(db, 7, "notice:1", payload), true);
  assert.equal(queueUserWebPush(db, 7, "notice:1", payload), false);
  const count = db.prepare("SELECT COUNT(*) AS c FROM web_push_outbox").get() as { c: number };
  assert.equal(count.c, 2);
  db.close();
});

test("broadcast queues only subscribed users", () => {
  const db = createDb();
  for (const userId of [1, 2]) {
    saveWebPushSubscription(db, userId, {
      endpoint: `https://push.example/${userId}`,
      p256dh: `public-key-${userId}`,
      auth: `auth-key-${userId}`,
    });
  }
  assert.equal(queueBroadcastWebPush(db, "event:1", { ...payload, kind: "event" }), 2);
  const count = db.prepare("SELECT COUNT(*) AS c FROM web_push_outbox").get() as { c: number };
  assert.equal(count.c, 2);
  db.close();
});

test("point expiry reminder is created once per nearest expiry", () => {
  const db = createDb();
  saveWebPushSubscription(db, 3, {
    endpoint: "https://push.example/expiry",
    p256dh: "public-key-expiry",
    auth: "auth-key-expiry",
  });
  db.prepare(
    `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
     VALUES (3, 'FREE', 1200, datetime('now', '+2 days'))`
  ).run();

  assert.equal(queueExpiringPointPushes(db), 1);
  assert.equal(queueExpiringPointPushes(db), 0);
  const notifications = db
    .prepare("SELECT COUNT(*) AS c FROM user_notifications WHERE type='point_expiring'")
    .get() as { c: number };
  assert.equal(notifications.c, 1);
  db.close();
});
