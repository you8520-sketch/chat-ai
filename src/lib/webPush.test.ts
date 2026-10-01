import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureWebPushOutboxClaimColumns } from "./db";
import {
  WEB_PUSH_MAX_ATTEMPTS,
  claimDueWebPushOutboxRows,
  deleteInvalidWebPushSubscription,
  flushWebPushOutbox,
  listDueWebPushOutboxIds,
  markWebPushOutboxSent,
  queueBroadcastWebPush,
  queueExpiringPointPushes,
  queueUserWebPush,
  recordWebPushOutboxFailure,
  saveWebPushSubscription,
  type WebPushSendNotification,
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
      claim_token TEXT,
      claimed_until TEXT,
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

test("point expiry reminder is created once even without a push subscription", () => {
  const db = createDb();
  db.prepare(
    `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
     VALUES (9, 'FREE', 800, datetime('now', '+2 days'))`
  ).run();

  assert.equal(queueExpiringPointPushes(db), 1);
  assert.equal(queueExpiringPointPushes(db), 0);
  const notifications = db
    .prepare("SELECT COUNT(*) AS c FROM user_notifications WHERE type='point_expiring' AND user_id=9")
    .get() as { c: number };
  assert.equal(notifications.c, 1);
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

type OutboxInspect = {
  id: number;
  attempts: number;
  sent_at: string | null;
  last_error: string;
  available_at: string;
  claim_token: string | null;
  claimed_until: string | null;
};

function inspectOutbox(db: Database.Database, id = 1): OutboxInspect {
  return db
    .prepare(
      "SELECT id, attempts, sent_at, last_error, available_at, claim_token, claimed_until FROM web_push_outbox WHERE id=?"
    )
    .get(id) as OutboxInspect;
}

function recordingSend(): { send: WebPushSendNotification; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    send: async (subscription, payload) => {
      calls.push(`${subscription.endpoint}|${payload}`);
    },
  };
}

function failingSend(statusCode?: number, message = "push delivery failed"): WebPushSendNotification {
  return async () => {
    const error = new Error(message) as Error & { statusCode?: number };
    if (statusCode != null) error.statusCode = statusCode;
    throw error;
  };
}

function seedQueuedDevice(db: Database.Database, userId: number, endpoint: string, eventKey = "notice:1"): number {
  saveWebPushSubscription(db, userId, {
    endpoint,
    p256dh: `p256dh-${endpoint}`,
    auth: `auth-${endpoint}`,
  });
  assert.equal(queueUserWebPush(db, userId, eventKey, { ...payload, tag: eventKey }), true);
  const created = db
    .prepare("SELECT id FROM web_push_outbox WHERE user_id=? AND event_key=? ORDER BY id DESC LIMIT 1")
    .get(userId, eventKey) as { id: number };
  return created.id;
}

test("due-row SELECT without claim hands the same pending row to two workers", () => {
  const db = createDb();
  const id = seedQueuedDevice(db, 7, "https://push.example/a");
  const first = listDueWebPushOutboxIds(db);
  const second = listDueWebPushOutboxIds(db);
  assert.deepEqual(first, [id]);
  assert.deepEqual(second, [id]);
  assert.equal(inspectOutbox(db, id).claim_token, null);
  db.close();
});

test("two independent flush workers send one due row once", async () => {
  const db = createDb();
  seedQueuedDevice(db, 7, "https://push.example/a");
  const a = recordingSend();
  const b = recordingSend();
  await Promise.all([
    flushWebPushOutbox({ db, sendNotification: a.send, processWake: { running: false } }),
    flushWebPushOutbox({ db, sendNotification: b.send, processWake: { running: false } }),
  ]);
  assert.equal(a.calls.length + b.calls.length, 1);
  assert.ok(inspectOutbox(db).sent_at);
  db.close();
});

test("two workers claiming a multi-row batch each get exclusive rows", () => {
  const db = createDb();
  saveWebPushSubscription(db, 1, { endpoint: "https://push.example/a", p256dh: "a", auth: "a" });
  saveWebPushSubscription(db, 1, { endpoint: "https://push.example/b", p256dh: "b", auth: "b" });
  assert.equal(queueUserWebPush(db, 1, "notice:batch", payload), true);
  const first = claimDueWebPushOutboxRows(db, { token: "worker-a", limit: 50 });
  const second = claimDueWebPushOutboxRows(db, { token: "worker-b", limit: 50 });
  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.deepEqual(new Set(first.map((row) => row.claim_token)), new Set(["worker-a"]));
  db.close();
});

test("sent and retry-not-due rows cannot be claimed; retry-due can", () => {
  const db = createDb();
  saveWebPushSubscription(db, 1, { endpoint: "https://push.example/a", p256dh: "a", auth: "a" });
  assert.equal(queueUserWebPush(db, 1, "notice:sent", payload), true);
  const sentId = (db.prepare("SELECT id FROM web_push_outbox WHERE event_key='notice:sent'").get() as { id: number }).id;
  const claimed = claimDueWebPushOutboxRows(db, { token: "t1", limit: 1 });
  assert.equal(claimed[0]?.outbox_id, sentId);
  assert.equal(markWebPushOutboxSent(db, { outboxId: sentId, token: "t1" }), true);
  assert.deepEqual(claimDueWebPushOutboxRows(db, { token: "t2", limit: 1 }), []);

  saveWebPushSubscription(db, 2, { endpoint: "https://push.example/b", p256dh: "b", auth: "b" });
  assert.equal(queueUserWebPush(db, 2, "notice:wait", payload), true);
  const waitId = (db.prepare("SELECT id FROM web_push_outbox WHERE event_key='notice:wait'").get() as { id: number }).id;
  db.prepare("UPDATE web_push_outbox SET available_at=datetime('now', '+10 minutes') WHERE id=?").run(waitId);
  assert.deepEqual(claimDueWebPushOutboxRows(db, { token: "t3", limit: 5 }), []);
  db.prepare("UPDATE web_push_outbox SET available_at=datetime('now', '-1 seconds') WHERE id=?").run(waitId);
  const due = claimDueWebPushOutboxRows(db, { token: "t4", limit: 5 });
  assert.equal(due.length, 1);
  assert.equal(due[0]?.outbox_id, waitId);
  db.close();
});

test("active claim cannot be stolen; stale claim is reclaimed with a new fencing token", () => {
  const db = createDb();
  seedQueuedDevice(db, 7, "https://push.example/a");
  const first = claimDueWebPushOutboxRows(db, { token: "old-token", limit: 1 });
  assert.equal(first.length, 1);
  assert.deepEqual(claimDueWebPushOutboxRows(db, { token: "thief", limit: 1 }), []);
  db.prepare("UPDATE web_push_outbox SET claimed_until=datetime('now', '-1 seconds') WHERE id=?").run(
    first[0]!.outbox_id
  );
  const reclaimed = claimDueWebPushOutboxRows(db, { token: "new-token", limit: 1 });
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0]!.claim_token, "new-token");
  assert.notEqual(reclaimed[0]!.claim_token, "old-token");
  db.close();
});

