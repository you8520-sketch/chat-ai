import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { getDb } from "./db";
import {
  calcWithdrawalBreakdown,
  WITHDRAWAL_MIN_CP,
  WITHDRAWAL_PAYOUT_RATE,
  WITHDRAWAL_PLATFORM_RETAINED_RATE,
  WITHDRAWAL_TOTAL_DEDUCTION_RATE,
  WITHDRAWAL_WITHHOLDING_RATE,
} from "./creatorShared";
import { toExportRow } from "./payoutExport";
import {
  listAdminPayoutApplications,
  previewApprovedPayoutTaxes,
  toAdminPayoutApplicationRow,
} from "./adminPayout";
import { buildAdminFinanceSummary } from "./adminFinance";
import { ensureProviderCostLedgerSchema } from "./providerCostLedger";
import { requestCreatorWithdrawal } from "./creatorPoints";
import { encryptSensitive } from "./fieldEncryption";
import {
  listPendingWithdrawals,
  processSingleWithdrawal,
} from "./payoutQueue";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL } from "./chatModels";
import { exchangeCreatorPoints } from "./creatorPoints";

const TAG = `potest_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

const accountJson = JSON.stringify({
  bankName: "국민은행",
  accountNumber: "123456789012",
  accountHolder: "홍길동",
  accountMasked: "********9012",
});

function financeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      usage TEXT,
      deduction_slices TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_refunded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE point_gifts (
      id INTEGER PRIMARY KEY,
      paid_fee_amount REAL NOT NULL DEFAULT 0,
      free_fee_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE creator_earnings (
      id INTEGER PRIMARY KEY,
      reward_amount REAL NOT NULL DEFAULT 0,
      reversed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE withdrawal_requests (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 0,
      requested_cp REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      platform_fee REAL NOT NULL DEFAULT 0,
      payout_amount REAL NOT NULL DEFAULT 0,
      account_info TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE portone_checkouts (
      id INTEGER PRIMARY KEY,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT
    );
    CREATE TABLE chat_image_generations (
      id INTEGER PRIMARY KEY,
      upstream_cost_usd REAL,
      deduction_slices TEXT,
      exchange_rate_krw_per_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function previewDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      nickname TEXT NOT NULL,
      real_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      requested_cp REAL NOT NULL,
      tax_amount REAL NOT NULL,
      platform_fee REAL NOT NULL,
      payout_amount INTEGER NOT NULL,
      account_info TEXT NOT NULL,
      status TEXT NOT NULL,
      failure_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
  `);
  db.prepare("INSERT INTO users (id, email, nickname, real_name) VALUES (1, 'a@test.com', '작가A', '홍길동')").run();
  return db;
}

function createDevUser(suffix: string): { id: number; email: string } {
  const db = getDb();
  const email = `${TAG}_${suffix}@potest.local`;
  const nickname = `${TAG}_${suffix}`;
  db.prepare("DELETE FROM users WHERE email=?").run(email);
  const row = db
    .prepare(
      "INSERT INTO users (email, nickname, pw_hash, points, is_adult, real_name, creator_points) VALUES (?,?,?,0,1,?,0)"
    )
    .run(email, nickname, "x", "홍길동");
  return { id: Number(row.lastInsertRowid), email };
}

function deleteDevUser(id: number, email: string) {
  const db = getDb();
  db.prepare("DELETE FROM withdrawal_requests WHERE user_id=?").run(id);
  db.prepare("DELETE FROM creator_point_logs WHERE user_id=?").run(id);
  db.prepare("DELETE FROM users WHERE id=?").run(id);
  void email;
}

after(() => {
  const db = getDb();
  const ids = (
    db.prepare("SELECT id FROM users WHERE email LIKE '%@potest.local'").all() as { id: number }[]
  ).map((row) => row.id);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM withdrawal_requests WHERE user_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM creator_point_logs WHERE user_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids);
});

