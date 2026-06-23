import crypto from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { POINT_CHARGE_PACKAGES_BY_ID, type PointChargePackageId } from "@/lib/plans";
import { creditPointChargePackage } from "@/lib/pointCharge";

export type PortoneCheckoutStatus = "pending" | "paid" | "failed";

export type PortoneCheckoutRow = {
  id: number;
  user_id: number;
  package_id: string;
  payment_id: string;
  amount: number;
  status: PortoneCheckoutStatus;
  portone_tx_id: string;
  created_at: string;
  paid_at: string | null;
};

export function ensurePortoneCheckoutTable(db: Database.Database = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portone_checkouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      package_id TEXT NOT NULL,
      payment_id TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed')),
      portone_tx_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_portone_checkouts_user
      ON portone_checkouts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_portone_checkouts_status
      ON portone_checkouts(status, created_at DESC);
  `);
}

export function createPortoneCheckout(userId: number, packageId: PointChargePackageId) {
  const pkg = POINT_CHARGE_PACKAGES_BY_ID[packageId];
  if (!pkg) return { ok: false as const, error: "잘못된 상품입니다.", status: 400 };

  const db = getDb();
  ensurePortoneCheckoutTable(db);

  const paymentId = `pt-${userId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  db.prepare(
    `INSERT INTO portone_checkouts (user_id, package_id, payment_id, amount, status)
     VALUES (?, ?, ?, ?, 'pending')`
  ).run(userId, packageId, paymentId, pkg.price);

  const totalPoints = pkg.paidPoints + pkg.bonusPoints;
  const orderName = `포인트 ${totalPoints.toLocaleString()}P 충전`;

  return {
    ok: true as const,
    paymentId,
    orderName,
    totalAmount: pkg.price,
    packageId,
    pkg,
  };
}

export function getPortoneCheckoutByPaymentId(paymentId: string): PortoneCheckoutRow | null {
  const db = getDb();
  ensurePortoneCheckoutTable(db);
  return (
    (db
      .prepare(
        `SELECT id, user_id, package_id, payment_id, amount, status, portone_tx_id, created_at, paid_at
         FROM portone_checkouts WHERE payment_id = ?`
      )
      .get(paymentId) as PortoneCheckoutRow | undefined) ?? null
  );
}

export function markPortoneCheckoutPaid(
  paymentId: string,
  portoneTxId: string
): { ok: true; alreadyPaid: boolean } | { ok: false; error: string } {
  const db = getDb();
  ensurePortoneCheckoutTable(db);

  const row = getPortoneCheckoutByPaymentId(paymentId);
  if (!row) return { ok: false, error: "결제 요청을 찾을 수 없습니다." };
  if (row.status === "paid") return { ok: true, alreadyPaid: true };

  if (row.status !== "pending") {
    return { ok: false, error: "처리할 수 없는 결제 상태입니다." };
  }

  const packageId = row.package_id as PointChargePackageId;
  if (!POINT_CHARGE_PACKAGES_BY_ID[packageId]) {
    return { ok: false, error: "상품 정보가 유효하지 않습니다." };
  }

  db.transaction(() => {
    creditPointChargePackage(db, row.user_id, packageId, "포인트 충전 (PortOne)", {
      portoneCheckoutId: row.id,
    });
    db.prepare(
      `UPDATE portone_checkouts
       SET status='paid', portone_tx_id=?, paid_at=datetime('now')
       WHERE payment_id=? AND status='pending'`
    ).run(portoneTxId, paymentId);
  })();

  return { ok: true, alreadyPaid: false };
}