test("old claimant cannot mark a reclaimed row sent or rewrite the new attempt", () => {
  const db = createDb();
  seedQueuedDevice(db, 7, "https://push.example/a");
  const first = claimDueWebPushOutboxRows(db, { token: "old-token", limit: 1 });
  const id = first[0]!.outbox_id;
  db.prepare("UPDATE web_push_outbox SET claimed_until=datetime('now', '-1 seconds') WHERE id=?").run(id);
  assert.equal(claimDueWebPushOutboxRows(db, { token: "new-token", limit: 1 }).length, 1);
  assert.equal(markWebPushOutboxSent(db, { outboxId: id, token: "old-token" }), false);
  assert.equal(
    recordWebPushOutboxFailure(db, { outboxId: id, token: "old-token", attempts: 0, error: "late" }),
    false
  );
  const row = inspectOutbox(db, id);
  assert.equal(row.sent_at, null);
  assert.equal(row.attempts, 0);
  assert.equal(row.last_error, "");
  assert.equal(row.claim_token, "new-token");
  db.close();
});

test("successful claimant marks sent; ordinary failure increments attempts once and preserves backoff", async () => {
  const db = createDb();
  seedQueuedDevice(db, 7, "https://push.example/ok", "notice:ok");
  seedQueuedDevice(db, 8, "https://push.example/fail", "notice:fail");
  await flushWebPushOutbox({
    db,
    processWake: { running: false },
    sendNotification: async (subscription) => {
      if (subscription.endpoint.endsWith("/fail")) throw new Error("upstream 503");
    },
  });
  const ok = db.prepare("SELECT sent_at, attempts FROM web_push_outbox WHERE event_key='notice:ok'").get() as {
    sent_at: string | null;
    attempts: number;
  };
  const failed = db
    .prepare(
      "SELECT sent_at, attempts, last_error, available_at, claim_token FROM web_push_outbox WHERE event_key='notice:fail'"
    )
    .get() as {
    sent_at: string | null;
    attempts: number;
    last_error: string;
    available_at: string;
    claim_token: string | null;
  };
  assert.ok(ok.sent_at);
  assert.equal(ok.attempts, 0);
  assert.equal(failed.sent_at, null);
  assert.equal(failed.attempts, 1);
  assert.match(failed.last_error, /upstream 503/);
  assert.equal(failed.claim_token, null);
  const now = db.prepare("SELECT datetime('now') AS n").get() as { n: string };
  assert.ok(failed.available_at > now.n);
  db.close();
});

