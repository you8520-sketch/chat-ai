import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  atomicClaimWithdrawal,
  executeWithdrawalPayout,
  listWithdrawalsForExecution,
} from "@/lib/payoutExecution";
import type {
  PayoutProviderLookupResult,
  PayoutProviderPort,
  PayoutProviderTransferInput,
  PayoutProviderTransferResult,
} from "@/lib/payoutProviderTypes";
import {
  resetPayoutGatewaySimulationForTests,
  setPayoutProviderForTests,
} from "@/lib/payoutGateway";
import {
  ensurePayoutTransferAttemptsSchema,
  getTransferAttemptByWithdrawalId,
  markAttemptDispatched,
  stableProviderRequestId,
} from "@/lib/payoutTransferAttempts";
import { roundCreatorAmount } from "@/lib/creatorShared";

const accountJson = JSON.stringify({
  bankName: "국민은행",
  accountNumber: "123456789012",
  accountHolder: "홍길동",
  accountMasked: "********9012",
});

function createPayoutTestSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      creator_points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE creator_point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      requested_cp REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0,
      platform_fee REAL NOT NULL DEFAULT 0,
      payout_amount INTEGER NOT NULL,
      account_info TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','APPROVED','REJECTED','FAILED')),
      failure_reason TEXT NOT NULL DEFAULT '',
      provider_ref TEXT NOT NULL DEFAULT '',
      resident_number TEXT NOT NULL DEFAULT '',
      id_card_url TEXT NOT NULL DEFAULT '',
      bankbook_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );
  `);
  ensurePayoutTransferAttemptsSchema(db);
}

function insertPendingWithdrawal(
  db: Database.Database,
  params: { userId: number; requestedCp: number; payoutAmount: number }
): number {
  const result = db
    .prepare(
      `INSERT INTO withdrawal_requests
        (user_id, requested_cp, payout_amount, account_info, status)
       VALUES (?, ?, ?, ?, 'PENDING')`
    )
    .run(params.userId, params.requestedCp, params.payoutAmount, accountJson);
  return Number(result.lastInsertRowid);
}

function readExecutionRow(
  db: Database.Database,
  withdrawalId: number
): Parameters<typeof executeWithdrawalPayout>[0] {
  return db
    .prepare(
      `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
              failure_reason
       FROM withdrawal_requests WHERE id=?`
    )
    .get(withdrawalId) as Parameters<typeof executeWithdrawalPayout>[0];
}

function getCreatorPoints(db: Database.Database, userId: number): number {
  const row = db.prepare("SELECT creator_points FROM users WHERE id=?").get(userId) as
    | { creator_points: number }
    | undefined;
  return roundCreatorAmount(Number(row?.creator_points ?? 0));
}

function createCountingProvider(): PayoutProviderPort & {
  sendCount: number;
  lookupCount: number;
  keys: string[];
} {
  const state = new Map<
    string,
    { status: "success" | "failed" | "unknown"; providerRef?: string; code?: string; message?: string }
  >();

  const port: PayoutProviderPort & {
    sendCount: number;
    lookupCount: number;
    keys: string[];
  } = {
    sendCount: 0,
    lookupCount: 0,
    keys: [],

    async transfer(input: PayoutProviderTransferInput): Promise<PayoutProviderTransferResult> {
      port.sendCount += 1;
      port.keys.push(input.idempotencyKey);
      const providerRef = `TEST-${input.idempotencyKey}-${port.sendCount}`;
      state.set(input.idempotencyKey, { status: "success", providerRef });
      return { resultClass: "success", providerRef, deduplicated: false };
    },

    async lookup(idempotencyKey: string): Promise<PayoutProviderLookupResult> {
      port.lookupCount += 1;
      const existing = state.get(idempotencyKey);
      if (!existing) return { status: "not_found" };
      if (existing.status === "success") {
        return { status: "success", providerRef: existing.providerRef! };
      }
      if (existing.status === "failed") {
        return {
          status: "failed",
          code: existing.code ?? "FAILED",
          message: existing.message ?? "failed",
        };
      }
      return { status: "unknown" };
    },
  };

  return port;
}

describe("payout exactly-once — BEFORE reproduction", () => {
  it("legacy send-before-finalize permits two effective sends", async () => {
    const provider = createCountingProvider();
    const withdrawalId = 42;
    await provider.transfer({
      bankCode: "004",
      accountNo: "123456789012",
      amount: 8000,
      idempotencyKey: `legacy-${withdrawalId}-worker-a`,
      withdrawalId,
    });
    await provider.transfer({
      bankCode: "004",
      accountNo: "123456789012",
      amount: 8000,
      idempotencyKey: `legacy-${withdrawalId}-worker-b`,
      withdrawalId,
    });
    assert.equal(provider.sendCount, 2);
  });
});

describe("payout exactly-once — regression fixtures", () => {
  before(() => {
    resetPayoutGatewaySimulationForTests();
    setPayoutProviderForTests(null);
  });

  after(() => {
    resetPayoutGatewaySimulationForTests();
    setPayoutProviderForTests(null);
  });

  it("1. two workers same withdrawal → provider transfer once without provider dedupe", async () => {
    const dbPath = path.join(os.tmpdir(), `payout-concurrency-${process.pid}.db`);
    fs.rmSync(dbPath, { force: true });
    const dbA = new Database(dbPath);
    const dbB = new Database(dbPath);
    createPayoutTestSchema(dbA);
    ensurePayoutTransferAttemptsSchema(dbB);
    dbA.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(dbA, {
      userId: 1,
      requestedCp: 10000,
      payoutAmount: 8000,
    });
    const row = readExecutionRow(dbA, id);
    const provider = createCountingProvider();
    setPayoutProviderForTests(provider);

    const results = await Promise.all([
      executeWithdrawalPayout(row, dbA),
      executeWithdrawalPayout(row, dbB),
    ]);

    assert.equal(provider.sendCount, 1);
    assert.ok(results.includes("approved"));
    assert.ok(results.includes("skipped") || results.includes("approved"));

    const final = dbA
      .prepare("SELECT status, provider_ref FROM withdrawal_requests WHERE id=?")
      .get(id) as { status: string; provider_ref: string };
    assert.equal(final.status, "APPROVED");
    assert.ok(final.provider_ref.length > 0);

    dbA.close();
    dbB.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("2. atomic claim — only one attempt row owner", () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 1000, payoutAmount: 800 });
    const a = atomicClaimWithdrawal(db, id);
    const b = atomicClaimWithdrawal(db, id);
    assert.equal(a.claimed, true);
    assert.equal(b.claimed, false);
    assert.equal(getTransferAttemptByWithdrawalId(db, id)?.state, "CLAIMED");
    db.close();
  });

  it("3. crash after claim but before dispatch → next run may send once", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });
    const claim = atomicClaimWithdrawal(db, id);
    assert.equal(claim.claimed, true);
    assert.equal(getTransferAttemptByWithdrawalId(db, id)?.state, "CLAIMED");

    const provider = createCountingProvider();
    setPayoutProviderForTests(provider);
    const outcome = await executeWithdrawalPayout(readExecutionRow(db, id), db);

    assert.equal(outcome, "approved");
    assert.equal(provider.sendCount, 1);
    assert.equal(getTransferAttemptByWithdrawalId(db, id)?.state, "SUCCEEDED");
    db.close();
  });

  it("4. crash after DISPATCHED boundary → retry performs lookup only, never transfer", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 5000)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });

    const claim = atomicClaimWithdrawal(db, id);
    assert.equal(claim.claimed, true);
    assert.equal(markAttemptDispatched(db, id), true);
    assert.equal(getTransferAttemptByWithdrawalId(db, id)?.state, "DISPATCHED");

    let transferCalls = 0;
    let lookupCalls = 0;
    const provider: PayoutProviderPort = {
      async transfer() {
        transferCalls += 1;
        throw new Error("transfer must not be retried after DISPATCHED");
      },
      async lookup() {
        lookupCalls += 1;
        return { status: "unknown" };
      },
    };
    setPayoutProviderForTests(provider);

    const cpBefore = getCreatorPoints(db, 1);
    const outcome = await executeWithdrawalPayout(readExecutionRow(db, id), db);

    assert.equal(outcome, "reconciliation_required");
    assert.equal(transferCalls, 0);
    assert.equal(lookupCalls, 1);
    assert.equal(getCreatorPoints(db, 1), cpBefore);
    assert.equal(getTransferAttemptByWithdrawalId(db, id)?.state, "RECONCILIATION_REQUIRED");
    const withdrawal = db
      .prepare("SELECT status FROM withdrawal_requests WHERE id=?")
      .get(id) as { status: string };
    assert.equal(withdrawal.status, "PENDING");
    db.close();
  });

  it("5. provider throw after dispatch → reconciliation required and later no resend", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 5000)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });

    let transferCalls = 0;
    let lookupCalls = 0;
    const provider: PayoutProviderPort = {
      async transfer() {
        transferCalls += 1;
        throw new Error("socket reset after request dispatch");
      },
      async lookup() {
        lookupCalls += 1;
        return { status: "unknown" };
      },
    };
    setPayoutProviderForTests(provider);

    const cpBefore = getCreatorPoints(db, 1);
    const first = await executeWithdrawalPayout(readExecutionRow(db, id), db);
    const second = await executeWithdrawalPayout(readExecutionRow(db, id), db);

    assert.equal(first, "reconciliation_required");
    assert.equal(second, "reconciliation_required");
    assert.equal(transferCalls, 1);
    assert.equal(lookupCalls, 1);
    assert.equal(getCreatorPoints(db, 1), cpBefore);
    assert.equal(getTransferAttemptByWithdrawalId(db, id)?.state, "RECONCILIATION_REQUIRED");
    db.close();
  });

  it("6. provider unknown result → no auto resend and no CP rollback", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 5000)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });

    let transferCalls = 0;
    let lookupCalls = 0;
    const provider: PayoutProviderPort = {
      async transfer() {
        transferCalls += 1;
        return {
          resultClass: "unknown",
          code: "TIMEOUT",
          message: "connection reset",
        };
      },
      async lookup() {
        lookupCalls += 1;
        return { status: "unknown" };
      },
    };
    setPayoutProviderForTests(provider);

    const cpBefore = getCreatorPoints(db, 1);
    const first = await executeWithdrawalPayout(readExecutionRow(db, id), db);
    const second = await executeWithdrawalPayout(readExecutionRow(db, id), db);

    assert.equal(first, "reconciliation_required");
    assert.equal(second, "reconciliation_required");
    assert.equal(transferCalls, 1);
    assert.equal(lookupCalls, 1);
    assert.equal(getCreatorPoints(db, 1), cpBefore);
    assert.equal(getTransferAttemptByWithdrawalId(db, id)?.state, "RECONCILIATION_REQUIRED");
    db.close();
  });

  it("7. confirmed provider failure → CP rollback exactly once", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });

    let transferCalls = 0;
    const provider: PayoutProviderPort = {
      async transfer() {
        transferCalls += 1;
        return {
          resultClass: "failed",
          code: "ACCOUNT_ERROR",
          message: "bad account",
          deduplicated: false,
        };
      },
      async lookup() {
        return { status: "failed", code: "ACCOUNT_ERROR", message: "bad account" };
      },
    };
    setPayoutProviderForTests(provider);

    const outcome = await executeWithdrawalPayout(readExecutionRow(db, id), db);
    assert.equal(outcome, "failed");
    assert.equal(transferCalls, 1);
    assert.equal(getCreatorPoints(db, 1), 10000);

    const logs = db
      .prepare("SELECT COUNT(*) AS c FROM creator_point_logs WHERE user_id=? AND delta > 0")
      .get(1) as { c: number };
    assert.equal(Number(logs.c), 1);

    await assert.rejects(() => executeWithdrawalPayout(readExecutionRow(db, id), db));
    const logsAfter = db
      .prepare("SELECT COUNT(*) AS c FROM creator_point_logs WHERE user_id=? AND delta > 0")
      .get(1) as { c: number };
    assert.equal(Number(logsAfter.c), 1);
    db.close();
  });

  it("8. APPROVED withdrawal never resent", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });
    db.prepare(
      "UPDATE withdrawal_requests SET status='APPROVED', provider_ref='done', processed_at=datetime('now') WHERE id=?"
    ).run(id);

    const provider = createCountingProvider();
    setPayoutProviderForTests(provider);
    await assert.rejects(() => executeWithdrawalPayout(readExecutionRow(db, id), db));
    assert.equal(provider.sendCount, 0);
    db.close();
  });

  it("9. legacy PENDING row executes without withdrawal schema rewrite", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });

    const provider = createCountingProvider();
    setPayoutProviderForTests(provider);
    const rows = listWithdrawalsForExecution(db);
    assert.equal(rows.length, 1);

    const outcome = await executeWithdrawalPayout(rows[0]!, db);
    assert.equal(outcome, "approved");
    assert.equal(provider.sendCount, 1);
    assert.equal(stableProviderRequestId(id), `wd-${id}`);

    const final = db.prepare("SELECT status FROM withdrawal_requests WHERE id=?").get(id) as {
      status: string;
    };
    assert.equal(final.status, "APPROVED");
    db.close();
  });
});
