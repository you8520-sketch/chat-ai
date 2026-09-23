import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  ensurePointChargeBatchTable,
  recordPointChargeBatch,
  resolveChargeBatchForUser,
} from "@/lib/chargeCancellation";
import {
  executePointChargeRefund,
} from "@/lib/pointChargeRefundExecution";
import {
  ensurePointChargeRefundAttemptsSchema,
  getPointChargeRefundAttempt,
  insertRefundAttempt,
  markRefundAttemptDispatched,
  recordRefundAttemptState,
} from "@/lib/pointChargeRefundAttempts";
import {
  setPointChargeRefundProviderForTests,
} from "@/lib/pointChargeRefundGateway";
import type {
  PointChargeRefundCancelInput,
  PointChargeRefundCancelResult,
  PointChargeRefundLookupResult,
  PointChargeRefundProviderPort,
} from "@/lib/pointChargeRefundProviderTypes";
import { getPointBalanceOnDb } from "@/lib/points";
import { ensurePortoneCheckoutTable } from "@/lib/portoneCheckout";

type SeededCharge = {
  userId: number;
  pointLogId: number;
  batchId: number;
  checkoutId: number;
  paidTxId: number;
  freeTxId: number | null;
  paymentId: string;
  price: number;
  paid: number;
  free: number;
};

function createSchema(db: Database.Database): void {
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
}

function seedCharge(
  db: Database.Database,
  opts: { free?: number; withCheckout?: boolean } = {}
): SeededCharge {
  const userId = 1;
  const paid = 5000;
  const free = opts.free ?? 500;
  const price = 5000;
  const withCheckout = opts.withCheckout ?? true;
  db.prepare("INSERT INTO users (id, points) VALUES (?, ?)").run(userId, paid + free);

  const paidTx = db.prepare(
    `INSERT INTO point_transactions
     (user_id, point_type, remaining_amount, expires_at)
     VALUES (?, 'PAID', ?, datetime('now', '+1 year'))`
  ).run(userId, paid);
  let freeTxId: number | null = null;
  if (free > 0) {
    const freeTx = db.prepare(
      `INSERT INTO point_transactions
       (user_id, point_type, remaining_amount, expires_at)
       VALUES (?, 'FREE', ?, datetime('now', '+1 year'))`
    ).run(userId, free);
    freeTxId = Number(freeTx.lastInsertRowid);
  }

  const log = db.prepare(
    "INSERT INTO point_logs (user_id, delta, reason) VALUES (?,?,?)"
  ).run(userId, paid, "포인트 충전 (PortOne) (₩5,000)");
  const pointLogId = Number(log.lastInsertRowid);

  let checkoutId = 0;
  const paymentId = "payment-refund-test";
  if (withCheckout) {
    const checkout = db.prepare(
      `INSERT INTO portone_checkouts
       (user_id, package_id, payment_id, amount, status, portone_tx_id, paid_at)
       VALUES (?, 'p5000', ?, ?, 'paid', 'tx-paid', datetime('now'))`
    ).run(userId, paymentId, price);
    checkoutId = Number(checkout.lastInsertRowid);
  }

  const batchId = recordPointChargeBatch(db, {
    userId,
    portoneCheckoutId: withCheckout ? checkoutId : null,
    mainPointLogId: pointLogId,
    paidAmount: paid,
    freeAmount: free,
    paidTransactionId: Number(paidTx.lastInsertRowid),
    freeTransactionId: freeTxId,
    priceKrw: price,
  });

  return {
    userId,
    pointLogId,
    batchId,
    checkoutId,
    paidTxId: Number(paidTx.lastInsertRowid),
    freeTxId,
    paymentId,
    price,
    paid,
    free,
  };
}

function txAmount(db: Database.Database, id: number): number {
  return Number(
    (db.prepare("SELECT remaining_amount FROM point_transactions WHERE id=?").get(id) as {
      remaining_amount: number;
    }).remaining_amount
  );
}

function cancelledAt(db: Database.Database, table: "point_charge_batches" | "portone_checkouts", id: number) {
  return (
    db.prepare(`SELECT cancelled_at FROM ${table} WHERE id=?`).get(id) as {
      cancelled_at: string | null;
    }
  ).cancelled_at;
}

function cancellationLogCount(db: Database.Database): number {
  return Number(
    (db.prepare("SELECT COUNT(*) AS c FROM point_logs WHERE reason LIKE '결제 취소%'").get() as {
      c: number;
    }).c
  );
}

