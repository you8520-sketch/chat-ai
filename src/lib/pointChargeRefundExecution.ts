import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  canCancelChargeBatch,
  resolveChargeBatchForUser,
  type PointChargeBatchRow,
} from "@/lib/chargeCancellation";
import { getPointBalanceOnDb, type PointBalance } from "@/lib/points";
import {
  ensurePointChargeRefundAttemptsSchema,
  getPointChargeRefundAttempt,
  insertRefundAttempt,
  markRefundAttemptDispatched,
  recordRefundAttemptState,
  type PointChargeRefundAttemptRow,
} from "@/lib/pointChargeRefundAttempts";
import { getPointChargeRefundProviderPort } from "@/lib/pointChargeRefundGateway";
import type { PointChargeRefundLookupResult } from "@/lib/pointChargeRefundProviderTypes";

export type PointChargeRefundExecutionResult =
  | { ok: true; status: "refunded"; balance: PointBalance }
  | { ok: true; status: "pending"; balance: PointBalance; message: string }
  | { ok: true; status: "reconciliation_required"; balance: PointBalance; message: string }
  | { ok: true; status: "skipped"; balance: PointBalance; message: string }
  | { ok: false; status: "failed"; balance: PointBalance; error: string };

type CheckoutRefundIdentity = {
  id: number;
  payment_id: string;
  status: string;
  amount: number;
  cancelled_at: string | null;
};

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

function syncUserPoints(db: Database.Database, userId: number): void {
  db.prepare(
    `UPDATE users
     SET points = (
       SELECT COALESCE(SUM(remaining_amount), 0)
       FROM point_transactions
       WHERE user_id = ?
         AND remaining_amount > 0
         AND expires_at > datetime('now')
     )
     WHERE id = ?`
  ).run(userId, userId);
}

function readTransactionAmount(
  db: Database.Database,
  transactionId: number
): number | null {
  const row = db
    .prepare("SELECT remaining_amount FROM point_transactions WHERE id=?")
    .get(transactionId) as { remaining_amount: number } | undefined;
  return row ? roundAmount(row.remaining_amount) : null;
}

function ensureAmountIs(
  actual: number | null,
  allowed: number[],
  label: string
): void {
  if (actual == null || !allowed.some((value) => Math.abs(actual - value) < 0.05)) {
    throw new Error(`REFUND_HOLD_CONFLICT:${label}:${String(actual)}`);
  }
}

function getCheckoutIdentity(
  db: Database.Database,
  batch: PointChargeBatchRow
): CheckoutRefundIdentity | null {
  if (!batch.portone_checkout_id) return null;
  return (
    (db
      .prepare(
        `SELECT id, payment_id, status, amount, cancelled_at
         FROM portone_checkouts
         WHERE id=? AND user_id=?`
      )
      .get(batch.portone_checkout_id, batch.user_id) as CheckoutRefundIdentity | undefined) ?? null
  );
}

function claimRefundAndHold(
  db: Database.Database,
  batch: PointChargeBatchRow,
  checkout: CheckoutRefundIdentity
): { claimed: boolean } {
  ensurePointChargeRefundAttemptsSchema(db);

  return db.transaction(() => {
    const existing = getPointChargeRefundAttempt(db, batch.id);
    if (existing) return { claimed: false };

    const eligibility = canCancelChargeBatch(batch, db);
    if (!eligibility.ok) {
      throw new Error(eligibility.reason ?? "결제를 취소할 수 없습니다.");
    }
    if (checkout.cancelled_at) {
      throw new Error("이미 취소된 결제입니다.");
    }
    if (checkout.status !== "paid") {
      throw new Error(`취소할 수 없는 결제 상태입니다. (${checkout.status})`);
    }
    if (checkout.amount !== batch.price_krw) {
      throw new Error("결제 금액과 충전 배치 금액이 일치하지 않습니다.");
    }

    const inserted = insertRefundAttempt(db, {
      chargeBatchId: batch.id,
      portoneCheckoutId: checkout.id,
      paymentId: checkout.payment_id,
    });
    if (!inserted) return { claimed: false };

    const paidBefore = readTransactionAmount(db, batch.paid_transaction_id);
    ensureAmountIs(paidBefore, [roundAmount(batch.paid_amount)], "paid-before-hold");
    db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(
      batch.paid_transaction_id
    );

    if (batch.free_amount > 0) {
      if (!batch.free_transaction_id) {
        throw new Error("REFUND_HOLD_CONFLICT:missing-free-transaction");
      }
      const freeBefore = readTransactionAmount(db, batch.free_transaction_id);
      ensureAmountIs(freeBefore, [roundAmount(batch.free_amount)], "free-before-hold");
      db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(
        batch.free_transaction_id
      );
    }

    syncUserPoints(db, batch.user_id);
    return { claimed: true };
  })();
}

