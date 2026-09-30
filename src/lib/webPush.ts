import "server-only";

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { after } from "next/server";
import webpush from "web-push";
import { ensureWebPushOutboxClaimColumns, getDb } from "@/lib/db";
import { resolveWebPushVapidConfig } from "@/lib/webPushVapid";

export type WebPushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind:
    | "notice"
    | "event"
    | "points"
    | "point_expiry"
    | "character_review"
    | "support_result"
    | "character_like"
    | "comment";
};

type StoredSubscription = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type WebPushOutboxRow = StoredSubscription & {
  outbox_id: number;
  attempts: number;
  payload_json: string;
  claim_token: string;
};

export type WebPushSendNotification = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options?: { TTL?: number; urgency?: string; timeout?: number }
) => Promise<unknown>;

/**
 * Process-local wake coalescing only.
 * `deliveryRunning` is not the delivery correctness owner.
 */
export type WebPushProcessWake = { running: boolean };

export type WebPushFlushOptions = {
  db?: Database.Database;
  sendNotification?: WebPushSendNotification;
  processWake?: WebPushProcessWake;
  claimToken?: string;
  nowSql?: string;
};

/** One sequential provider send. web-push has no default HTTP timeout. */
export const WEB_PUSH_SEND_TIMEOUT_MS = 15_000;
/**
 * Covers one send + timeout + local write.
 * Flush claims per row so a 50-row batch does not hold the last lease for 49 prior sends.
 */
export const WEB_PUSH_CLAIM_LEASE_SECONDS = 30;
export const WEB_PUSH_MAX_ATTEMPTS = 5;
export const WEB_PUSH_FLUSH_BATCH = 50;

const DUE_OUTBOX_WHERE = `
  o.sent_at IS NULL
  AND o.attempts < ${WEB_PUSH_MAX_ATTEMPTS}
  AND o.available_at <= datetime(?)
`;

let deliveryTimer: ReturnType<typeof setTimeout> | null = null;
let deliveryInterval: ReturnType<typeof setInterval> | null = null;
let expiryInterval: ReturnType<typeof setInterval> | null = null;
/** Process-local wake coalescing. Not the delivery correctness owner. */
const processDeliveryWake: WebPushProcessWake = { running: false };
let vapidFingerprint = "";

function nowSql(opts?: { nowSql?: string }): string {
  return opts?.nowSql ?? "now";
}

export function getWebPushPublicConfig(db?: Database.Database): {
  enabled: boolean;
  publicKey: string;
} {
  const config = resolveWebPushVapidConfig(db);
  return {
    enabled: Boolean(config),
    publicKey: config?.publicKey ?? "",
  };
}

