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
import { processPayoutQueue } from "@/lib/payoutQueue";
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
import { ensurePayoutTransferAttemptsSchema, stableProviderRequestId } from "@/lib/payoutTransferAttempts";
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
        CHECK(status IN ('PENDING','PROCESSING','RECONCILIATION_REQUIRED','APPROVED','REJECTED','FAILED')),
      failure_reason TEXT NOT NULL DEFAULT '',
      provider_ref TEXT NOT NULL DEFAULT '',
      provider_request_id TEXT NOT NULL DEFAULT '',
      claimed_at TEXT,
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

function getCreatorPoints(db: Database.Database, userId: number): number {
  const row = db.prepare("SELECT creator_points FROM users WHERE id=?").get(userId) as
    | { creator_points: number }
    | undefined;
  return roundCreatorAmount(Number(row?.creator_points ?? 0));
}

function createCountingProvider(): PayoutProviderPort & { sendCount: number; keys: string[] } {
  const state = new Map<
    string,
    { resultClass: "success" | "failed" | "unknown"; providerRef?: string; code?: string; message?: string }
  >();
  const port: PayoutProviderPort & { sendCount: number; keys: string[] } = {
    sendCount: 0,
    keys: [],
    async transfer(input: PayoutProviderTransferInput): Promise<PayoutProviderTransferResult> {
      const existing = state.get(input.idempotencyKey);
      if (existing?.resultClass === "success") {
        return {
          resultClass: "success",
          providerRef: existing.providerRef!,
          deduplicated: true,
        };
      }
      if (existing?.resultClass === "failed") {
        return {
          resultClass: "failed",
          code: existing.code!,
          message: existing.message!,
          deduplicated: true,
        };
      }
      if (existing?.resultClass === "unknown") {
        return { resultClass: "unknown", code: existing.code!, message: existing.message! };
      }
      port.sendCount += 1;
      port.keys.push(input.idempotencyKey);
      state.set(input.idempotencyKey, {
        resultClass: "success",
        providerRef: `TEST-${input.idempotencyKey}`,
      });
      return {
        resultClass: "success",
        providerRef: `TEST-${input.idempotencyKey}`,
        deduplicated: false,
      };
    },
    async lookup(idempotencyKey: string): Promise<PayoutProviderLookupResult> {
      const existing = state.get(idempotencyKey);
      if (!existing) return { status: "not_found" };
      if (existing.resultClass === "success") {
        return { status: "success", providerRef: existing.providerRef! };
      }
      if (existing.resultClass === "failed") {
        return { status: "failed", code: existing.code!, message: existing.message! };
      }
      return { status: "unknown" };
    },
  };
  return port;
}

/** Legacy unsafe path mirroring pre-fix main: send before exclusive DB transition. */
async function legacyUnsafeProcessWithdrawal(
  db: Database.Database,
  provider: PayoutProviderPort & { sendCount: number },
  withdrawalId: number
): Promise<void> {
  const row = db
    .prepare(
      `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
              provider_request_id, failure_reason
       FROM withdrawal_requests WHERE id=? AND status='PENDING'`
    )
    .get(withdrawalId) as {
    id: number;
    payout_amount: number;
    account_info: string;
  };
  if (!row) return;
  const account = JSON.parse(row.account_info) as { bankName: string; accountNumber: string };
  await provider.transfer({
    bankCode: "004",
    accountNo: account.accountNumber,
    amount: row.payout_amount,
    idempotencyKey: `legacy-${withdrawalId}-${Date.now()}`,
    withdrawalId: row.id,
  });
  db.prepare(
    `UPDATE withdrawal_requests SET status='APPROVED', provider_ref='legacy', processed_at=datetime('now')
     WHERE id=? AND status='PENDING'`
  ).run(withdrawalId);
}