describe("payout policy unification — canonical breakdown (80 / 3.3 / 16.7)", () => {
  it("PAYOUT-EXACT-10000 base 10000 splits into 8000 + 330 + 1670", () => {
    assert.deepEqual(calcWithdrawalBreakdown(10000), {
      requestedCp: 10000,
      taxAmount: 330,
      platformFee: 1670,
      payoutAmount: 8000,
    });
  });

  it("PAYOUT-IDENTITY-LOOP base === payout + withholding + retained for every amount", () => {
    for (const base of [30000, 30001, 30002, 50000, 100000, 100001, 1000000, 1234567]) {
      const b = calcWithdrawalBreakdown(base);
      assert.equal(
        b.payoutAmount + b.taxAmount + b.platformFee,
        b.requestedCp,
        `identity holds for base=${base}`
      );
      assert.ok(Number.isInteger(b.payoutAmount), `payout is integer won for base=${base}`);
    }
  });

  it("PAYOUT-MINIMUM base 30000 splits into 24000 + 990 + 5010", () => {
    assert.deepEqual(calcWithdrawalBreakdown(WITHDRAWAL_MIN_CP), {
      requestedCp: 30000,
      taxAmount: 990,
      platformFee: 5010,
      payoutAmount: 24000,
    });
  });

  it("PAYOUT-RATE-RELATIONS 20/3.3/16.7/80 are derived, never independent duplicates", () => {
    assert.equal(WITHDRAWAL_TOTAL_DEDUCTION_RATE, 0.2);
    assert.equal(WITHDRAWAL_WITHHOLDING_RATE, 0.033);
    assert.equal(
      WITHDRAWAL_PLATFORM_RETAINED_RATE,
      WITHDRAWAL_TOTAL_DEDUCTION_RATE - WITHDRAWAL_WITHHOLDING_RATE
    );
    assert.equal(WITHDRAWAL_PAYOUT_RATE, 1 - WITHDRAWAL_TOTAL_DEDUCTION_RATE);
    const pct = (r: number) => Math.round(r * 1000) / 10;
    assert.equal(pct(WITHDRAWAL_WITHHOLDING_RATE), 3.3);
    assert.equal(pct(WITHDRAWAL_PLATFORM_RETAINED_RATE), 16.7);
    assert.equal(pct(WITHDRAWAL_PAYOUT_RATE), 80);
  });

  it("PAYOUT-FRACTIONAL-CP fractional requests floor to whole won with exact identity", () => {
    const b = calcWithdrawalBreakdown(30000.9);
    assert.equal(b.requestedCp, 30000);
    assert.equal(b.payoutAmount + b.taxAmount + b.platformFee, 30000);
  });
});

describe("payout policy unification — withholding split display (national + local = total)", () => {
  it("TAX-SPLIT-330 total 330 displays as national 300 + local 30", () => {
    const row = toExportRow({
      id: 1,
      user_id: 1,
      requested_cp: 10000,
      tax_amount: 330,
      payout_amount: 8000,
      account_info: accountJson,
      processed_at: "2026-08-15 03:00:00",
      resident_number: "",
      real_name: "홍길동",
      resident_id: null,
      nickname: "작가A",
    });
    assert.equal(row.grossAmount, 10000);
    assert.equal(row.nationalTax, 300);
    assert.equal(row.localTax, 30);
    assert.equal(row.netPayout, 8000);
    assert.equal(row.nationalTax + row.localTax, 330);
    assert.equal(row.netPayout + row.nationalTax + row.localTax + 1670, row.grossAmount);
  });

  it("TAX-SPLIT-OLD-880 stored total 8800-era semantics stay structural (8000 + 800)", () => {
    const row = toExportRow({
      id: 2,
      user_id: 1,
      requested_cp: 100000,
      tax_amount: 8800,
      payout_amount: 80000,
      account_info: accountJson,
      processed_at: "2026-08-15 03:00:00",
      resident_number: "",
      real_name: "홍길동",
      resident_id: null,
      nickname: "작가A",
    });
    assert.equal(row.nationalTax, 8000);
    assert.equal(row.localTax, 800);
    assert.equal(row.nationalTax + row.localTax, 8800);
  });

  it("PREVIEW-SPLIT approved rows aggregate without re-rating snapshots", () => {
    const db = previewDb();
    db.prepare(
      `INSERT INTO withdrawal_requests
        (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, created_at, processed_at)
       VALUES
        (1, 10000, 330, 1670, 8000, ?, 'APPROVED', '2026-08-02 10:00:00', '2026-08-15 03:00:00'),
        (1, 100000, 8800, 11200, 80000, ?, 'APPROVED', '2026-08-03 10:00:00', '2026-08-15 03:01:00')`
    ).run(accountJson, accountJson);
    const preview = previewApprovedPayoutTaxes(db, 2026, 8);
    assert.equal(preview.count, 2);
    assert.equal(preview.grossAmount, 110000);
    assert.equal(preview.nationalTax, 8300);
    assert.equal(preview.localTax, 830);
    assert.equal(preview.netPayout, 88000);
    assert.equal(preview.nationalTax + preview.localTax, 330 + 8800);
    db.close();
  });
});