function configureVapid(db?: Database.Database): boolean {
  const config = resolveWebPushVapidConfig(db);
  if (!config) return false;
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
  if (!getWebPushPublicConfig(db).enabled) return false;
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
  if (!getWebPushPublicConfig(db).enabled) return 0;
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

/**
 * Due rows visible to every reader. This is not exclusive ownership.
 * Proves the pre-claim concurrency gap: two workers can SELECT the same ids.
 */
export function listDueWebPushOutboxIds(
  db: Database.Database,
  opts?: { nowSql?: string; limit?: number }
): number[] {
  ensureWebPushOutboxClaimColumns(db);
  const limit = Math.max(1, Math.min(WEB_PUSH_FLUSH_BATCH, Math.trunc(opts?.limit ?? WEB_PUSH_FLUSH_BATCH)));
  const rows = db
    .prepare(
      `SELECT o.id AS id
         FROM web_push_outbox o
         JOIN web_push_subscriptions s ON s.id=o.subscription_id
        WHERE ${DUE_OUTBOX_WHERE}
        ORDER BY o.id ASC
        LIMIT ?`
    )
    .all(nowSql(opts), limit) as { id: number }[];
  return rows.map((row) => row.id);
}

function loadClaimedRows(
  db: Database.Database,
  ids: number[],
  token: string
): WebPushOutboxRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT o.id AS outbox_id, o.attempts, o.payload_json, o.claim_token,
              s.id, s.endpoint, s.p256dh, s.auth
         FROM web_push_outbox o
         JOIN web_push_subscriptions s ON s.id=o.subscription_id
        WHERE o.id IN (${placeholders})
          AND o.claim_token=?
          AND o.sent_at IS NULL`
    )
    .all(...ids, token) as WebPushOutboxRow[];
}

/**
 * Atomic per-row (or small-batch) claim. BEGIN IMMEDIATE + conditional UPDATE.
 * Two workers cannot both receive the same row.
 */
export function claimDueWebPushOutboxRows(
  db: Database.Database,
  input: { token: string; limit?: number; leaseSeconds?: number; nowSql?: string }
): WebPushOutboxRow[] {
  ensureWebPushOutboxClaimColumns(db);
  const token = input.token;
  const limit = Math.max(1, Math.min(WEB_PUSH_FLUSH_BATCH, Math.trunc(input.limit ?? 1)));
  const leaseSeconds = input.leaseSeconds ?? WEB_PUSH_CLAIM_LEASE_SECONDS;
  const clock = nowSql(input);

  return db
    .transaction(() => {
      const candidates = db
        .prepare(
          `SELECT o.id AS id
             FROM web_push_outbox o
             JOIN web_push_subscriptions s ON s.id=o.subscription_id
            WHERE ${DUE_OUTBOX_WHERE}
              AND (o.claimed_until IS NULL OR o.claimed_until <= datetime(?))
            ORDER BY o.id ASC
            LIMIT ?`
        )
        .all(clock, clock, limit) as { id: number }[];

      const update = db.prepare(
        `UPDATE web_push_outbox
            SET claim_token=?, claimed_until=datetime(?, ?)
          WHERE id=?
            AND sent_at IS NULL
            AND attempts < ${WEB_PUSH_MAX_ATTEMPTS}
            AND available_at <= datetime(?)
            AND (claimed_until IS NULL OR claimed_until <= datetime(?))`
      );
      const claimed: number[] = [];
      for (const row of candidates) {
        const result = update.run(
          token,
          clock,
          `+${leaseSeconds} seconds`,
          row.id,
          clock,
          clock
        );
        if (result.changes === 1) claimed.push(row.id);
      }
      return loadClaimedRows(db, claimed, token);
    })
    .immediate();
}

export function markWebPushOutboxSent(
  db: Database.Database,
  input: { outboxId: number; token: string }
): boolean {
  const result = db
    .prepare(
      `UPDATE web_push_outbox
          SET sent_at=datetime('now'), last_error=''
        WHERE id=?
          AND claim_token=?
          AND sent_at IS NULL`
    )
    .run(input.outboxId, input.token);
  return result.changes === 1;
}

export function recordWebPushOutboxFailure(
  db: Database.Database,
  input: { outboxId: number; token: string; attempts: number; error: string }
): boolean {
  const nextAttempts = input.attempts + 1;
  const result = db
    .prepare(
      `UPDATE web_push_outbox
          SET attempts=?,
              last_error=?,
              available_at=datetime('now', ?),
              claim_token=NULL,
              claimed_until=NULL
        WHERE id=?
          AND claim_token=?
          AND sent_at IS NULL`
    )
    .run(
      nextAttempts,
      input.error,
      `+${retryDelayMinutes(nextAttempts)} minutes`,
      input.outboxId,
      input.token
    );
  return result.changes === 1;
}

export function deleteInvalidWebPushSubscription(
  db: Database.Database,
  subscriptionId: number
): boolean {
  return db.transaction(() => {
    db.prepare("DELETE FROM web_push_outbox WHERE subscription_id=?").run(subscriptionId);
    const removed = db.prepare("DELETE FROM web_push_subscriptions WHERE id=?").run(subscriptionId);
    return removed.changes > 0;
  })();
}

export async function flushWebPushOutbox(opts?: WebPushFlushOptions): Promise<void> {
  const wake = opts?.processWake ?? processDeliveryWake;
  if (wake.running) return;
  const send = opts?.sendNotification ?? webpush.sendNotification.bind(webpush);
  if (!opts?.sendNotification && !configureVapid(opts?.db)) return;
  wake.running = true;
  try {
    const db = opts?.db ?? getDb();
    ensureWebPushOutboxClaimColumns(db);
    const clock = nowSql(opts);

    for (let n = 0; n < WEB_PUSH_FLUSH_BATCH; n += 1) {
      const token = opts?.claimToken ?? randomUUID();
      const [row] = claimDueWebPushOutboxRows(db, { token, limit: 1, nowSql: clock });
      if (!row) break;

      try {
        await send(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          row.payload_json,
          { TTL: 24 * 60 * 60, urgency: "normal", timeout: WEB_PUSH_SEND_TIMEOUT_MS }
        );
        markWebPushOutboxSent(db, { outboxId: row.outbox_id, token: row.claim_token });
      } catch (error) {
        const statusCode = errorStatusCode(error);
        if (statusCode === 404 || statusCode === 410) {
          deleteInvalidWebPushSubscription(db, row.id);
          continue;
        }
        const message = error instanceof Error ? error.message.slice(0, 300) : "push delivery failed";
        recordWebPushOutboxFailure(db, {
          outboxId: row.outbox_id,
          token: row.claim_token,
          attempts: row.attempts,
          error: message,
        });
      }
    }
  } finally {
    wake.running = false;
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
  const rows = db
    .prepare(
      `SELECT pt.user_id,
              ROUND(SUM(pt.remaining_amount), 1) AS total,
              MIN(pt.expires_at) AS nearest_expires_at
         FROM point_transactions pt
        WHERE pt.remaining_amount > 0
          AND pt.expires_at > datetime('now')
          AND pt.expires_at <= datetime('now', '+3 days')
        GROUP BY pt.user_id`
    )
    .all() as { user_id: number; total: number; nearest_expires_at: string }[];

  let queued = 0;
  for (const row of rows) {
    const eventKey = `point-expiry:${row.nearest_expires_at}`;
    const body = `3일 이내 ${Number(row.total).toLocaleString()}P가 소멸될 예정입니다.`;
    const already = db
      .prepare(
        `SELECT 1 AS ok FROM user_notifications
          WHERE user_id=? AND type='point_expiring' AND body=?`
      )
      .get(row.user_id, body) as { ok: number } | undefined;
    if (already) continue;
    db.prepare(
      `INSERT INTO user_notifications (user_id, type, ref_id, title, body)
       VALUES (?, 'point_expiring', 0, '포인트 소멸 예정', ?)`
    ).run(row.user_id, body);
    queueUserWebPush(db, row.user_id, eventKey, {
      title: "포인트 소멸 예정",
      body,
      url: "/points",
      tag: eventKey,
      kind: "point_expiry",
    });
    queued += 1;
  }
  return queued;
}

export function startWebPushSchedulers(): void {
  const config = resolveWebPushVapidConfig();
  if (!config) {
    console.warn("[web-push] disabled: set DISABLE_WEB_PUSH=1 to turn off, or check app_meta VAPID provisioning");
    return;
  }
  console.info(`[web-push] enabled (source=${config.source})`);
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