test("max-attempt row is not reclaimed", () => {
  const db = createDb();
  seedQueuedDevice(db, 7, "https://push.example/a");
  db.prepare("UPDATE web_push_outbox SET attempts=? WHERE id=1").run(WEB_PUSH_MAX_ATTEMPTS);
  assert.deepEqual(claimDueWebPushOutboxRows(db, { token: "done", limit: 1 }), []);
  db.close();
});

test("404/410 deletes the subscription and its outbox; stale finish is a no-op", async () => {
  const db = createDb();
  saveWebPushSubscription(db, 7, { endpoint: "https://push.example/gone", p256dh: "a", auth: "a" });
  assert.equal(queueUserWebPush(db, 7, "notice:a", payload), true);
  assert.equal(queueUserWebPush(db, 7, "notice:b", { ...payload, tag: "notice:b" }), true);
  const claimed = claimDueWebPushOutboxRows(db, { token: "old", limit: 1 });
  await flushWebPushOutbox({
    db,
    processWake: { running: false },
    sendNotification: failingSend(410, "Gone"),
  });
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM web_push_outbox").get() as { c: number }).c, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM web_push_subscriptions").get() as { c: number }).c, 0);
  assert.equal(markWebPushOutboxSent(db, { outboxId: claimed[0]!.outbox_id, token: "old" }), false);
  assert.equal(deleteInvalidWebPushSubscription(db, 1), false);
  db.close();
});

test("enqueue UNIQUE(subscription_id,event_key) and user-event idempotency stay unchanged", () => {
  const db = createDb();
  saveWebPushSubscription(db, 7, { endpoint: "https://push.example/a", p256dh: "a", auth: "a" });
  saveWebPushSubscription(db, 7, { endpoint: "https://push.example/b", p256dh: "b", auth: "b" });
  assert.equal(queueUserWebPush(db, 7, "notice:1", payload), true);
  assert.equal(queueUserWebPush(db, 7, "notice:1", payload), false);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM web_push_outbox").get() as { c: number }).c, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM web_push_user_events").get() as { c: number }).c, 1);
  db.close();
});