describe("payout policy unification — finance single-count proof", () => {
  it("FINANCE-NO-DOUBLE-COUNT platform 16.7% and tax 3.3% never enter revenue", () => {
    const db = financeDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, usage, deduction_slices, created_at, is_refunded)
       VALUES (1, 1, 'assistant', '{}', ?, datetime('now'), 0)`
    ).run(JSON.stringify([{ pointType: "PAID", amount: 100000 }]));
    db.prepare(
      `INSERT INTO withdrawal_requests
        (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, processed_at, created_at)
       VALUES (1, 10000, 330, 1670, 8000, ?, 'APPROVED', datetime('now'), datetime('now'))`
    ).run(accountJson);

    const summary = buildAdminFinanceSummary(db);
    const view = summary as unknown as Record<string, unknown>;
    assert.equal(summary.chat.paidRevenueKrw, 100000);
    assert.equal(summary.giftFeeRevenueKrw, 0);
    assert.equal(summary.paidPointsConsumed, 100000);
    assert.equal(view.creatorTaxPayableKrw, 330);
    assert.equal(view.creatorPlatformRetainedKrw, 1670);
    assert.equal(summary.creatorPayoutCashKrw, 8000);
    db.close();
  });
});

describe("payout policy unification — historical snapshot preservation", () => {
  it("HISTORICAL-SNAPSHOT old finalized rows keep stored amounts, never re-rated", () => {
    const row = toAdminPayoutApplicationRow({
      id: 9,
      user_id: 3,
      requested_cp: 100000,
      tax_amount: 8800,
      platform_fee: 11200,
      payout_amount: 80000,
      account_info: accountJson,
      status: "APPROVED",
      failure_reason: "",
      created_at: "2026-08-02",
      processed_at: "2026-08-15",
      nickname: "작가A",
      email: "a@test.com",
      real_name: "홍길동",
    });
    assert.equal(row.requestedCp, 100000);
    assert.equal(row.taxAmount, 8800);
    assert.equal(row.platformFee, 11200);
    assert.equal(row.payoutAmount, 80000);
  });

  it("HISTORICAL-LIST approved rows read snapshots verbatim", () => {
    const db = previewDb();
    db.prepare(
      `INSERT INTO withdrawal_requests
        (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, created_at, processed_at)
       VALUES (1, 100000, 8800, 11200, 80000, ?, 'APPROVED', '2026-08-02 10:00:00', '2026-08-15 03:00:00')`
    ).run(accountJson);
    const rows = listAdminPayoutApplications(db, "APPROVED");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.taxAmount, 8800);
    assert.equal(rows[0]!.platformFee, 11200);
    assert.equal(rows[0]!.payoutAmount, 80000);
    db.close();
  });
});

describe("payout policy unification — pending snapshot lock", () => {
  it("PENDING-SNAPSHOT-LOCK approve pays the locked snapshot, never recalculates", async () => {
    const user = createDevUser("pending");
    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO withdrawal_requests
          (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status)
         VALUES (?, 30000, 2640, 3360, 24000, ?, 'PENDING')`
      ).run(user.id, accountJson);
      const row = listPendingWithdrawals().find((r) => r.user_id === user.id);
      assert.ok(row, "pending row visible to the payout queue");

      const outcome = await processSingleWithdrawal(row!);
      assert.equal(outcome, "approved");
      const after = db
        .prepare("SELECT status, payout_amount, provider_ref FROM withdrawal_requests WHERE id=?")
        .get(row!.id) as { status: string; payout_amount: number; provider_ref: string };
      assert.equal(after.status, "APPROVED");
      assert.equal(after.payout_amount, 24000, "locked snapshot honored, not recalculated");
      assert.ok(after.provider_ref.length > 0);

      await assert.rejects(
        processSingleWithdrawal({ ...row!, status: "APPROVED" }),
        "duplicate approve guarded"
      );
    } finally {
      deleteDevUser(user.id, user.email);
    }
  });
});

