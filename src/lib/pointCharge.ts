import type Database from "better-sqlite3";
import { recordPointChargeBatch } from "@/lib/chargeCancellation";
import { POINT_CHARGE_PACKAGES_BY_ID, type PointChargePackageId } from "@/lib/plans";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { notifyPaymentSuccess } from "@/lib/userNotifications";

/**
 * PortOne 서버 검증 + checkout claim이 완료된 caller-owned transaction 안에서만 호출한다.
 * 이 helper는 transaction owner가 아니다.
 */
export function creditPointChargePackage(
  db: Database.Database,
  userId: number,
  packageId: PointChargePackageId,
  reasonPrefix = "포인트 충전",
  options?: { portoneCheckoutId?: number | null }
) {
  if (!db.inTransaction) {
    throw new Error("POINT_CHARGE_REQUIRES_CALLER_TRANSACTION");
  }

  const pkg = POINT_CHARGE_PACKAGES_BY_ID[packageId];
  if (!pkg) throw new Error("INVALID_PACKAGE");

  const paidCredit = creditPointsWithIds(
    db,
    userId,
    pkg.paidPoints,
    "PAID",
    `${reasonPrefix} (₩${pkg.price.toLocaleString()})`
  );
  const freeCredit =
    pkg.bonusPoints > 0
      ? creditPointsWithIds(
          db,
          userId,
          pkg.bonusPoints,
          "FREE",
          `충전 보너스 (+${pkg.bonusPoints.toLocaleString()}P)`
        )
      : null;

  if (paidCredit) {
    recordPointChargeBatch(db, {
      userId,
      portoneCheckoutId: options?.portoneCheckoutId ?? null,
      mainPointLogId: paidCredit.logId,
      paidAmount: pkg.paidPoints,
      freeAmount: pkg.bonusPoints,
      paidTransactionId: paidCredit.transactionId,
      freeTransactionId: freeCredit?.transactionId ?? null,
      priceKrw: pkg.price,
    });

    notifyPaymentSuccess(
      db,
      userId,
      paidCredit.logId,
      "결제 완료",
      `포인트 충전 ₩${pkg.price.toLocaleString()} — 유료 ${pkg.paidPoints.toLocaleString()}P${
        pkg.bonusPoints > 0 ? ` + 보너스 ${pkg.bonusPoints.toLocaleString()}P` : ""
      } 지급`
    );
  }

  return { pkg, balance: getPointBalanceOnDb(db, userId) };
}
