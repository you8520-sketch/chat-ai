import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { ATTENDANCE_POINTS_VALID_DAYS } from "@/lib/attendanceConstants";
import {
  BUSINESS_IDENTITY_VERIFICATION,
  BUSINESS_PUBLIC_LINES,
  BUSINESS_REGISTRATION_NUMBER,
  BUSINESS_TRADE_NAME,
  SERVICE_PUBLIC_NAME,
  SERVICE_PUBLIC_ORIGIN,
} from "@/lib/businessIdentity";
import { TERMS_PAGE } from "@/lib/legalPages";
import { creditPointChargePackage } from "@/lib/pointCharge";
import { executePointChargeRefund } from "@/lib/pointChargeRefundExecution";
import { setPointChargeRefundProviderForTests } from "@/lib/pointChargeRefundGateway";
import {
  formatPointChargePackagePublicLine,
  FREE_POINTS_VALID_YEARS,
  isPointChargePackageId,
  PAID_POINTS_VALID_YEARS,
  POINT_CHARGE_PACKAGES,
  POINT_CHARGE_PACKAGES_BY_ID,
  pointChargePackageBonusPercent,
  pointChargePackageTotalPoints,
  type PointChargePackageId,
} from "@/lib/plans";
import {
  ensurePortoneCheckoutTable,
  markPortoneCheckoutPaid,
} from "@/lib/portoneCheckout";
import { finalizePortoneCheckoutFromProvider } from "@/lib/portonePaidFinalizer";
import { setPortOnePaymentLookupForTests } from "@/lib/portoneServer";
import { getPointBalanceOnDb } from "@/lib/points";

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
  db.prepare("INSERT INTO users (id, points) VALUES (1, 0)").run();
  return db;
}

function daysBetween(fromText: string, toText: string): number {
  const from = new Date(fromText.replace(" ", "T") + "Z").getTime();
  const to = new Date(toText.replace(" ", "T") + "Z").getTime();
  return (to - from) / 86400000;
}

function pageText(page: {
  intro: readonly string[];
  sections: readonly { heading: string; paragraphs: readonly string[] }[];
}): string {
  return [page.intro.join("\n"), ...page.sections.flatMap((section) => [section.heading, ...section.paragraphs])].join(
    "\n"
  );
}

const EXPECTED_PACKAGES: Array<{
  id: PointChargePackageId;
  price: number;
  paidPoints: number;
  bonusPoints: number;
  bonusPercent: number;
  total: number;
}> = [
  { id: "p5000", price: 5000, paidPoints: 5000, bonusPoints: 0, bonusPercent: 0, total: 5000 },
  { id: "p10000", price: 10000, paidPoints: 10000, bonusPoints: 0, bonusPercent: 0, total: 10000 },
  { id: "p30000", price: 30000, paidPoints: 30000, bonusPoints: 900, bonusPercent: 3, total: 30900 },
  { id: "p50000", price: 50000, paidPoints: 50000, bonusPoints: 2500, bonusPercent: 5, total: 52500 },
  { id: "p100000", price: 100000, paidPoints: 100000, bonusPoints: 7000, bonusPercent: 7, total: 107000 },
];

afterEach(() => {
  setPortOnePaymentLookupForTests(null);
  setPointChargeRefundProviderForTests(null);
});

describe("point charge catalog — five packages", () => {
  it("keeps one catalog owner with matching price, paid, bonus, and totals", () => {
    assert.equal(POINT_CHARGE_PACKAGES.length, 5);
    assert.deepEqual(
      POINT_CHARGE_PACKAGES.map((pkg) => pkg.id),
      EXPECTED_PACKAGES.map((pkg) => pkg.id)
    );
    for (const expected of EXPECTED_PACKAGES) {
      const pkg = POINT_CHARGE_PACKAGES_BY_ID[expected.id];
      assert.equal(pkg.price, expected.price);
      assert.equal(pkg.paidPoints, expected.paidPoints);
      assert.equal(pkg.bonusPoints, expected.bonusPoints);
      assert.equal(pointChargePackageTotalPoints(pkg), expected.total);
      assert.equal(pointChargePackageBonusPercent(pkg), expected.bonusPercent);
    }
  });

  it("does not keep retired package ids that would collide with the new definitions", () => {
    assert.equal(isPointChargePackageId("p10500"), false);
    assert.equal(isPointChargePackageId("p55000"), false);
    assert.equal(isPointChargePackageId("p115000"), false);
    assert.equal(isPointChargePackageId("p30000"), true);
  });
});

