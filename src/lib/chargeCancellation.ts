import type Database from "better-sqlite3";
import { getDb } from "./db";
import { getPointBalance } from "./points";
import { cancelPortOnePayment } from "./portoneServer";

export type PointChargeBatchRow = {
  id: number;
  user_id: number;
  portone_checkout_id: number | null;
  main_point_log_id: number;
  paid_amount: number;
  free_amount: number;
  paid_transaction_id: number;
  free_transaction_id: number | null;
  price_krw: number;
  created_at: string;
  cancelled_at: string | null;
};

const CHARGE_CANCEL_DAYS = 7;

export function ensurePointChargeBatchTable(db: Database.Database = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_charge_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      portone_checkout_id INTEGER,
      main_point_log_id INTEGER NOT NULL,
      paid_amount REAL NOT NULL,
      free_amount REAL NOT NULL DEFAULT 0,
      paid_transaction_id INTEGER NOT NULL,
      free_transaction_id INTEGER,
      price_krw INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cancelled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_charge_batches_user
      ON point_charge_batches(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_charge_batches_log
      ON point_charge_batches(main_point_log_id);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_flags (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const done = db
    .prepare("SELECT 1 AS ok FROM _schema_flags WHERE key='portone_checkouts_cancelled_at'")
    .get() as { ok: number } | undefined;
  if (!done?.ok) {
    try {
      db.exec("ALTER TABLE portone_checkouts ADD COLUMN cancelled_at TEXT");
    } catch {
      /* column may exist */
    }
    db.prepare("INSERT INTO _schema_flags (key) VALUES ('portone_checkouts_cancelled_at')").run();
  }
}

export function recordPointChargeBatch(
  db: Database.Database,
  input: {
    userId: number;
    portoneCheckoutId?: number | null;
    mainPointLogId: number;
    paidAmount: number;
    freeAmount: number;
    paidTransactionId: number;
    freeTransactionId?: number | null;
    priceKrw: number;
    createdAt?: string;
  }
): number {
  ensurePointChargeBatchTable(db);
  const result = db
    .prepare(
      `INSERT INTO point_charge_batches
       (user_id, portone_checkout_id, main_point_log_id, paid_amount, free_amount,
        paid_transaction_id, free_transaction_id, price_krw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    )
    .run(
      input.userId,
      input.portoneCheckoutId ?? null,
      input.mainPointLogId,
      input.paidAmount,
      input.freeAmount,
      input.paidTransactionId,
      input.freeTransactionId ?? null,
      input.priceKrw,
      input.createdAt ?? null
    );
  return Number(result.lastInsertRowid);
}

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

function isChargeLogReason(reason: string): boolean {
  return reason.startsWith("포인트 충전");
}

function parsePriceKrwFromChargeReason(reason: string): number | null {
  const match = reason.match(/\(₩([\d,]+)\)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findTransactionNearLog(
  db: Database.Database,
  userId: number,
  pointType: "PAID" | "FREE",
  createdAt: string,
  expectedAmount?: number
): { id: number; remaining_amount: number } | null {
  const rows = db
    .prepare(
      `SELECT id, remaining_amount FROM point_transactions
       WHERE user_id = ? AND point_type = ?
         AND datetime(created_at) BETWEEN datetime(?, '-2 minutes') AND datetime(?, '+2 minutes')
       ORDER BY id ASC`
    )
    .all(userId, pointType, createdAt, createdAt) as { id: number; remaining_amount: number }[];

  if (rows.length === 0) return null;
  if (expectedAmount != null) {
    const exact = rows.find((row) => Math.abs(row.remaining_amount - expectedAmount) < 0.05);
    if (exact) return exact;
  }
  return rows[0] ?? null;
}

function findBonusLogNearCharge(
  db: Database.Database,
  userId: number,
  mainLogId: number,
  createdAt: string
): { id: number; delta: number; created_at: string } | null {
  return (
    (db
      .prepare(
        `SELECT id, delta, created_at FROM point_logs
         WHERE user_id = ? AND id > ? AND delta > 0 AND reason LIKE '충전 보너스%'
           AND datetime(created_at) BETWEEN datetime(?, '-2 minutes') AND datetime(?, '+2 minutes')
         ORDER BY id ASC
         LIMIT 1`
      )
      .get(userId, mainLogId, createdAt, createdAt) as
      | { id: number; delta: number; created_at: string }
      | undefined) ?? null
  );
}

function findPortoneCheckoutNearCharge(
  db: Database.Database,
  userId: number,
  createdAt: string,
  priceKrw: number
): number | null {
  const row = db
    .prepare(
      `SELECT id FROM portone_checkouts
       WHERE user_id = ? AND status = 'paid' AND amount = ?
         AND datetime(COALESCE(paid_at, created_at)) BETWEEN datetime(?, '-10 minutes') AND datetime(?, '+10 minutes')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(userId, priceKrw, createdAt, createdAt) as { id: number } | undefined;
  return row?.id ?? null;
}

/** batch 누락(구 충전) — point_log·원장에서 복구 */
export function backfillChargeBatchFromLog(
  userId: number,
  pointLogId: number,
  db: Database.Database = getDb()
): PointChargeBatchRow | null {
  ensurePointChargeBatchTable(db);

  const existing = db
    .prepare(
      `SELECT id, user_id, portone_checkout_id, main_point_log_id, paid_amount, free_amount,
              paid_transaction_id, free_transaction_id, price_krw, created_at, cancelled_at
       FROM point_charge_batches
       WHERE user_id = ? AND main_point_log_id = ?`
    )
    .get(userId, pointLogId) as PointChargeBatchRow | undefined;
  if (existing) return existing;

  const log = db
    .prepare(
      `SELECT id, user_id, delta, reason, created_at FROM point_logs WHERE id = ? AND user_id = ?`
    )
    .get(pointLogId, userId) as
    | { id: number; user_id: number; delta: number; reason: string; created_at: string }
    | undefined;
  if (!log || log.delta <= 0 || !isChargeLogReason(log.reason)) return null;

  const paidAmount = roundAmount(log.delta);
  const paidTx = findTransactionNearLog(db, userId, "PAID", log.created_at, paidAmount);
  if (!paidTx) return null;

  const priceKrw = parsePriceKrwFromChargeReason(log.reason) ?? paidAmount;
  const bonusLog = findBonusLogNearCharge(db, userId, log.id, log.created_at);
  const freeAmount = bonusLog ? roundAmount(bonusLog.delta) : 0;
  const freeTx =
    freeAmount > 0
      ? findTransactionNearLog(db, userId, "FREE", bonusLog!.created_at, freeAmount)
      : null;
  const portoneCheckoutId = findPortoneCheckoutNearCharge(db, userId, log.created_at, priceKrw);

  const batchId = recordPointChargeBatch(db, {
    userId,
    portoneCheckoutId,
    mainPointLogId: log.id,
    paidAmount,
    freeAmount,
    paidTransactionId: paidTx.id,
    freeTransactionId: freeTx?.id ?? null,
    priceKrw,
    createdAt: log.created_at,
  });

  return (
    (db
      .prepare(
        `SELECT id, user_id, portone_checkout_id, main_point_log_id, paid_amount, free_amount,
                paid_transaction_id, free_transaction_id, price_krw, created_at, cancelled_at
         FROM point_charge_batches WHERE id = ?`
      )
      .get(batchId) as PointChargeBatchRow | undefined) ?? null
  );
}

/** 결제 시각 기준 168시간(7×24h) 이내만 취소 가능 */
export function isChargeWithinCancelWindow(
  createdAt: string,
  opts?: { db?: Database.Database; now?: string }
): boolean {
  const db = opts?.db ?? getDb();
  const row = opts?.now
    ? (db
        .prepare(
          `SELECT 1 AS ok WHERE datetime(?) >= datetime(?, '-${CHARGE_CANCEL_DAYS} days')`
        )
        .get(createdAt, opts.now) as { ok: number } | undefined)
    : (db
        .prepare(
          `SELECT 1 AS ok WHERE datetime(?) >= datetime('now', '-${CHARGE_CANCEL_DAYS} days')`
        )
        .get(createdAt) as { ok: number } | undefined);
  return !!row?.ok;
}

function resolveChargeBatch(userId: number, pointLogId: number): PointChargeBatchRow | null {
  return getChargeBatchByLogId(userId, pointLogId) ?? backfillChargeBatchFromLog(userId, pointLogId);
}

function txUnused(
  db: Database.Database,
  transactionId: number,
  expectedAmount: number
): boolean {
  const row = db
    .prepare("SELECT remaining_amount FROM point_transactions WHERE id = ?")
    .get(transactionId) as { remaining_amount: number } | undefined;
  if (!row) return false;
  return Math.abs(row.remaining_amount - expectedAmount) < 0.05;
}

export function getChargeBatchByLogId(
  userId: number,
  pointLogId: number
): PointChargeBatchRow | null {
  const db = getDb();
  ensurePointChargeBatchTable(db);
  return (
    (db
      .prepare(
        `SELECT id, user_id, portone_checkout_id, main_point_log_id, paid_amount, free_amount,
                paid_transaction_id, free_transaction_id, price_krw, created_at, cancelled_at
         FROM point_charge_batches
         WHERE user_id = ? AND main_point_log_id = ?`
      )
      .get(userId, pointLogId) as PointChargeBatchRow | undefined) ?? null
  );
}

export function canCancelChargeBatch(batch: PointChargeBatchRow): {
  ok: boolean;
  reason?: string;
} {
  if (batch.cancelled_at) {
    return { ok: false, reason: "이미 취소된 결제입니다." };
  }

  const db = getDb();
  if (!isChargeWithinCancelWindow(batch.created_at)) {
    return { ok: false, reason: `결제 후 ${CHARGE_CANCEL_DAYS}일이 지나 취소할 수 없습니다.` };
  }

  if (!txUnused(db, batch.paid_transaction_id, batch.paid_amount)) {
    return { ok: false, reason: "충전된 유료 포인트를 일부 사용하여 취소할 수 없습니다." };
  }

  if (batch.free_amount > 0 && batch.free_transaction_id) {
    if (!txUnused(db, batch.free_transaction_id, batch.free_amount)) {
      return { ok: false, reason: "충전된 무료 포인트를 일부 사용하여 취소할 수 없습니다." };
    }
  }

  return { ok: true };
}

export type ChargeCancelEnrichment = {
  charge_batch_id: number | null;
  can_cancel_charge: boolean;
  charge_cancelled: boolean;
  charge_cancel_block_reason?: string;
};

export function enrichChargeCancelForLog(
  userId: number,
  log: { id?: number; delta: number; reason: string }
): ChargeCancelEnrichment {
  const empty: ChargeCancelEnrichment = {
    charge_batch_id: null,
    can_cancel_charge: false,
    charge_cancelled: false,
  };
  if (log.delta <= 0 || !log.id || !isChargeLogReason(log.reason)) return empty;

  const batch = resolveChargeBatch(userId, log.id);
  if (!batch) {
    return {
      ...empty,
      charge_cancel_block_reason: "취소 가능한 결제 정보를 찾을 수 없습니다.",
    };
  }

  if (batch.cancelled_at) {
    return {
      charge_batch_id: batch.id,
      can_cancel_charge: false,
      charge_cancelled: true,
    };
  }

  const check = canCancelChargeBatch(batch);
  return {
    charge_batch_id: batch.id,
    can_cancel_charge: check.ok,
    charge_cancelled: false,
    charge_cancel_block_reason: check.reason,
  };
}

export function cancelPointChargeBatch(
  userId: number,
  pointLogId: number
): { ok: true; balance: ReturnType<typeof getPointBalance> } | { ok: false; error: string } {
  const db = getDb();
  ensurePointChargeBatchTable(db);

  const batch = resolveChargeBatch(userId, pointLogId);
  if (!batch) return { ok: false, error: "취소할 결제 내역을 찾을 수 없습니다." };

  const check = canCancelChargeBatch(batch);
  if (!check.ok) return { ok: false, error: check.reason ?? "결제를 취소할 수 없습니다." };

  let portonePaymentId: string | null = null;
  if (batch.portone_checkout_id) {
    const checkout = db
      .prepare(
        "SELECT payment_id, cancelled_at FROM portone_checkouts WHERE id = ? AND user_id = ?"
      )
      .get(batch.portone_checkout_id, userId) as
      | { payment_id: string; cancelled_at: string | null }
      | undefined;
    if (checkout?.cancelled_at) {
      return { ok: false, error: "이미 취소된 결제입니다." };
    }
    portonePaymentId = checkout?.payment_id ?? null;
  }

  const totalPoints = roundAmount(batch.paid_amount + batch.free_amount);

  db.transaction(() => {
    db.prepare("UPDATE point_transactions SET remaining_amount = 0 WHERE id = ?").run(
      batch.paid_transaction_id
    );
    if (batch.free_transaction_id) {
      db.prepare("UPDATE point_transactions SET remaining_amount = 0 WHERE id = ?").run(
        batch.free_transaction_id
      );
    }

    db.prepare(
      "UPDATE point_charge_batches SET cancelled_at = datetime('now') WHERE id = ? AND cancelled_at IS NULL"
    ).run(batch.id);

    if (batch.portone_checkout_id) {
      db.prepare(
        "UPDATE portone_checkouts SET cancelled_at = datetime('now') WHERE id = ? AND cancelled_at IS NULL"
      ).run(batch.portone_checkout_id);
    }

    const priceLabel =
      batch.price_krw > 0
        ? `₩${batch.price_krw.toLocaleString()}`
        : batch.paid_amount.toLocaleString() + "P";
    db.prepare("INSERT INTO point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      userId,
      -totalPoints,
      `결제 취소 (${priceLabel})`
    );

    db.prepare(
      "UPDATE users SET points = (SELECT COALESCE(SUM(remaining_amount), 0) FROM point_transactions WHERE user_id = ? AND remaining_amount > 0 AND expires_at > datetime('now')) WHERE id = ?"
    ).run(userId, userId);
  })();

  if (portonePaymentId) {
    void cancelPortOnePayment(portonePaymentId, batch.price_krw).catch(() => {
      /* 포인트는 이미 회수 — PG 취소 실패는 로그만 */
    });
  }

  return { ok: true, balance: getPointBalance(userId) };
}