function makeProvider(
  cancelResult: PointChargeRefundCancelResult,
  lookupResult: PointChargeRefundLookupResult = { status: "unknown" }
): PointChargeRefundProviderPort & {
  cancelCount: number;
  lookupCount: number;
  lastCancelInput: PointChargeRefundCancelInput | null;
} {
  const provider = {
    cancelCount: 0,
    lookupCount: 0,
    lastCancelInput: null as PointChargeRefundCancelInput | null,
    async cancel(input: PointChargeRefundCancelInput) {
      provider.cancelCount += 1;
      provider.lastCancelInput = input;
      return cancelResult;
    },
    async lookup() {
      provider.lookupCount += 1;
      return lookupResult;
    },
  };
  return provider;
}

afterEach(() => {
  setPointChargeRefundProviderForTests(null);
});

describe("point charge refund exactly-once — BEFORE reproduction", () => {
  it("legacy local-first ordering can mark local cancellation before provider failure", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);

    db.transaction(() => {
      db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(charge.paidTxId);
      if (charge.freeTxId) {
        db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(charge.freeTxId);
      }
      db.prepare("UPDATE point_charge_batches SET cancelled_at=datetime('now') WHERE id=?").run(
        charge.batchId
      );
      db.prepare("UPDATE portone_checkouts SET cancelled_at=datetime('now') WHERE id=?").run(
        charge.checkoutId
      );
    })();

    await assert.rejects(async () => {
      throw new Error("provider refund failed");
    });

    assert.ok(cancelledAt(db, "point_charge_batches", charge.batchId));
    assert.equal(txAmount(db, charge.paidTxId), 0);
    db.close();
  });
});