describe("point charge catalog — credit and expiry", () => {
  it("credits paid and bonus lots from the catalog and keeps 1-year expiry", () => {
    const db = setupDb();
    db.transaction(() => {
      creditPointChargePackage(db, 1, "p30000", "포인트 충전 (PortOne)", { portoneCheckoutId: null });
    })();

    const lots = db
      .prepare(
        "SELECT point_type, remaining_amount, expires_at, created_at FROM point_transactions WHERE user_id=1 ORDER BY id"
      )
      .all() as Array<{
      point_type: string;
      remaining_amount: number;
      expires_at: string;
      created_at: string;
    }>;
    assert.equal(lots.length, 2);
    assert.equal(lots[0]!.point_type, "PAID");
    assert.equal(lots[0]!.remaining_amount, 30000);
    assert.equal(lots[1]!.point_type, "FREE");
    assert.equal(lots[1]!.remaining_amount, 900);
    assert.ok(Math.abs(daysBetween(lots[0]!.created_at, lots[0]!.expires_at) - 365) < 4);
    assert.ok(Math.abs(daysBetween(lots[1]!.created_at, lots[1]!.expires_at) - 365) < 4);
    assert.equal(PAID_POINTS_VALID_YEARS, 1);
    assert.equal(FREE_POINTS_VALID_YEARS, 1);

    const balance = getPointBalanceOnDb(db, 1);
    assert.equal(balance.paid, 30000);
    assert.equal(balance.free, 900);
    assert.equal(balance.total, 30900);
    db.close();
  });

  it("zero-bonus packages do not insert a free lot", () => {
    const db = setupDb();
    db.transaction(() => {
      creditPointChargePackage(db, 1, "p10000", "포인트 충전 (PortOne)");
    })();
    const types = db
      .prepare("SELECT point_type FROM point_transactions WHERE user_id=1")
      .all() as Array<{ point_type: string }>;
    assert.deepEqual(
      types.map((row) => row.point_type),
      ["PAID"]
    );
    assert.equal(getPointBalanceOnDb(db, 1).total, 10000);
    db.close();
  });
});

