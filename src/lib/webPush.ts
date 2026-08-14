import "server-only";

import type Database from "better-sqlite3";
import { after } from "next/server";
import webpush from "web-push";
import { getDb } from "@/lib/db";

export type WebPushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind: "notice" | "event" | "points" | "point_expiry" | "character_review" | "support_result";
};

type StoredSubscription = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type OutboxRow = StoredSubscription & {
  outbox_id: number;
  attempts: number;
  payload_json: string;
};

let deliveryTimer: ReturnType<typeof setTimeout> | null = null;
let deliveryInterval: ReturnType<typeof setInterval> | null = null;
let expiryInterval: ReturnType<typeof setInterval> | null = null;
let deliveryRunning = false;
let vapidFingerprint = "";

function envConfig() {
  return {
    publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "",
    privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "",
    subject: process.env.WEB_PUSH_SUBJECT?.trim() ?? "",
  };
}

export function getWebPushPublicConfig(): { enabled: boolean; publicKey: string } {
  const config = envConfig();
  return {
    enabled: Boolean(config.publicKey && config.privateKey && config.subject),
    publicKey: config.publicKey,
  };
}

function configureVapid(): boolean {
  const config = envConfig();
  if (!config.publicKey || !config.privateKey || !config.subject) return false;
  const fingerprint = `${config.subject}:${config.publicKey}:${config.privateKey.slice(0, 8)}`;
  if (fingerprint !== vapidFingerprint) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidFingerprint = fingerprint;
  }
  return true;
}

export function saveWebPushSubscription(
  db: Database.Database,
  userId: number,
  input: { endpoint: string; p256dh: string; auth: string }
): void {
  db.prepare(
    `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id=excluded.user_id,
       p256dh=excluded.p256dh,
       auth=excluded.auth,
       updated_at=datetime('now')`
  ).run(userId, input.endpoint, input.p256dh, input.auth);
}

export function removeWebPushSubscription(
  db: Database.Database,
  userId: number,
  endpoint: string
): boolean {
  const row = db
    .prepare("SELECT id FROM web_push_subscriptions WHERE user_id=? AND endpoint=?")
    .get(userId, endpoint) as { id: number } | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM web_push_outbox WHERE subscription_id=?").run(row.id);
  db.prepare("DELETE FROM web_push_subscriptions WHERE id=?").run(row.id);
  return true;
}

export function hasWebPushSubscription(
  db: Database.Database,
  userId: number,
  endpoint?: string
): boolean {
  const row = endpoint
    ? db
        .prepare("SELECT 1 AS ok FROM web_push_subscriptions WHERE user_id=? AND endpoint=?")
        .get(userId, endpoint)
    : db.prepare("SELECT 1 AS ok FROM web_push_subscriptions WHERE user_id=? LIMIT 1").get(userId);
  return row != null;
}

function insertUserEvent(
  db: Database.Database,
  userId: number,
  eventKey: string
): boolean {
  const result = db
    .prepare("INSERT OR IGNORE INTO web_push_user_events (user_id, event_key) VALUES (?, ?)")
    .run(userId, eventKey);
  return result.changes > 0;
}

export function queueUserWebPush(
  db: Database.Database,
  userId: number,
  eventKey: string,
  payload: WebPushPayload
): boolean {
  if (!getWebPushPublicConfig().enabled) return false;
  if (!insertUserEvent(db, userId, eventKey)) return false;

  db.prepare(
    `INSERT OR IGNORE INTO web_push_outbox
       (subscription_id, user_id, event_key, payload_json)
     SELECT id, user_id, ?, ?
       FROM web_push_subscriptions
      WHERE user_id=?`
  ).run(eventKey, JSON.stringify(payload), userId);
  scheduleWebPushDelivery();
  return true;
}

export function queueBroadcastWebPush(
  db: Database.Database,
  eventKey: string,
  payload: WebPushPayload
): number {
  if (!getWebPushPublicConfig().enabled) return 0;
  const users = db
    .prepare("SELECT DISTINCT user_id FROM web_push_subscriptions")
    .all() as { user_id: number }[];
  let queued = 0;
  for (const row of users) {
    if (queueUserWebPush(db, row.user_id, eventKey, payload)) queued += 1;
  }
  return queued;
}

function retryDelayMinutes(attempts: number): number {
  return Math.min(60, Math.max(1, 2 ** attempts));
}

function errorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const code = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isFinite(code) ? code : null;
}

