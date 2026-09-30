import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  runAdminSupplyDraftNotificationScan,
} from "@/cron/adminSupplyDraftNotificationScheduler";
import { notificationHref } from "@/lib/userNotificationPresentation";
import { resetWebPushVapidCache } from "@/lib/webPushVapid";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0
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
  `);
  return db;
}

function githubPullsResponse(pulls: unknown[]): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(pulls), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("admin supply Draft notification watcher", () => {
  beforeEach(() => {
    process.env.DISABLE_WEB_PUSH_DELIVERY = "1";
    delete process.env.DISABLE_WEB_PUSH;
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "fixture-public";
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "fixture-private";
    process.env.WEB_PUSH_SUBJECT = "https://hav.chat";
    resetWebPushVapidCache();
  });

  afterEach(() => {
    delete process.env.DISABLE_WEB_PUSH_DELIVERY;
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEB_PUSH_SUBJECT;
    resetWebPushVapidCache();
  });

  it("notifies admins once and queues web push only for subscribed admins", async () => {
    const db = makeDb();
    db.prepare("INSERT INTO users (id,email,is_admin) VALUES (1,'admin1@example.com',1)").run();
    db.prepare("INSERT INTO users (id,email,is_admin) VALUES (2,'admin2@example.com',1)").run();
    db.prepare("INSERT INTO users (id,email,is_admin) VALUES (3,'user@example.com',0)").run();
    db.prepare(
      "INSERT INTO web_push_subscriptions (user_id,endpoint,p256dh,auth) VALUES (1,'https://push.example/1','p256dh','auth')"
    ).run();

    const pull = {
      number: 1401,
      title: "draft: promote gemini-3.7-flash",
      html_url: "https://github.com/example/repo/pull/1401",
      state: "open",
      draft: true,
      created_at: "2026-09-30T10:00:00Z",
      updated_at: "2026-09-30T10:01:00Z",
      body: "<!-- main-rp-supply-auto:gemini-3.7-flash:google-vertex -->",
    };

    const first = await runAdminSupplyDraftNotificationScan(
      db,
      async () => githubPullsResponse([pull])
    );
    assert.equal(first.status, "OK");
    assert.equal(first.draftsSeen, 1);
    assert.equal(first.adminNotificationsCreated, 2);

    const notifications = db
      .prepare(
        "SELECT user_id,type,ref_id,title,body FROM user_notifications ORDER BY user_id"
      )
      .all() as Array<{
        user_id: number;
        type: string;
        ref_id: number;
        title: string;
        body: string;
      }>;
    assert.deepEqual(
      notifications.map((row) => [row.user_id, row.type, row.ref_id]),
      [
        [1, "admin_supply_draft", 1401],
        [2, "admin_supply_draft", 1401],
      ]
    );
    assert.match(notifications[0]!.body, /gemini-3\.7-flash/);
    assert.match(notifications[0]!.body, /google-vertex/);

    const outbox = db
      .prepare("SELECT user_id,payload_json FROM web_push_outbox")
      .all() as Array<{ user_id: number; payload_json: string }>;
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0]!.user_id, 1);
    const payload = JSON.parse(outbox[0]!.payload_json) as {
      title: string;
      url: string;
      tag: string;
    };
    assert.equal(payload.title, "공급망 Draft PR 검토 필요");
    assert.equal(payload.url, "/admin/automation-reports");
    assert.equal(payload.tag, "admin-supply-draft:1401");

    const second = await runAdminSupplyDraftNotificationScan(
      db,
      async () => githubPullsResponse([pull])
    );
    assert.equal(second.adminNotificationsCreated, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM user_notifications").get() as { c: number }).c,
      2
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM web_push_outbox").get() as { c: number }).c,
      1
    );

    assert.equal(
      notificationHref({
        type: "admin_supply_draft",
        ref_id: 1401,
        actor_id: null,
        comment_target_type: null,
        comment_target_id: null,
      }),
      "/admin/automation-reports"
    );

    db.close();
  });

  it("ignores ordinary PRs and fails closed when GitHub is unavailable", async () => {
    const db = makeDb();
    db.prepare("INSERT INTO users (id,email,is_admin) VALUES (1,'admin@example.com',1)").run();

    const ordinary = await runAdminSupplyDraftNotificationScan(
      db,
      async () =>
        githubPullsResponse([
          {
            number: 1500,
            title: "ordinary PR",
            html_url: "https://github.com/example/repo/pull/1500",
            state: "open",
            draft: true,
            created_at: "2026-09-30T10:00:00Z",
            updated_at: "2026-09-30T10:00:00Z",
            body: "no automation marker",
          },
        ])
    );
    assert.equal(ordinary.status, "OK");
    assert.equal(ordinary.draftsSeen, 0);
    assert.equal(ordinary.adminNotificationsCreated, 0);

    const unavailable = await runAdminSupplyDraftNotificationScan(
      db,
      async () => new Response("rate limited", { status: 503 })
    );
    assert.equal(unavailable.status, "UNAVAILABLE");
    assert.equal(unavailable.adminNotificationsCreated, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM user_notifications").get() as { c: number }).c,
      0
    );

    db.close();
  });
});