function restoreRefundHoldAfterFailure(
  db: Database.Database,
  batch: PointChargeBatchRow
): void {
  db.transaction(() => {
    const freshBatch = resolveChargeBatchForUser(batch.user_id, batch.main_point_log_id, db);
    if (!freshBatch || freshBatch.cancelled_at) return;

    const paidNow = readTransactionAmount(db, batch.paid_transaction_id);
    ensureAmountIs(paidNow, [0, roundAmount(batch.paid_amount)], "paid-restore");
    if (paidNow != null && Math.abs(paidNow) < 0.05) {
      db.prepare("UPDATE point_transactions SET remaining_amount=? WHERE id=?").run(
        roundAmount(batch.paid_amount),
        batch.paid_transaction_id
      );
    }

    if (batch.free_amount > 0 && batch.free_transaction_id) {
      const freeNow = readTransactionAmount(db, batch.free_transaction_id);
      ensureAmountIs(freeNow, [0, roundAmount(batch.free_amount)], "free-restore");
      if (freeNow != null && Math.abs(freeNow) < 0.05) {
        db.prepare("UPDATE point_transactions SET remaining_amount=? WHERE id=?").run(
          roundAmount(batch.free_amount),
          batch.free_transaction_id
        );
      }
    }

    syncUserPoints(db, batch.user_id);
  })();
}

function finalizeRefundSuccess(
  db: Database.Database,
  batch: PointChargeBatchRow
): PointBalance {
  return db.transaction(() => {
    const freshBatch = resolveChargeBatchForUser(batch.user_id, batch.main_point_log_id, db);
    if (!freshBatch) throw new Error("취소할 결제 배치를 찾을 수 없습니다.");
    if (freshBatch.cancelled_at) return getPointBalanceOnDb(db, batch.user_id);

    const attempt = getPointChargeRefundAttempt(db, batch.id);
    if (attempt?.state !== "SUCCEEDED") {
      throw new Error("PortOne 환불 성공 확인 없이 로컬 취소를 확정할 수 없습니다.");
    }

    const paidNow = readTransactionAmount(db, batch.paid_transaction_id);
    ensureAmountIs(paidNow, [0], "paid-finalize");
    if (batch.free_amount > 0 && batch.free_transaction_id) {
      const freeNow = readTransactionAmount(db, batch.free_transaction_id);
      ensureAmountIs(freeNow, [0], "free-finalize");
    }

    const updated = db
      .prepare(
        "UPDATE point_charge_batches SET cancelled_at=datetime('now') WHERE id=? AND cancelled_at IS NULL"
      )
      .run(batch.id);
    if (Number(updated.changes) === 0) {
      return getPointBalanceOnDb(db, batch.user_id);
    }

    if (batch.portone_checkout_id) {
      db.prepare(
        "UPDATE portone_checkouts SET cancelled_at=datetime('now') WHERE id=? AND cancelled_at IS NULL"
      ).run(batch.portone_checkout_id);
    }

    const totalPoints = roundAmount(batch.paid_amount + batch.free_amount);
    const priceLabel =
      batch.price_krw > 0
        ? `₩${batch.price_krw.toLocaleString()}`
        : `${batch.paid_amount.toLocaleString()}P`;
    db.prepare("INSERT INTO point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      batch.user_id,
      -totalPoints,
      `결제 취소 (${priceLabel})`
    );

    syncUserPoints(db, batch.user_id);
    return getPointBalanceOnDb(db, batch.user_id);
  })();
}

