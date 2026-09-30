import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  ensurePointChargeBatchTable,
  recordPointChargeBatch,
} from "@/lib/chargeCancellation";
import {
  ensurePointChargeRefundAttemptsSchema,
  getPointChargeRefundAttempt,
  insertRefundAttempt,
  markRefundAttemptDispatched,
} from "@/lib/pointChargeRefundAttempts";
import { setPointChargeRefundProviderForTests } from "@/lib/pointChargeRefundGateway";
import type { PointChargeRefundProviderPort } from "@/lib/pointChargeRefundProviderTypes";
import { getPointBalanceOnDb } from "@/lib/points";
import { ensurePortoneCheckoutTable } from "@/lib/portoneCheckout";
import { finalizePortoneCheckoutFromProvider } from "@/lib/portonePaidFinalizer";
import { setPortOnePaymentLookupForTests } from "@/lib/portoneServer";
import {
  handlePortoneWebhookEvent,
  PORTONE_WEBHOOK_CANCEL_PENDING,
  PORTONE_WEBHOOK_CANCELLED,
  PORTONE_WEBHOOK_FAILED,
  PORTONE_WEBHOOK_PAID,
  PORTONE_WEBHOOK_PARTIAL_CANCELLED,
} from "@/lib/portoneWebhook";

const previousSecret = process.env.PORTONE_API_SECRET;

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      message_id INTEGER,
      chat_id INTEGER,
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
  `);
  ensurePortoneCheckoutTable(db);
  ensurePointChargeBatchTable(db);
  ensurePointChargeRefundAttemptsSchema(db);
  db.prepare("INSERT INTO users (id, points) VALUES (1, 0)").run();
  return db;
}

function insertPendingCheckout(
  db: Database.Database,
  paymentId = "pt-1-paid-recovery",
  amount = 5000
): void {
  db.prepare(
    `INSERT INTO portone_checkouts
     (user_id, package_id, payment_id, amount, status)
     VALUES (1, 'p5000', ?, ?, 'pending')`
  ).run(paymentId, amount);
}

function paidWebhook(paymentId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: PORTONE_WEBHOOK_PAID,
    timestamp: "2024-04-25T10:00:00.000Z",
    data: { paymentId, storeId: "store-test", transactionId: "tx-wh", ...extra },
    unknownFutureField: "ignore-me",
  });
}

function typedWebhook(type: string, paymentId: string): string {
  return JSON.stringify({
    type,
    timestamp: "2024-04-25T10:00:00.000Z",
    data: { paymentId, storeId: "store-test", transactionId: "tx-wh", cancellationId: "cn-1" },
  });
}

function snapshot(status: string, totalAmount: number | undefined, paymentId: string) {
  return {
    status,
    paymentId,
    txId: "tx-provider",
    totalAmount,
    cancellations: [] as Array<{ status: string; id: string }>,
  };
}

function creditCounts(db: Database.Database) {
  const checkout = db
    .prepare("SELECT status FROM portone_checkouts WHERE user_id=1")
    .get() as { status: string } | undefined;
  const tx = db.prepare("SELECT COUNT(*) AS c FROM point_transactions WHERE user_id=1").get() as {
    c: number;
  };
  const batch = db.prepare("SELECT COUNT(*) AS c FROM point_charge_batches WHERE user_id=1").get() as {
    c: number;
  };
  const logs = db
    .prepare("SELECT COUNT(*) AS c FROM point_logs WHERE user_id=1 AND reason LIKE '포인트 충전%'")
    .get() as { c: number };
  return {
    checkoutStatus: checkout?.status ?? "missing",
    tx: Number(tx.c),
    batch: Number(batch.c),
    logs: Number(logs.c),
    balance: getPointBalanceOnDb(db, 1).total,
  };
}

function seedPaidChargeWithHold(db: Database.Database, paymentId: string) {
  db.prepare("UPDATE users SET points=5500 WHERE id=1").run();
  const paidTx = db
    .prepare(
      `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
       VALUES (1, 'PAID', 0, datetime('now', '+1 year'))`
    )
    .run();
  const freeTx = db
    .prepare(
      `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
       VALUES (1, 'FREE', 0, datetime('now', '+1 year'))`
    )
    .run();
  const log = db
    .prepare("INSERT INTO point_logs (user_id, delta, reason) VALUES (1, 5000, '포인트 충전 (PortOne) (₩5,000)')")
    .run();
  const checkout = db
    .prepare(
      `INSERT INTO portone_checkouts
       (user_id, package_id, payment_id, amount, status, portone_tx_id, paid_at)
       VALUES (1, 'p5000', ?, 5000, 'paid', 'tx-paid', datetime('now'))`
    )
    .run(paymentId);
  const batchId = recordPointChargeBatch(db, {
    userId: 1,
    portoneCheckoutId: Number(checkout.lastInsertRowid),
    mainPointLogId: Number(log.lastInsertRowid),
    paidAmount: 5000,
    freeAmount: 500,
    paidTransactionId: Number(paidTx.lastInsertRowid),
    freeTransactionId: Number(freeTx.lastInsertRowid),
    priceKrw: 5000,
  });
  insertRefundAttempt(db, {
    chargeBatchId: batchId,
    portoneCheckoutId: Number(checkout.lastInsertRowid),
    paymentId,
  });
  return batchId;
}

afterEach(() => {
  setPortOnePaymentLookupForTests(null);
  setPointChargeRefundProviderForTests(null);
  if (previousSecret === undefined) delete process.env.PORTONE_API_SECRET;
  else process.env.PORTONE_API_SECRET = previousSecret;
});

describe("portone webhook recovery — gap and paid wake", () => {
  it("BEFORE: provider PAID + no complete leaves checkout pending and no credit", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    let gets = 0;
    setPortOnePaymentLookupForTests(async (id) => {
      gets += 1;
      return snapshot("PAID", 5000, id);
    });

    const before = creditCounts(db);
    assert.equal(before.checkoutStatus, "pending");
    assert.equal(before.tx, 0);
    assert.equal(before.batch, 0);
    assert.equal(before.balance, 0);
    assert.equal(gets, 0, "no owner polls PortOne until complete/webhook");
    db.close();
  });

  it("PAID webhook recovers pending checkout exactly once", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    let gets = 0;
    setPortOnePaymentLookupForTests(async (id) => {
      gets += 1;
      return snapshot("PAID", 5000, id);
    });

    const first = await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);
    const second = await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);
    assert.equal(first.httpStatus, 200);
    assert.equal(first.body.status, "paid");
    assert.equal(second.httpStatus, 200);
    assert.equal(second.body.status, "already_paid");
    assert.equal(gets, 1, "already-paid webhook must not GET again");

    const after = creditCounts(db);
    assert.equal(after.checkoutStatus, "paid");
    assert.equal(after.tx, 1);
    assert.equal(after.batch, 1);
    assert.equal(after.logs, 1);
    assert.equal(after.balance, 5000);
    db.close();
  });

  it("amount mismatch does not credit", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    setPortOnePaymentLookupForTests(async (id) => snapshot("PAID", 1, id));

    const result = await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.status, "amount_mismatch");
    assert.deepEqual(creditCounts(db), {
      checkoutStatus: "pending",
      tx: 0,
      batch: 0,
      logs: 0,
      balance: 0,
    });
    db.close();
  });

  it("provider state not PAID does not credit", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    setPortOnePaymentLookupForTests(async (id) => snapshot("FAILED", 5000, id));

    const result = await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);
    assert.equal(result.body.status, "not_paid");
    assert.equal(creditCounts(db).checkoutStatus, "pending");
    assert.equal(creditCounts(db).tx, 0);
    db.close();
  });

  it("nonexistent local paymentId does not GET provider", async () => {
    const db = setupDb();
    process.env.PORTONE_API_SECRET = "test-secret";
    let gets = 0;
    setPortOnePaymentLookupForTests(async (id) => {
      gets += 1;
      return snapshot("PAID", 5000, id);
    });

    const result = await handlePortoneWebhookEvent(paidWebhook("pt-unknown"), db);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.status, "no_local_checkout");
    assert.equal(gets, 0);
    db.close();
  });

  it("already-paid webhook is success no-op without GET", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    setPortOnePaymentLookupForTests(async (id) => snapshot("PAID", 5000, id));
    await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);

    let gets = 0;
    setPortOnePaymentLookupForTests(async (id) => {
      gets += 1;
      return snapshot("PAID", 5000, id);
    });
    const again = await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);
    assert.equal(again.body.status, "already_paid");
    assert.equal(gets, 0);
    assert.equal(creditCounts(db).tx, 1);
    db.close();
  });

  it("webhook first then complete keeps a single credit", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    setPortOnePaymentLookupForTests(async (id) => snapshot("PAID", 5000, id));

    await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);
    const complete = await finalizePortoneCheckoutFromProvider("pt-1-paid-recovery", { db });
    assert.equal(complete.status, "already_paid");
    assert.equal(creditCounts(db).tx, 1);
    assert.equal(creditCounts(db).batch, 1);
    assert.equal(creditCounts(db).balance, 5000);
    db.close();
  });

  it("complete first then webhook keeps a single credit", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    setPortOnePaymentLookupForTests(async (id) => snapshot("PAID", 5000, id));

    const complete = await finalizePortoneCheckoutFromProvider("pt-1-paid-recovery", { db });
    assert.equal(complete.status, "paid");
    const wake = await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);
    assert.equal(wake.body.status, "already_paid");
    assert.equal(creditCounts(db).tx, 1);
    assert.equal(creditCounts(db).balance, 5000);
    db.close();
  });

  it("concurrent webhook + complete credits once", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    setPortOnePaymentLookupForTests(async (id) => snapshot("PAID", 5000, id));

    const [a, b] = await Promise.all([
      handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db),
      finalizePortoneCheckoutFromProvider("pt-1-paid-recovery", { db }),
    ]);
    assert.ok(a.httpStatus === 200);
    assert.ok(b.ok);
    assert.equal(creditCounts(db).tx, 1);
    assert.equal(creditCounts(db).batch, 1);
    assert.equal(creditCounts(db).balance, 5000);
    db.close();
  });

  it("unknown webhook type is 2xx no-op without GET", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    let gets = 0;
    setPortOnePaymentLookupForTests(async (id) => {
      gets += 1;
      return snapshot("PAID", 5000, id);
    });

    const result = await handlePortoneWebhookEvent(typedWebhook("Transaction.Ready", "pt-1-paid-recovery"), db);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.status, "unknown_type");
    assert.equal(gets, 0);
    assert.equal(creditCounts(db).checkoutStatus, "pending");
    db.close();
  });

  it("malformed body is 2xx no-op", async () => {
    const db = setupDb();
    const result = await handlePortoneWebhookEvent("not-json", db);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.status, "malformed");
    db.close();
  });

  it("provider GET transient failure returns 503 so PortOne can retry", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    setPortOnePaymentLookupForTests(async () => {
      throw new Error("upstream timeout");
    });

    const result = await handlePortoneWebhookEvent(paidWebhook("pt-1-paid-recovery"), db);
    assert.equal(result.httpStatus, 503);
    assert.equal(result.body.status, "provider_error");
    assert.equal(creditCounts(db).tx, 0);
    db.close();
  });

  it("Transaction.Failed does not write checkout failed or credit", async () => {
    const db = setupDb();
    insertPendingCheckout(db);
    process.env.PORTONE_API_SECRET = "test-secret";
    let gets = 0;
    setPortOnePaymentLookupForTests(async (id) => {
      gets += 1;
      return snapshot("FAILED", 5000, id);
    });

    const result = await handlePortoneWebhookEvent(typedWebhook(PORTONE_WEBHOOK_FAILED, "pt-1-paid-recovery"), db);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.status, "failed_event_no_writer");
    assert.equal(gets, 0);
    assert.equal(creditCounts(db).checkoutStatus, "pending");
    db.close();
  });
});

describe("portone webhook recovery — refund wake", () => {
  it("CancelPending wakes lookup only and never cancels", async () => {
    const db = setupDb();
    const paymentId = "payment-refund-wake";
    const batchId = seedPaidChargeWithHold(db, paymentId);
    assert.ok(markRefundAttemptDispatched(db, batchId));

    let cancels = 0;
    let lookups = 0;
    const provider: PointChargeRefundProviderPort = {
      async cancel() {
        cancels += 1;
        throw new Error("cancel must not run from webhook");
      },
      async lookup() {
        lookups += 1;
        return { status: "pending", cancellationId: "cn-1", providerStatus: "REQUESTED" };
      },
    };
    setPointChargeRefundProviderForTests(provider);

    const result = await handlePortoneWebhookEvent(typedWebhook(PORTONE_WEBHOOK_CANCEL_PENDING, paymentId), db);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.status, "pending");
    assert.equal(cancels, 0);
    assert.equal(lookups, 1);
    assert.equal(getPointChargeRefundAttempt(db, batchId)?.state, "REQUESTED");
    const batch = db.prepare("SELECT cancelled_at FROM point_charge_batches WHERE id=?").get(batchId) as {
      cancelled_at: string | null;
    };
    assert.equal(batch.cancelled_at, null);
    db.close();
  });

  it("Cancelled wake finalizes once via lookup and repeated webhook does not duplicate", async () => {
    const db = setupDb();
    const paymentId = "payment-refund-cancelled";
    const batchId = seedPaidChargeWithHold(db, paymentId);
    assert.ok(markRefundAttemptDispatched(db, batchId));

    let cancels = 0;
    const provider: PointChargeRefundProviderPort = {
      async cancel() {
        cancels += 1;
        throw new Error("cancel must not run from webhook");
      },
      async lookup() {
        return { status: "success", cancellationId: "cn-1", providerStatus: "CANCELLED" };
      },
    };
    setPointChargeRefundProviderForTests(provider);

    const first = await handlePortoneWebhookEvent(typedWebhook(PORTONE_WEBHOOK_CANCELLED, paymentId), db);
    const second = await handlePortoneWebhookEvent(typedWebhook(PORTONE_WEBHOOK_CANCELLED, paymentId), db);
    assert.equal(first.body.status, "refunded");
    assert.equal(second.body.status, "refunded");
    assert.equal(cancels, 0);
    assert.equal(getPointChargeRefundAttempt(db, batchId)?.state, "SUCCEEDED");
    const logs = db.prepare("SELECT COUNT(*) AS c FROM point_logs WHERE reason LIKE '결제 취소%'").get() as {
      c: number;
    };
    assert.equal(Number(logs.c), 1);
    db.close();
  });

  it("PartialCancelled does not full-finalize", async () => {
    const db = setupDb();
    const paymentId = "payment-refund-partial";
    const batchId = seedPaidChargeWithHold(db, paymentId);
    assert.ok(markRefundAttemptDispatched(db, batchId));

    let cancels = 0;
    const provider: PointChargeRefundProviderPort = {
      async cancel() {
        cancels += 1;
        throw new Error("cancel must not run");
      },
      async lookup() {
        return { status: "unknown" };
      },
    };
    setPointChargeRefundProviderForTests(provider);

    const result = await handlePortoneWebhookEvent(
      typedWebhook(PORTONE_WEBHOOK_PARTIAL_CANCELLED, paymentId),
      db
    );
    assert.equal(result.body.status, "reconciliation_required");
    assert.equal(cancels, 0);
    assert.equal(getPointChargeRefundAttempt(db, batchId)?.state, "RECONCILIATION_REQUIRED");
    const batch = db.prepare("SELECT cancelled_at FROM point_charge_batches WHERE id=?").get(batchId) as {
      cancelled_at: string | null;
    };
    assert.equal(batch.cancelled_at, null);
    db.close();
  });

  it("DISPATCHED refund webhook never re-cancels", async () => {
    const db = setupDb();
    const paymentId = "payment-refund-dispatched";
    const batchId = seedPaidChargeWithHold(db, paymentId);
    assert.ok(markRefundAttemptDispatched(db, batchId));

    let cancels = 0;
    const provider: PointChargeRefundProviderPort = {
      async cancel() {
        cancels += 1;
        return { resultClass: "success", cancellationId: "should-not", providerStatus: "SUCCEEDED" };
      },
      async lookup() {
        return { status: "unknown" };
      },
    };
    setPointChargeRefundProviderForTests(provider);

    await handlePortoneWebhookEvent(typedWebhook(PORTONE_WEBHOOK_CANCELLED, paymentId), db);
    assert.equal(cancels, 0);
    assert.equal(getPointChargeRefundAttempt(db, batchId)?.state, "RECONCILIATION_REQUIRED");
    db.close();
  });

  it("cancellation webhook without local attempt does not GET or cancel", async () => {
    const db = setupDb();
    insertPendingCheckout(db, "payment-no-attempt");
    let refundCancels = 0;
    setPointChargeRefundProviderForTests({
      async cancel() {
        refundCancels += 1;
        throw new Error("no cancel");
      },
      async lookup() {
        throw new Error("no lookup");
      },
    });
    let gets = 0;
    setPortOnePaymentLookupForTests(async (id) => {
      gets += 1;
      return snapshot("CANCELLED", 5000, id);
    });

    const result = await handlePortoneWebhookEvent(
      typedWebhook(PORTONE_WEBHOOK_CANCELLED, "payment-no-attempt"),
      db
    );
    assert.equal(result.body.status, "no_local_refund_attempt");
    assert.equal(refundCancels, 0);
    assert.equal(gets, 0);
    db.close();
  });
});
