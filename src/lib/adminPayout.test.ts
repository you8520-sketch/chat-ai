import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  countAdminPayoutApplications,
  listAdminPayoutApplications,
  parseAdminPayoutStatusFilter,
  previewApprovedPayoutTaxes,
  toAdminPayoutApplicationRow,
} from "./adminPayout";
import { calcLocalTax } from "./payoutSchedule";

function setupDb() {
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
  db.prepare("INSERT INTO users (id, email, nickname, real_name) VALUES (2, 'b@test.com', '작가B', '김정산')").run();
  return db;
}

const accountA = JSON.stringify({
  bankName: "국민은행",
  accountNumber: "123456789012",
  accountHolder: "홍길동",
  accountMasked: "********9012",
});

describe("parseAdminPayoutStatusFilter", () => {
  it("accepts known statuses and defaults to all", () => {
    assert.equal(parseAdminPayoutStatusFilter("pending"), "PENDING");
    assert.equal(parseAdminPayoutStatusFilter("APPROVED"), "APPROVED");
    assert.equal(parseAdminPayoutStatusFilter("nope"), "all");
    assert.equal(parseAdminPayoutStatusFilter(null), "all");
  });
});

describe("admin payout application list", () => {
  it("lists applications without resident or full account numbers", () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO withdrawal_requests
        (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, created_at, processed_at)
       VALUES (1, 100000, 8800, 11200, 80000, ?, 'PENDING', '2026-08-01 10:00:00', NULL)`
    ).run(accountA);

    const rows = listAdminPayoutApplications(db, "all");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].creatorName, "홍길동");
    assert.equal(rows[0].status, "PENDING");
    assert.equal(rows[0].accountMasked, "********9012");
    assert.equal(rows[0].bankName, "국민은행");
    assert.doesNotMatch(JSON.stringify(rows[0]), /123456789012/);
    assert.doesNotMatch(JSON.stringify(rows[0]), /resident/i);
    assert.equal(countAdminPayoutApplications(db).pending, 1);
  });

  it("filters by status and previews tax totals for approved month", () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO withdrawal_requests
        (user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, created_at, processed_at)
       VALUES
        (1, 100000, 8800, 11200, 80000, ?, 'APPROVED', '2026-08-02 10:00:00', '2026-08-15 03:00:00'),
        (2, 50000, 4400, 5600, 40000, ?, 'FAILED', '2026-08-03 10:00:00', '2026-08-15 03:01:00')`
    ).run(accountA, accountA);

    assert.equal(listAdminPayoutApplications(db, "APPROVED").length, 1);
    assert.equal(listAdminPayoutApplications(db, "FAILED")[0].userId, 2);

    const preview = previewApprovedPayoutTaxes(db, 2026, 8);
    assert.equal(preview.count, 1);
    assert.equal(preview.grossAmount, 100000);
    assert.equal(preview.nationalTax, 8800);
    assert.equal(preview.localTax, calcLocalTax(8800));
    assert.equal(preview.netPayout, 80000);
    assert.equal(previewApprovedPayoutTaxes(db, 2026, 7).count, 0);
  });

  it("maps missing real name to account holder", () => {
    const row = toAdminPayoutApplicationRow({
      id: 9,
      user_id: 3,
      requested_cp: 30000,
      tax_amount: 2640,
      platform_fee: 3360,
      payout_amount: 24000,
      account_info: accountA,
      status: "PENDING",
      failure_reason: "",
      created_at: "2026-08-24",
      processed_at: null,
      nickname: "닉",
      email: "n@test.com",
      real_name: "",
    });
    assert.equal(row.creatorName, "홍길동");
    assert.equal(row.accountLabel.includes("국민은행"), true);
  });
});