test("delivery-disabled env still queues but scheduleWebPushDelivery does not flush", () => {
  const db = createDb();
  seedQueuedDevice(db, 7, "https://push.example/a");
  assert.equal(process.env.DISABLE_WEB_PUSH_DELIVERY, "1");
  assert.equal(inspectOutbox(db).sent_at, null);
  db.close();
});

test("existing outbox rows without claim columns remain pending after additive migrate", async () => {
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
  `);
  db.prepare(
    `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (7, 'https://push.example/legacy', 'p', 'a')`
  ).run();
  db.prepare(
    `INSERT INTO web_push_outbox (subscription_id, user_id, event_key, payload_json)
     VALUES (1, 7, 'notice:legacy', ?)`
  ).run(JSON.stringify(payload));
  ensureWebPushOutboxClaimColumns(db);
  const send = recordingSend();
  await flushWebPushOutbox({ db, sendNotification: send.send, processWake: { running: false } });
  assert.equal(send.calls.length, 1);
  assert.ok(inspectOutbox(db).sent_at);
  db.close();
});

test("crash after claim and before provider leaves the row claimed and unsent", () => {
  const db = createDb();
  seedQueuedDevice(db, 7, "https://push.example/a");
  const claimed = claimDueWebPushOutboxRows(db, { token: "crash-before-send", limit: 1 });
  assert.equal(claimed.length, 1);
  const row = inspectOutbox(db);
  assert.equal(row.sent_at, null);
  assert.equal(row.claim_token, "crash-before-send");
  assert.deepEqual(claimDueWebPushOutboxRows(db, { token: "other", limit: 1 }), []);
  db.close();
});

test("provider success before local sent_at stays unsent until matching token completes", async () => {
  const db = createDb();
  seedQueuedDevice(db, 7, "https://push.example/a");
  const send = recordingSend();
  const claimed = claimDueWebPushOutboxRows(db, { token: "accepted", limit: 1 });
  await send.send(
    { endpoint: claimed[0]!.endpoint, keys: { p256dh: claimed[0]!.p256dh, auth: claimed[0]!.auth } },
    claimed[0]!.payload_json
  );
  assert.equal(send.calls.length, 1);
  assert.equal(inspectOutbox(db).sent_at, null);
  assert.equal(markWebPushOutboxSent(db, { outboxId: claimed[0]!.outbox_id, token: "accepted" }), true);
  assert.ok(inspectOutbox(db).sent_at);
  db.close();
});

test("inspect query finds long-claimed, exhausted, and repeated-failure rows", () => {
  const db = createDb();
  seedQueuedDevice(db, 1, "https://push.example/claimed", "notice:claimed");
  seedQueuedDevice(db, 2, "https://push.example/exhausted", "notice:exhausted");
  seedQueuedDevice(db, 3, "https://push.example/repeat", "notice:repeat");
  claimDueWebPushOutboxRows(db, { token: "live", limit: 1 });
  db.prepare("UPDATE web_push_outbox SET attempts=5, last_error='gone' WHERE event_key='notice:exhausted'").run();
  db.prepare("UPDATE web_push_outbox SET attempts=3, last_error='503' WHERE event_key='notice:repeat'").run();
  const longClaimed = db
    .prepare(
      `SELECT id FROM web_push_outbox
        WHERE sent_at IS NULL AND claim_token IS NOT NULL AND claimed_until > datetime('now')`
    )
    .all() as { id: number }[];
  const exhausted = db
    .prepare(`SELECT id FROM web_push_outbox WHERE attempts >= ? AND sent_at IS NULL`)
    .all(WEB_PUSH_MAX_ATTEMPTS) as { id: number }[];
  const repeats = db
    .prepare(`SELECT id FROM web_push_outbox WHERE attempts >= 3 AND sent_at IS NULL`)
    .all() as { id: number }[];
  assert.equal(longClaimed.length, 1);
  assert.equal(exhausted.length, 1);
  assert.equal(repeats.length, 2);
  db.close();
});