describe("point charge refund exactly-once — regression", () => {
  it("1. provider success finalizes local cancellation exactly once", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);
    const provider = makeProvider({
      resultClass: "success",
      cancellationId: "cancel-1",
      providerStatus: "SUCCEEDED",
    });
    setPointChargeRefundProviderForTests(provider);

    const first = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    const second = await executePointChargeRefund(charge.userId, charge.pointLogId, db);

    assert.equal(first.ok, true);
    assert.equal(first.status, "refunded");
    assert.equal(second.ok, true);
    assert.equal(second.status, "refunded");
    assert.equal(provider.cancelCount, 1);
    assert.equal(provider.lookupCount, 0);
    assert.ok(cancelledAt(db, "point_charge_batches", charge.batchId));
    assert.ok(cancelledAt(db, "portone_checkouts", charge.checkoutId));
    assert.equal(txAmount(db, charge.paidTxId), 0);
    assert.equal(charge.freeTxId ? txAmount(db, charge.freeTxId) : 0, 0);
    assert.equal(cancellationLogCount(db), 1);
    assert.equal(getPointBalanceOnDb(db, charge.userId).total, 0);
    assert.equal(getPointChargeRefundAttempt(db, charge.batchId)?.state, "SUCCEEDED");
    db.close();
  });

  it("2. confirmed provider failure restores held points exactly once", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);
    const provider = makeProvider({
      resultClass: "failed",
      cancellationId: "cancel-failed",
      providerStatus: "FAILED",
      code: "DECLINED",
      message: "refund declined",
    });
    setPointChargeRefundProviderForTests(provider);

    const first = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    const second = await executePointChargeRefund(charge.userId, charge.pointLogId, db);

    assert.equal(first.ok, false);
    assert.equal(first.status, "failed");
    assert.equal(second.ok, false);
    assert.equal(provider.cancelCount, 1);
    assert.equal(txAmount(db, charge.paidTxId), charge.paid);
    assert.equal(charge.freeTxId ? txAmount(db, charge.freeTxId) : 0, charge.free);
    assert.equal(getPointBalanceOnDb(db, charge.userId).total, charge.paid + charge.free);
    assert.equal(cancelledAt(db, "point_charge_batches", charge.batchId), null);
    assert.equal(cancellationLogCount(db), 0);
    assert.equal(getPointChargeRefundAttempt(db, charge.batchId)?.state, "FAILED");
    db.close();
  });

  it("3. REQUESTED keeps points held and next call uses lookup only", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);
    const provider = makeProvider(
      {
        resultClass: "pending",
        cancellationId: "cancel-requested",
        providerStatus: "REQUESTED",
      },
      {
        status: "success",
        cancellationId: "cancel-requested",
        providerStatus: "SUCCEEDED",
      }
    );
    setPointChargeRefundProviderForTests(provider);

    const first = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    assert.equal(first.ok, true);
    assert.equal(first.status, "pending");
    assert.equal(txAmount(db, charge.paidTxId), 0);
    assert.equal(cancelledAt(db, "point_charge_batches", charge.batchId), null);

    const second = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    assert.equal(second.ok, true);
    assert.equal(second.status, "refunded");
    assert.equal(provider.cancelCount, 1);
    assert.equal(provider.lookupCount, 1);
    assert.ok(cancelledAt(db, "point_charge_batches", charge.batchId));
    assert.equal(cancellationLogCount(db), 1);
    db.close();
  });

  it("4. provider unknown never resends after DISPATCHED", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);
    const provider = makeProvider(
      {
        resultClass: "unknown",
        code: "TIMEOUT",
        message: "socket timeout after dispatch",
      },
      { status: "unknown" }
    );
    setPointChargeRefundProviderForTests(provider);

    const first = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    const second = await executePointChargeRefund(charge.userId, charge.pointLogId, db);

    assert.equal(first.ok, true);
    assert.equal(first.status, "reconciliation_required");
    assert.equal(second.ok, true);
    assert.equal(second.status, "reconciliation_required");
    assert.equal(provider.cancelCount, 1);
    assert.equal(provider.lookupCount, 2);
    assert.equal(txAmount(db, charge.paidTxId), 0);
    assert.equal(cancelledAt(db, "point_charge_batches", charge.batchId), null);
    assert.equal(getPointChargeRefundAttempt(db, charge.batchId)?.state, "RECONCILIATION_REQUIRED");
    db.close();
  });

  it("5. crash after CLAIMED+hold but before dispatch can continue once", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);

    const claimed = db.transaction(() => {
      const inserted = insertRefundAttempt(db, {
        chargeBatchId: charge.batchId,
        portoneCheckoutId: charge.checkoutId,
        paymentId: charge.paymentId,
      });
      db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(charge.paidTxId);
      if (charge.freeTxId) {
        db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(charge.freeTxId);
      }
      db.prepare("UPDATE users SET points=0 WHERE id=?").run(charge.userId);
      return inserted;
    })();
    assert.equal(claimed, true);

    const provider = makeProvider({
      resultClass: "success",
      cancellationId: "cancel-after-crash",
      providerStatus: "SUCCEEDED",
    });
    setPointChargeRefundProviderForTests(provider);

    const result = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    assert.equal(result.ok, true);
    assert.equal(result.status, "refunded");
    assert.equal(provider.cancelCount, 1);
    assert.equal(cancellationLogCount(db), 1);
    db.close();
  });

  it("6. crash after DISPATCHED never calls cancel again", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);

    db.transaction(() => {
      insertRefundAttempt(db, {
        chargeBatchId: charge.batchId,
        portoneCheckoutId: charge.checkoutId,
        paymentId: charge.paymentId,
      });
      db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(charge.paidTxId);
      if (charge.freeTxId) {
        db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(charge.freeTxId);
      }
      db.prepare("UPDATE users SET points=0 WHERE id=?").run(charge.userId);
      markRefundAttemptDispatched(db, charge.batchId);
    })();

    const provider = makeProvider(
      {
        resultClass: "success",
        cancellationId: "must-not-send",
        providerStatus: "SUCCEEDED",
      },
      {
        status: "success",
        cancellationId: "cancel-from-lookup",
        providerStatus: "CANCELLED",
      }
    );
    setPointChargeRefundProviderForTests(provider);

    const result = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    assert.equal(result.ok, true);
    assert.equal(result.status, "refunded");
    assert.equal(provider.cancelCount, 0);
    assert.equal(provider.lookupCount, 1);
    db.close();
  });

  it("7. provider success persisted before local finalize can be finalized without resend", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);

    db.transaction(() => {
      insertRefundAttempt(db, {
        chargeBatchId: charge.batchId,
        portoneCheckoutId: charge.checkoutId,
        paymentId: charge.paymentId,
      });
      db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(charge.paidTxId);
      if (charge.freeTxId) {
        db.prepare("UPDATE point_transactions SET remaining_amount=0 WHERE id=?").run(charge.freeTxId);
      }
      db.prepare("UPDATE users SET points=0 WHERE id=?").run(charge.userId);
      markRefundAttemptDispatched(db, charge.batchId);
      recordRefundAttemptState(db, {
        chargeBatchId: charge.batchId,
        state: "SUCCEEDED",
        providerCancellationId: "cancel-persisted",
        providerStatus: "SUCCEEDED",
      });
    })();

    const provider = makeProvider(
      {
        resultClass: "success",
        cancellationId: "must-not-send",
        providerStatus: "SUCCEEDED",
      },
      { status: "unknown" }
    );
    setPointChargeRefundProviderForTests(provider);

    const result = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    assert.equal(result.ok, true);
    assert.equal(result.status, "refunded");
    assert.equal(provider.cancelCount, 0);
    assert.equal(provider.lookupCount, 0);
    assert.ok(cancelledAt(db, "point_charge_batches", charge.batchId));
    assert.equal(cancellationLogCount(db), 1);
    db.close();
  });

  it("8. missing PortOne checkout fails closed without holding points", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db, { withCheckout: false });
    const provider = makeProvider({
      resultClass: "success",
      cancellationId: "unexpected",
      providerStatus: "SUCCEEDED",
    });
    setPointChargeRefundProviderForTests(provider);

    const result = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    assert.equal(result.ok, false);
    assert.equal(provider.cancelCount, 0);
    assert.equal(txAmount(db, charge.paidTxId), charge.paid);
    assert.equal(getPointChargeRefundAttempt(db, charge.batchId), null);
    db.close();
  });

  it("9. legacy backfill never guesses PortOne payment identity from time/amount proximity", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);

    db.prepare("DELETE FROM point_charge_batches WHERE id=?").run(charge.batchId);
    const rebuilt = resolveChargeBatchForUser(charge.userId, charge.pointLogId, db);
    assert.ok(rebuilt);
    assert.equal(rebuilt.portone_checkout_id, null);

    const provider = makeProvider({
      resultClass: "success",
      cancellationId: "must-not-refund-guessed-payment",
      providerStatus: "SUCCEEDED",
    });
    setPointChargeRefundProviderForTests(provider);

    const result = await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    assert.equal(result.ok, false);
    assert.equal(provider.cancelCount, 0);
    assert.equal(txAmount(db, charge.paidTxId), charge.paid);
    db.close();
  });

  it("10. cancellation request uses amount consistency guard", async () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);
    const provider = makeProvider({
      resultClass: "success",
      cancellationId: "cancel-guard",
      providerStatus: "SUCCEEDED",
    });
    setPointChargeRefundProviderForTests(provider);

    await executePointChargeRefund(charge.userId, charge.pointLogId, db);
    assert.deepEqual(provider.lastCancelInput, {
      paymentId: charge.paymentId,
      amount: charge.price,
      currentCancellableAmount: charge.price,
    });
    db.close();
  });

  it("11. terminal SUCCEEDED state cannot be overwritten by stale reconciliation", () => {
    const db = new Database(":memory:");
    createSchema(db);
    const charge = seedCharge(db);
    insertRefundAttempt(db, {
      chargeBatchId: charge.batchId,
      portoneCheckoutId: charge.checkoutId,
      paymentId: charge.paymentId,
    });
    markRefundAttemptDispatched(db, charge.batchId);
    const success = recordRefundAttemptState(db, {
      chargeBatchId: charge.batchId,
      state: "SUCCEEDED",
      providerCancellationId: "cancel-terminal",
      providerStatus: "SUCCEEDED",
    });
    const stale = recordRefundAttemptState(db, {
      chargeBatchId: charge.batchId,
      state: "RECONCILIATION_REQUIRED",
      failureCode: "STALE",
      failureMessage: "stale lookup",
    });

    assert.equal(success, true);
    assert.equal(stale, false);
    assert.equal(getPointChargeRefundAttempt(db, charge.batchId)?.state, "SUCCEEDED");
    db.close();
  });

  it("12. two workers cannot dispatch the provider cancel twice", async () => {
    const dbPath = path.join(os.tmpdir(), `refund-concurrency-${process.pid}.db`);
    fs.rmSync(dbPath, { force: true });
    const dbA = new Database(dbPath);
    const dbB = new Database(dbPath);
    createSchema(dbA);
    ensurePointChargeBatchTable(dbB);
    ensurePointChargeRefundAttemptsSchema(dbB);
    const charge = seedCharge(dbA);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: PointChargeRefundProviderPort & { cancelCount: number; lookupCount: number } = {
      cancelCount: 0,
      lookupCount: 0,
      async cancel() {
        provider.cancelCount += 1;
        await gate;
        return {
          resultClass: "success",
          cancellationId: "cancel-concurrent",
          providerStatus: "SUCCEEDED",
        };
      },
      async lookup() {
        provider.lookupCount += 1;
        return { status: "unknown" };
      },
    };
    setPointChargeRefundProviderForTests(provider);

    const a = executePointChargeRefund(charge.userId, charge.pointLogId, dbA);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = executePointChargeRefund(charge.userId, charge.pointLogId, dbB);
    release();
    const [ra, rb] = await Promise.all([a, b]);

    assert.equal(provider.cancelCount, 1);
    assert.ok([ra.status, rb.status].includes("refunded"));
    assert.equal(cancellationLogCount(dbA), 1);

    dbA.close();
    dbB.close();
    fs.rmSync(dbPath, { force: true });
  });
});

describe("point charge refund provider boundary — source contract", () => {
  it("PortOne cancel request sends currentCancellableAmount and never silently succeeds without secret", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/portoneServer.ts"),
      "utf8"
    );
    assert.match(src, /currentCancellableAmount/);
    assert.match(src, /PORTONE_API_SECRET_MISSING/);
    assert.doesNotMatch(src, /if \(!PORTONE_API_SECRET\) return;/);
  });

  it("legacy local-first owner is removed", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/chargeCancellation.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /cancelPointChargeBatch/);
    assert.doesNotMatch(src, /void cancelPortOnePayment/);
  });
});