describe("payout exactly-once — BEFORE reproduction", () => {
  it("CASE-1 legacy ordering: two workers can send before exclusive DB finalize", async () => {
    const provider = createCountingProvider();
    const withdrawalId = 42;
    const accountNo = "123456789012";
    // Pre-fix main: no atomic claim; each worker uses unstable idempotency keys (Date.now).
    await provider.transfer({
      bankCode: "004",
      accountNo,
      amount: 8000,
      idempotencyKey: `legacy-${withdrawalId}-worker-a`,
      withdrawalId,
    });
    await provider.transfer({
      bankCode: "004",
      accountNo,
      amount: 8000,
      idempotencyKey: `legacy-${withdrawalId}-worker-b`,
      withdrawalId,
    });
    assert.equal(
      provider.sendCount,
      2,
      "BEFORE: external send precedes DB finalize and lacks stable idempotency → two sends possible"
    );
  });

  it("CASE-1b legacy race: both workers observe PENDING then both call provider", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });
    const provider = createCountingProvider();
    const pendingRow = db
      .prepare("SELECT id FROM withdrawal_requests WHERE id=? AND status='PENDING'")
      .get(id);
    assert.ok(pendingRow, "both workers would observe PENDING");
    await legacyUnsafeProcessWithdrawal(db, provider, id);
    const stillOrDone = db
      .prepare("SELECT status FROM withdrawal_requests WHERE id=?")
      .get(id) as { status: string };
    assert.equal(stillOrDone.status, "APPROVED");
    await legacyUnsafeProcessWithdrawal(db, provider, id);
    assert.equal(provider.sendCount, 1, "second legacy worker finds no PENDING — serial DB masks race");
    db.close();
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

  it("1. two workers same withdrawal → provider transfer once", async () => {
    const dbPath = path.join(os.tmpdir(), `payout-concurrency-${process.pid}.db`);
    fs.rmSync(dbPath, { force: true });
    const dbA = new Database(dbPath);
    const dbB = new Database(dbPath);
    createPayoutTestSchema(dbA);
    ensurePayoutTransferAttemptsSchema(dbB);
    dbA.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(dbA, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });
    const row = dbA
      .prepare(
        `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
                provider_request_id, failure_reason FROM withdrawal_requests WHERE id=?`
      )
      .get(id) as Parameters<typeof executeWithdrawalPayout>[0];

    const provider = createCountingProvider();
    setPayoutProviderForTests(provider);

    const results = await Promise.all([
      executeWithdrawalPayout(row, dbA),
      executeWithdrawalPayout(row, dbB),
    ]);

    assert.equal(provider.sendCount, 1, "AFTER: effective provider send count = 1");
    assert.ok(results.includes("approved"));
    assert.ok(results.includes("skipped"));
    const final = dbA
      .prepare("SELECT status, provider_ref FROM withdrawal_requests WHERE id=?")
      .get(id) as { status: string; provider_ref: string };
    assert.equal(final.status, "APPROVED");
    assert.ok(final.provider_ref.length > 0);
    dbA.close();
    dbB.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("2. atomic claim — only one winner", () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 1000, payoutAmount: 800 });
    const a = atomicClaimWithdrawal(db, id);
    const b = atomicClaimWithdrawal(db, id);
    assert.equal(a.claimed, true);
    assert.equal(b.claimed, false);
    db.close();
  });

  it("3. provider success + stuck PROCESSING → retry does not second send", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });
    const provider = createCountingProvider();
    setPayoutProviderForTests(provider);
    const providerRequestId = stableProviderRequestId(id);

    const claim = atomicClaimWithdrawal(db, id);
    assert.equal(claim.claimed, true);
    await provider.transfer({
      bankCode: "004",
      accountNo: "123456789012",
      amount: 8000,
      idempotencyKey: providerRequestId,
      withdrawalId: id,
    });
    db.prepare(
      `INSERT INTO payout_transfer_attempts (withdrawal_id, provider_request_id, result_class, provider_ref)
       VALUES (?, ?, 'success', ?)`
    ).run(id, providerRequestId, `TEST-${providerRequestId}`);

    const row = db
      .prepare(
        `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
                provider_request_id, failure_reason FROM withdrawal_requests WHERE id=?`
      )
      .get(id) as Parameters<typeof executeWithdrawalPayout>[0];

    const outcome = await executeWithdrawalPayout(row, db);
    assert.equal(outcome, "approved");
    assert.equal(provider.sendCount, 1);
    const after = db.prepare("SELECT status FROM withdrawal_requests WHERE id=?").get(id) as {
      status: string;
    };
    assert.equal(after.status, "APPROVED");
    db.close();
  });

  it("4. provider unknown → no auto resend, no CP rollback", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 5000)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });
    const cpBefore = getCreatorPoints(db, 1);

    const unknownProvider: PayoutProviderPort = {
      async transfer() {
        return {
          resultClass: "unknown",
          code: "TIMEOUT",
          message: "connection reset",
        };
      },
      async lookup() {
        return { status: "unknown" };
      },
    };
    setPayoutProviderForTests(unknownProvider);

    const row = db
      .prepare(
        `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
                provider_request_id, failure_reason FROM withdrawal_requests WHERE id=?`
      )
      .get(id) as Parameters<typeof executeWithdrawalPayout>[0];

    const outcome = await executeWithdrawalPayout(row, db);
    assert.equal(outcome, "reconciliation_required");
    assert.equal(getCreatorPoints(db, 1), cpBefore);
    const status = db.prepare("SELECT status FROM withdrawal_requests WHERE id=?").get(id) as {
      status: string;
    };
    assert.equal(status.status, "RECONCILIATION_REQUIRED");

    unknownProvider.transfer = async () => {
      throw new Error("must not auto resend");
    };
    const row2 = db
      .prepare(
        `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
                provider_request_id, failure_reason FROM withdrawal_requests WHERE id=?`
      )
      .get(id) as Parameters<typeof executeWithdrawalPayout>[0];
    await executeWithdrawalPayout(row2, db);
    db.close();
  });

  it("5. confirmed provider failure → CP rollback exactly once", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });

    const failProvider: PayoutProviderPort = {
      async transfer() {
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
    setPayoutProviderForTests(failProvider);

    const row = db
      .prepare(
        `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
                provider_request_id, failure_reason FROM withdrawal_requests WHERE id=?`
      )
      .get(id) as Parameters<typeof executeWithdrawalPayout>[0];

    await executeWithdrawalPayout(row, db);
    assert.equal(getCreatorPoints(db, 1), 10000);
    const logs = db
      .prepare("SELECT COUNT(*) AS c FROM creator_point_logs WHERE user_id=? AND delta > 0")
      .get(1) as { c: number };
    assert.equal(Number(logs.c), 1);
    db.close();
  });

  it("6. APPROVED withdrawal never resent", async () => {
    const db = new Database(":memory:");
    createPayoutTestSchema(db);
    db.prepare("INSERT INTO users (id, creator_points) VALUES (1, 0)").run();
    const id = insertPendingWithdrawal(db, { userId: 1, requestedCp: 10000, payoutAmount: 8000 });
    db.prepare(
      `UPDATE withdrawal_requests SET status='APPROVED', provider_ref='done', processed_at=datetime('now') WHERE id=?`
    ).run(id);
    const provider = createCountingProvider();
    setPayoutProviderForTests(provider);
    const row = db
      .prepare(
        `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
                provider_request_id, failure_reason FROM withdrawal_requests WHERE id=?`
      )
      .get(id) as Parameters<typeof executeWithdrawalPayout>[0];
    await assert.rejects(() => executeWithdrawalPayout(row, db));
    assert.equal(provider.sendCount, 0);
    db.close();
  });

  it("7. legacy PENDING row executes through canonical state machine", async () => {
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
    const final = db.prepare("SELECT status FROM withdrawal_requests WHERE id=?").get(id) as {
      status: string;
    };
    assert.equal(final.status, "APPROVED");
    db.close();
  });
});