export async function flushWebPushOutbox(): Promise<void> {
  if (deliveryRunning || !configureVapid()) return;
  deliveryRunning = true;
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT o.id AS outbox_id, o.attempts, o.payload_json,
                s.id, s.endpoint, s.p256dh, s.auth
           FROM web_push_outbox o
           JOIN web_push_subscriptions s ON s.id=o.subscription_id
          WHERE o.sent_at IS NULL
            AND o.attempts < 5
            AND o.available_at <= datetime('now')
          ORDER BY o.id ASC
          LIMIT 50`
      )
      .all() as OutboxRow[];

    for (const row of rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          row.payload_json,
          { TTL: 24 * 60 * 60, urgency: "normal" }
        );
        db.prepare("UPDATE web_push_outbox SET sent_at=datetime('now'), last_error='' WHERE id=?").run(
          row.outbox_id
        );
      } catch (error) {
        const statusCode = errorStatusCode(error);
        if (statusCode === 404 || statusCode === 410) {
          db.transaction(() => {
            db.prepare("DELETE FROM web_push_outbox WHERE subscription_id=?").run(row.id);
            db.prepare("DELETE FROM web_push_subscriptions WHERE id=?").run(row.id);
          })();
          continue;
        }
        const nextAttempts = row.attempts + 1;
        const message = error instanceof Error ? error.message.slice(0, 300) : "push delivery failed";
        db.prepare(
          `UPDATE web_push_outbox
              SET attempts=?, last_error=?, available_at=datetime('now', ?)
            WHERE id=?`
        ).run(nextAttempts, message, `+${retryDelayMinutes(nextAttempts)} minutes`, row.outbox_id);
      }
    }
  } finally {
    deliveryRunning = false;
  }
}

export function scheduleWebPushDelivery(): void {
  if (process.env.DISABLE_WEB_PUSH_DELIVERY === "1") return;
  try {
    // Vercel may freeze a serverless invocation as soon as its response ends.
    // `after` keeps this delivery work attached to the active request lifecycle.
    after(() => flushWebPushOutbox());
    return;
  } catch {
    // Custom Node server and tests do not always have a Next request scope.
  }
  if (deliveryTimer) return;
  deliveryTimer = setTimeout(() => {
    deliveryTimer = null;
    void flushWebPushOutbox();
  }, 100);
  deliveryTimer.unref?.();
}

export function queueExpiringPointPushes(db: Database.Database): number {
  if (!getWebPushPublicConfig().enabled) return 0;
  const rows = db
    .prepare(
      `SELECT pt.user_id,
              ROUND(SUM(pt.remaining_amount), 1) AS total,
              MIN(pt.expires_at) AS nearest_expires_at
         FROM point_transactions pt
        WHERE pt.remaining_amount > 0
          AND pt.expires_at > datetime('now')
          AND pt.expires_at <= datetime('now', '+3 days')
          AND EXISTS (
            SELECT 1 FROM web_push_subscriptions s WHERE s.user_id=pt.user_id
          )
        GROUP BY pt.user_id`
    )
    .all() as { user_id: number; total: number; nearest_expires_at: string }[];

  let queued = 0;
  for (const row of rows) {
    const eventKey = `point-expiry:${row.nearest_expires_at}`;
    const body = `3일 이내 ${Number(row.total).toLocaleString()}P가 소멸될 예정입니다.`;
    if (
      queueUserWebPush(db, row.user_id, eventKey, {
        title: "포인트 소멸 예정",
        body,
        url: "/points",
        tag: eventKey,
        kind: "point_expiry",
      })
    ) {
      db.prepare(
        `INSERT INTO user_notifications (user_id, type, ref_id, title, body)
         VALUES (?, 'point_expiring', 0, '포인트 소멸 예정', ?)`
      ).run(row.user_id, body);
      queued += 1;
    }
  }
  return queued;
}

export function startWebPushSchedulers(): void {
  if (!getWebPushPublicConfig().enabled) {
    console.warn("[web-push] disabled: WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_SUBJECT are required");
    return;
  }
  scheduleWebPushDelivery();
  queueExpiringPointPushes(getDb());

  if (!deliveryInterval) {
    deliveryInterval = setInterval(() => void flushWebPushOutbox(), 60 * 1000);
    deliveryInterval.unref?.();
  }
  if (!expiryInterval) {
    expiryInterval = setInterval(() => queueExpiringPointPushes(getDb()), 6 * 60 * 60 * 1000);
    expiryInterval.unref?.();
  }
}
