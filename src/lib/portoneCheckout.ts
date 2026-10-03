import crypto from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  isPointChargePackageId,
  POINT_CHARGE_PACKAGES_BY_ID,
  type PointChargePackageId,
} from "@/lib/plans";
import { creditPointChargePackage } from "@/lib/pointCharge";
import { PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND } from "@/lib/portoneReviewerAccount";

export type PortoneCheckoutStatus = "pending" | "paid" | "failed";
export type PortoneCheckoutKind = "standard" | typeof PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND;

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
  checkout_kind: PortoneCheckoutKind;
  store_id: string;
  channel_key: string;
};

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  def: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

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
  ensureColumn(db, "portone_checkouts", "checkout_kind", "TEXT NOT NULL DEFAULT 'standard'");
  ensureColumn(db, "portone_checkouts", "store_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "portone_checkouts", "channel_key", "TEXT NOT NULL DEFAULT ''");
}

export function isReviewerKgTestCheckout(
  checkout: Pick<PortoneCheckoutRow, "checkout_kind"> | null | undefined
): boolean {
  return checkout?.checkout_kind === PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND;
}

const CLIENT_PORTONE_CHECKOUT_OVERRIDE_KEYS = [
  "storeId",
  "store_id",
  "channelKey",
  "channel_key",
  "channelName",
  "channel_name",
  "isTest",
  "checkoutKind",
  "checkout_kind",
  "mid",
] as const;

export function hasClientPortoneCheckoutOverride(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const row = body as Record<string, unknown>;
  return CLIENT_PORTONE_CHECKOUT_OVERRIDE_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(row, key)
  );
}

export function createPortoneCheckout(
  userId: number,
  packageId: PointChargePackageId,
  options?: {
    checkoutKind?: PortoneCheckoutKind;
    storeId?: string;
    channelKey?: string;
  }
) {
  const pkg = POINT_CHARGE_PACKAGES_BY_ID[packageId];
  if (!pkg) return { ok: false as const, error: "잘못된 상품입니다.", status: 400 };

  const db = getDb();
  ensurePortoneCheckoutTable(db);

  const checkoutKind = options?.checkoutKind ?? "standard";
  const storeId = options?.storeId ?? "";
  const channelKey = options?.channelKey ?? "";
  const paymentId = `pt-${userId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  db.prepare(
    `INSERT INTO portone_checkouts
       (user_id, package_id, payment_id, amount, status, checkout_kind, store_id, channel_key)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(userId, packageId, paymentId, pkg.price, checkoutKind, storeId, channelKey);

  const totalPoints = pkg.paidPoints + pkg.bonusPoints;
  const orderName = `포인트 ${totalPoints.toLocaleString()}P 충전`;

  return {
    ok: true as const,
    paymentId,
    orderName,
    totalAmount: pkg.price,
    packageId,
    pkg,
    checkoutKind,
    storeId,
    channelKey,
  };
}

export function getPortoneCheckoutByPaymentId(
  paymentId: string,
  db: Database.Database = getDb()
): PortoneCheckoutRow | null {
  ensurePortoneCheckoutTable(db);
  return (
    (db
      .prepare(
        `SELECT id, user_id, package_id, payment_id, amount, status, portone_tx_id, created_at, paid_at,
              COALESCE(checkout_kind, 'standard') AS checkout_kind,
              COALESCE(store_id, '') AS store_id,
              COALESCE(channel_key, '') AS channel_key
         FROM portone_checkouts WHERE payment_id = ?`
      )
      .get(paymentId) as PortoneCheckoutRow | undefined) ?? null
  );
}

export function markPortoneCheckoutPaid(
  paymentId: string,
  portoneTxId: string,
  db: Database.Database = getDb()
): { ok: true; alreadyPaid: boolean } | { ok: false; error: string } {
  ensurePortoneCheckoutTable(db);

  try {
    return db.transaction(() => {
      const row = db
        .prepare(
          `SELECT id, user_id, package_id, payment_id, amount, status, portone_tx_id, created_at, paid_at,
                  COALESCE(checkout_kind, 'standard') AS checkout_kind,
                  COALESCE(store_id, '') AS store_id,
                  COALESCE(channel_key, '') AS channel_key
           FROM portone_checkouts WHERE payment_id = ?`
        )
        .get(paymentId) as PortoneCheckoutRow | undefined;

      if (!row) return { ok: false as const, error: "결제 요청을 찾을 수 없습니다." };
      if (row.status === "paid") return { ok: true as const, alreadyPaid: true };
      if (row.status !== "pending") {
        return { ok: false as const, error: "처리할 수 없는 결제 상태입니다." };
      }

      const packageId = row.package_id;
      if (!isPointChargePackageId(packageId)) {
        return { ok: false as const, error: "상품 정보가 유효하지 않습니다." };
      }

      const claimed = db.prepare(
        `UPDATE portone_checkouts
         SET status='paid', portone_tx_id=?, paid_at=datetime('now')
         WHERE id=? AND status='pending'`
      ).run(portoneTxId, row.id);

      if (Number(claimed.changes) === 0) {
        const current = db
          .prepare("SELECT status FROM portone_checkouts WHERE id=?")
          .get(row.id) as { status: PortoneCheckoutStatus } | undefined;
        if (current?.status === "paid") {
          return { ok: true as const, alreadyPaid: true };
        }
        return { ok: false as const, error: "결제 상태 선점에 실패했습니다." };
      }

      if (!isReviewerKgTestCheckout(row)) {
        creditPointChargePackage(db, row.user_id, packageId, "포인트 충전 (PortOne)", {
          portoneCheckoutId: row.id,
        });
      }

      return { ok: true as const, alreadyPaid: false };
    })();
  } catch (error) {
    console.error("[portone-checkout] paid finalize failed", error);
    return { ok: false, error: "결제 완료 처리에 실패했습니다." };
  }
}
