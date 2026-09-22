import type Database from "better-sqlite3";

import { recordPointChargeBatch } from "@/lib/chargeCancellation";

import { POINT_CHARGE_PACKAGES_BY_ID, type PointChargePackageId } from "@/lib/plans";

import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";

import { notifyPaymentSuccess } from "@/lib/userNotifications";



/** PortOne 서버 검증 완료 후 포인트 충전 패키지 지급 */

export function creditPointChargePackage(

  db: Database.Database,

  userId: number,

  packageId: PointChargePackageId,

  reasonPrefix = "포인트 충전",

  options?: { portoneCheckoutId?: number | null }

) {

  const pkg = POINT_CHARGE_PACKAGES_BY_ID[packageId];

  if (!pkg) throw new Error("INVALID_PACKAGE");



  let paidCredit: ReturnType<typeof creditPointsWithIds> = null;

  let freeCredit: ReturnType<typeof creditPointsWithIds> = null;



  db.transaction(() => {

    paidCredit = creditPointsWithIds(

      db,

      userId,

      pkg.paidPoints,

      "PAID",

      `${reasonPrefix} (₩${pkg.price.toLocaleString()})`

    );

    if (pkg.bonusPoints > 0) {

      freeCredit = creditPointsWithIds(

        db,

        userId,

        pkg.bonusPoints,

        "FREE",

        `충전 보너스 (+${pkg.bonusPoints.toLocaleString()}P)`

      );

    }



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

    }



    if (paidCredit) {

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

  })();



  return { pkg, balance: getPointBalanceOnDb(db, userId) };

}