describe("payout policy unification — request path validation", () => {  it("REQUEST-PATH stores the canonical snapshot and debits CP in full", () => {
    const user = createDevUser("request");
    const db = getDb();
    try {
      db.prepare("UPDATE users SET creator_points = 100000 WHERE id=?").run(user.id);
      const result = requestCreatorWithdrawal(
        user.id,
        30000,
        { bankName: "국민은행", accountNumber: "123456789012", accountHolder: "홍길동" },
        {
          residentNumberEncrypted: encryptSensitive("9001011234567"),
          taxConsent: true,
          verifiedRealName: "홍길동",
        }
      );
      assert.equal(result.requestedCp, 30000);
      assert.equal(result.taxAmount, 990);
      assert.equal(result.platformFee, 5010);
      assert.equal(result.payoutAmount, 24000);
      const stored = db
        .prepare(
          "SELECT requested_cp, tax_amount, platform_fee, payout_amount, status FROM withdrawal_requests WHERE id=?"
        )
        .get(result.withdrawalId) as {
        requested_cp: number;
        tax_amount: number;
        platform_fee: number;
        payout_amount: number;
        status: string;
      };
      assert.deepEqual(
        [stored.requested_cp, stored.tax_amount, stored.platform_fee, stored.payout_amount],
        [30000, 990, 5010, 24000]
      );
      assert.equal(stored.status, "PENDING");
      const balance = (
        db.prepare("SELECT creator_points FROM users WHERE id=?").get(user.id) as {
          creator_points: number;
        }
      ).creator_points;
      assert.equal(balance, 70000);

      assert.throws(
        () =>
          requestCreatorWithdrawal(
            user.id,
            30000,
            { bankName: "국민은행", accountNumber: "123456789012", accountHolder: "홍길동" },
            {
              residentNumberEncrypted: encryptSensitive("9001011234567"),
              taxConsent: true,
              verifiedRealName: "홍길동",
            }
          ),
        "duplicate pending guarded"
      );
      assert.throws(
        () =>
          requestCreatorWithdrawal(
            user.id,
            1000,
            { bankName: "국민은행", accountNumber: "123456789012", accountHolder: "홍길동" },
            {
              residentNumberEncrypted: encryptSensitive("9001011234567"),
              taxConsent: true,
              verifiedRealName: "홍길동",
            }
          ),
        "minimum guarded"
      );
    } finally {
      deleteDevUser(user.id, user.email);
    }
  });
});