describe("point charge catalog — payment guards", () => {
  it("rejects a tampered provider amount and does not credit", async () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO portone_checkouts (user_id, package_id, payment_id, amount, status)
       VALUES (1, 'p5000', 'pay-tamper', 5000, 'pending')`
    ).run();
    setPortOnePaymentLookupForTests(async () => ({
      status: "PAID",
      paymentId: "pay-tamper",
      txId: "tx-tamper",
      totalAmount: 10000,
      cancellations: [],
    }));

    const result = await finalizePortoneCheckoutFromProvider("pay-tamper", { db });
    assert.deepEqual(result, { ok: false, status: "amount_mismatch" });
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    const checkout = db
      .prepare("SELECT status FROM portone_checkouts WHERE payment_id='pay-tamper'")
      .get() as { status: string };
    assert.equal(checkout.status, "pending");
    db.close();
  });

  it("rejects retired package ids left on pending checkouts", () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO portone_checkouts (user_id, package_id, payment_id, amount, status)
       VALUES (1, 'p10500', 'pay-old', 10000, 'pending')`
    ).run();
    const result = markPortoneCheckoutPaid("pay-old", "tx-old", db);
    assert.deepEqual(result, { ok: false, error: "상품 정보가 유효하지 않습니다." });
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("finalizes a matching paid checkout only once for webhook and complete", async () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO portone_checkouts (user_id, package_id, payment_id, amount, status)
       VALUES (1, 'p50000', 'pay-once', 50000, 'pending')`
    ).run();
    setPortOnePaymentLookupForTests(async () => ({
      status: "PAID",
      paymentId: "pay-once",
      txId: "tx-once",
      totalAmount: 50000,
      cancellations: [],
    }));

    const first = await finalizePortoneCheckoutFromProvider("pay-once", { db });
    const second = await finalizePortoneCheckoutFromProvider("pay-once", { db });
    assert.deepEqual(first, { ok: true, status: "paid", alreadyPaid: false });
    assert.deepEqual(second, { ok: true, status: "already_paid" });

    const balance = getPointBalanceOnDb(db, 1);
    assert.equal(balance.paid, 50000);
    assert.equal(balance.free, 2500);
    assert.equal(balance.total, 52500);
    const txCount = db.prepare("SELECT COUNT(*) AS c FROM point_transactions WHERE user_id=1").get() as {
      c: number;
    };
    assert.equal(txCount.c, 2);
    db.close();
  });

  it("refunds both paid and bonus lots from a catalog charge", async () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO portone_checkouts (user_id, package_id, payment_id, amount, status)
       VALUES (1, 'p30000', 'pay-refund', 30000, 'pending')`
    ).run();
    const marked = markPortoneCheckoutPaid("pay-refund", "tx-refund", db);
    assert.deepEqual(marked, { ok: true, alreadyPaid: false });
    assert.equal(getPointBalanceOnDb(db, 1).total, 30900);

    const log = db
      .prepare("SELECT id FROM point_logs WHERE user_id=1 AND reason LIKE '포인트 충전%'")
      .get() as { id: number };
    setPointChargeRefundProviderForTests({
      async cancel() {
        return { resultClass: "success", cancellationId: "cn-catalog", providerStatus: "SUCCEEDED" };
      },
      async lookup() {
        return { status: "success", cancellationId: "cn-catalog", providerStatus: "SUCCEEDED" };
      },
    });

    const refunded = await executePointChargeRefund(1, log.id, db);
    assert.equal(refunded.ok, true);
    assert.equal(refunded.status, "refunded");
    const balance = getPointBalanceOnDb(db, 1);
    assert.equal(balance.paid, 0);
    assert.equal(balance.free, 0);
    assert.equal(balance.total, 0);
    db.close();
  });
});

describe("point charge catalog — public disclosure", () => {
  it("publishes confirmed business fields and all five products without login", () => {
    const text = pageText(TERMS_PAGE);
    assert.match(text, new RegExp(SERVICE_PUBLIC_NAME));
    assert.match(text, new RegExp(SERVICE_PUBLIC_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, new RegExp(BUSINESS_TRADE_NAME));
    assert.match(text, new RegExp(BUSINESS_REGISTRATION_NUMBER));
    for (const line of BUSINESS_PUBLIC_LINES) {
      assert.match(text, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    for (const pkg of POINT_CHARGE_PACKAGES) {
      assert.match(text, new RegExp(formatPointChargePackagePublicLine(pkg).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(text, new RegExp(`${ATTENDANCE_POINTS_VALID_DAYS}일`));

    const termsPage = readFileSync(new URL("../app/terms/page.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(termsPage, /getSessionUser|redirect\(/);

    const pointsPage = readFileSync(new URL("../app/points/page.tsx", import.meta.url), "utf8");
    const pointsClient = readFileSync(new URL("../app/points/PointsClient.tsx", import.meta.url), "utf8");
    assert.match(pointsPage, /getSessionUser/);
    assert.match(pointsClient, /포인트 상품/);
    assert.match(pointsClient, /POINT_CHARGE_PACKAGES\.map/);
    assert.match(pointsClient, /paymentsEnabled && portoneEnabled/);
    assert.match(pointsClient, /<article key=\{p\.id\}/);
    assert.doesNotMatch(pointsClient, /SiteLegalFooter|BUSINESS_PUBLIC_LINES/);

    assert.equal(BUSINESS_IDENTITY_VERIFICATION.tradeName, "confirmed");
    assert.equal(BUSINESS_IDENTITY_VERIFICATION.representativeName, "confirmed");
    assert.equal(BUSINESS_IDENTITY_VERIFICATION.businessAddress, "confirmed");
    assert.equal(BUSINESS_IDENTITY_VERIFICATION.phoneNumber, "unverified");
    assert.equal(BUSINESS_IDENTITY_VERIFICATION.customerServiceEmail, "confirmed");
    assert.equal(BUSINESS_IDENTITY_VERIFICATION.mailOrderReportNumber, "unverified");
  });
});