function failedResult(
  db: Database.Database,
  batch: PointChargeBatchRow,
  message: string
): PointChargeRefundExecutionResult {
  restoreRefundHoldAfterFailure(db, batch);
  return {
    ok: false,
    status: "failed",
    balance: getPointBalanceOnDb(db, batch.user_id),
    error: message,
  };
}

async function reconcileRefund(
  db: Database.Database,
  batch: PointChargeBatchRow,
  attempt: PointChargeRefundAttemptRow
): Promise<PointChargeRefundExecutionResult> {
  const lookup = await getPointChargeRefundProviderPort().lookup(
    attempt.payment_id,
    attempt.provider_cancellation_id || undefined
  );

  switch (lookup.status) {
    case "success": {
      recordRefundAttemptState(db, {
        chargeBatchId: batch.id,
        state: "SUCCEEDED",
        providerCancellationId: lookup.cancellationId,
        providerStatus: lookup.providerStatus,
      });
      return {
        ok: true,
        status: "refunded",
        balance: finalizeRefundSuccess(db, batch),
      };
    }
    case "pending": {
      recordRefundAttemptState(db, {
        chargeBatchId: batch.id,
        state: "REQUESTED",
        providerCancellationId: lookup.cancellationId,
        providerStatus: lookup.providerStatus,
      });
      return {
        ok: true,
        status: "pending",
        balance: getPointBalanceOnDb(db, batch.user_id),
        message: "PortOne 환불 처리가 진행 중입니다. 충전 포인트는 확인 완료까지 사용이 보류됩니다.",
      };
    }
    case "failed": {
      recordRefundAttemptState(db, {
        chargeBatchId: batch.id,
        state: "FAILED",
        providerCancellationId: lookup.cancellationId,
        providerStatus: lookup.providerStatus,
        failureCode: lookup.code,
        failureMessage: lookup.message,
      });
      return failedResult(db, batch, lookup.message);
    }
    case "not_found":
    case "unknown": {
      recordRefundAttemptState(db, {
        chargeBatchId: batch.id,
        state: "RECONCILIATION_REQUIRED",
        failureCode: lookup.status === "not_found" ? "PORTONE_LOOKUP_NOT_FOUND" : "PORTONE_LOOKUP_UNKNOWN",
        failureMessage: "PortOne 취소 결과를 확정할 수 없습니다.",
      });
      return {
        ok: true,
        status: "reconciliation_required",
        balance: getPointBalanceOnDb(db, batch.user_id),
        message:
          "환불 결과 확인이 필요합니다. 중복 환불을 막기 위해 재취소는 보내지 않고 상태 조회만 수행합니다.",
      };
    }
    default: {
      const _exhaustive: never = lookup;
      return _exhaustive;
    }
  }
}