describe("payout settlement adjustment — creator accrual vs cash withdrawal", () => {
  function settlementDb(opts: {
    revenue: number;
    accrued: number;
    withdrawal?: { requested: number; tax: number; fee: number; payout: number };
  }): Database.Database {
    const db = financeDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, usage, deduction_slices, created_at, is_refunded)
       VALUES (1, 1, 'assistant', ?, ?, datetime('now'), 0)`
    ).run(
      JSON.stringify({ model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL }),
      JSON.stringify([{ pointType: "PAID", amount: opts.revenue }])
    );
    if (opts.accrued > 0) {
      db.prepare(
        `INSERT INTO creator_earnings (reward_amount, reversed, created_at)
         VALUES (?, 0, datetime('now'))`
      ).run(opts.accrued);
    }
    if (opts.withdrawal) {
      const w = opts.withdrawal;
      db.prepare(
        `INSERT INTO withdrawal_requests
          (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, processed_at, created_at)
         VALUES (1, ?, ?, ?, ?, ?, 'APPROVED', datetime('now'), datetime('now'))`
      ).run(w.requested, w.tax, w.fee, w.payout, accountJson);
    }
    return db;
  }

  it("SETTLE-A same-period withdrawal reverses retained into net profit (75010, not 70000)", () => {
    const db = settlementDb({
      revenue: 100000,
      accrued: 30000,
      withdrawal: { requested: 30000, tax: 990, fee: 5010, payout: 24000 },
    });
    try {
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.chat.paidRevenueKrw, 100000);
      assert.equal(summary.chat.creatorCostKrw, 30000);
      assert.equal(summary.netProfitKrw, 75010);
    } finally {
      db.close();
    }
  });

  it("SETTLE-B retained is reflected exactly once — revenue untouched", () => {
    const db = settlementDb({
      revenue: 100000,
      accrued: 30000,
      withdrawal: { requested: 30000, tax: 990, fee: 5010, payout: 24000 },
    });
    try {
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.chat.paidRevenueKrw, 100000);
      assert.equal(summary.giftFeeRevenueKrw, 0);
      assert.equal(summary.paidPointsConsumed, 100000);
      const view = summary as unknown as Record<string, unknown>;
      assert.equal(view.creatorPlatformRetainedKrw, 5010);
      assert.equal(
        summary.netProfitKrw,
        100000 - 30000 + 5010,
        "retained adjustment applied exactly once to net profit only"
      );
    } finally {
      db.close();
    }
  });

  it("SETTLE-C withholding tax is not double-costed (effective creator cost 24990)", () => {
    const db = settlementDb({
      revenue: 100000,
      accrued: 30000,
      withdrawal: { requested: 30000, tax: 990, fee: 5010, payout: 24000 },
    });
    try {
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.netProfitKrw, 75010);
      assert.equal(
        100000 - (summary.netProfitKrw as number),
        24990,
        "effective creator cost = payout 24000 + withholding 990, tax never subtracted twice"
      );
    } finally {
      db.close();
    }
  });

  it("SETTLE-D PAID 1:1 exchange creates no withdrawal and no retained adjustment", () => {
    const user = createDevUser("exchange");
    const db = getDb();
    try {
      db.prepare("UPDATE users SET creator_points = 50000 WHERE id=?").run(user.id);
      const result = exchangeCreatorPoints(user.id, 10000);
      assert.equal(result.exchanged, 10000);
      const withdrawals = db
        .prepare("SELECT COUNT(*) AS c FROM withdrawal_requests WHERE user_id=?")
        .get(user.id) as { c: number };
      assert.equal(withdrawals.c, 0, "exchange never writes a withdrawal snapshot");
      const balance = (
        db.prepare("SELECT creator_points FROM users WHERE id=?").get(user.id) as {
          creator_points: number;
        }
      ).creator_points;
      assert.equal(balance, 40000);
    } finally {
      deleteDevUser(user.id, user.email);
    }
  });

  it("SETTLE-E snapshot owner: stored platform_fee is consumed directly (non-derivable 12345)", () => {
    // Deterministic snapshot-owner fixture - the stored fee is deliberately
    // NOT derivable (requested - payout - tax = 11200, current rate = 16700).
    // Finance must use stored platform_fee = 12345. Either recomputation
    // fails this test.
    const db = settlementDb({
      revenue: 200000,
      accrued: 100000,
      withdrawal: { requested: 100000, tax: 8800, fee: 12345, payout: 80000 },
    });
    try {
      const summary = buildAdminFinanceSummary(db);
      const view = summary as unknown as Record<string, unknown>;
      assert.equal(view.creatorPlatformRetainedKrw, 12345);
      assert.equal(
        summary.netProfitKrw,
        200000 - 100000 + 12345,
        "stored snapshot honored exactly once in net profit"
      );
    } finally {
      db.close();
    }
  });

  it("SETTLE-F accrual without approved withdrawal adjusts nothing (70000)", () => {
    const db = settlementDb({ revenue: 100000, accrued: 30000 });
    try {
      const summary = buildAdminFinanceSummary(db);
      const view = summary as unknown as Record<string, unknown>;
      assert.equal(view.creatorPlatformRetainedKrw, 0);
      assert.equal(view.creatorTaxPayableKrw, 0);
      assert.equal(summary.netProfitKrw, 70000);
    } finally {
      db.close();
    }
  });
});