async function dispatchRefund(
  db: Database.Database,
  batch: PointChargeBatchRow,
  attempt: PointChargeRefundAttemptRow
): Promise<PointChargeRefundExecutionResult> {
  if (!markRefundAttemptDispatched(db, batch.id)) {
    return {
      ok: true,
      status: "skipped",
      balance: getPointBalanceOnDb(db, batch.user_id),
      message: "다른 요청이 환불 처리를 진행 중입니다.",
    };
  }

  const result = await getPointChargeRefundProviderPort().cancel({
    paymentId: attempt.payment_id,
    amount: batch.price_krw,
    currentCancellableAmount: batch.price_krw,
  });

  switch (result.resultClass) {
    case "success": {
      recordRefundAttemptState(db, {
        chargeBatchId: batch.id,
        state: "SUCCEEDED",
        providerCancellationId: result.cancellationId,
        providerStatus: result.providerStatus,
      });
      return {
        ok: true,
        status: "refunded",
        balance: finalizeRefundSuccess(db, batch),
      };
    }
    case "pending": {
      recordRefundAttemptState(db, {
        chargeBatchId: batch.id,
        state: "REQUESTED",
        providerCancellationId: result.cancellationId,
        providerStatus: result.providerStatus,
      });
      return {
        ok: true,
        status: "pending",
        balance: getPointBalanceOnDb(db, batch.user_id),
        message: "PortOne 환불 요청이 접수되었습니다. 완료 확인 전까지 충전 포인트는 사용이 보류됩니다.",
      };
    }
    case "failed": {
      recordRefundAttemptState(db, {
        chargeBatchId: batch.id,
        state: "FAILED",
        providerCancellationId: result.cancellationId,
        providerStatus: result.providerStatus,
        failureCode: result.code,
        failureMessage: result.message,
      });
      return failedResult(db, batch, result.message);
    }
    case "unknown": {
      recordRefundAttemptState(db, {
        chargeBatchId: batch.id,
        state: "RECONCILIATION_REQUIRED",
        failureCode: result.code,
        failureMessage: result.message,
      });
      const refreshed = getPointChargeRefundAttempt(db, batch.id);
      if (!refreshed) throw new Error("환불 실행 상태를 찾을 수 없습니다.");
      return reconcileRefund(db, batch, refreshed);
    }
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

export async function executePointChargeRefund(
  userId: number,
  pointLogId: number,
  db: Database.Database = getDb()
): Promise<PointChargeRefundExecutionResult> {
  ensurePointChargeRefundAttemptsSchema(db);

  const batch = resolveChargeBatchForUser(userId, pointLogId, db);
  if (!batch) {
    return {
      ok: false,
      status: "failed",
      balance: getPointBalanceOnDb(db, userId),
      error: "취소할 결제 내역을 찾을 수 없습니다.",
    };
  }
  if (batch.cancelled_at) {
    return {
      ok: true,
      status: "refunded",
      balance: getPointBalanceOnDb(db, userId),
    };
  }

  const checkout = getCheckoutIdentity(db, batch);
  if (!checkout) {
    return {
      ok: false,
      status: "failed",
      balance: getPointBalanceOnDb(db, userId),
      error: "PortOne 결제 정보가 연결되지 않아 자동 환불할 수 없습니다.",
    };
  }

  let attempt = getPointChargeRefundAttempt(db, batch.id);
  if (!attempt) {
    try {
      const claim = claimRefundAndHold(db, batch, checkout);
      attempt = getPointChargeRefundAttempt(db, batch.id);
      if (!attempt) throw new Error("환불 실행 상태 생성에 실패했습니다.");
      if (!claim.claimed) {
        return {
          ok: true,
          status: "skipped",
          balance: getPointBalanceOnDb(db, userId),
          message: "다른 요청이 환불 처리를 시작했습니다.",
        };
      }
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        balance: getPointBalanceOnDb(db, userId),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  switch (attempt.state) {
    case "SUCCEEDED":
      return {
        ok: true,
        status: "refunded",
        balance: finalizeRefundSuccess(db, batch),
      };
    case "FAILED":
      return failedResult(
        db,
        batch,
        attempt.failure_message || "PortOne 결제 취소가 실패했습니다."
      );
    case "DISPATCHED":
    case "REQUESTED":
    case "RECONCILIATION_REQUIRED":
      return reconcileRefund(db, batch, attempt);
    case "CLAIMED":
      return dispatchRefund(db, batch, attempt);
    default: {
      const _exhaustive: never = attempt.state;
      return _exhaustive;
    }
  }
}
