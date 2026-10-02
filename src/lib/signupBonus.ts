import { getDb } from "@/lib/db";
import { creditPointsWithIds } from "@/lib/points";
import { SIGNUP_BONUS_POINTS } from "@/lib/plans";

export const SIGNUP_BONUS_REASON = "신규 가입 보너스";

export function hasSignupBonus(userId: number): boolean {
  const row = getDb()
    .prepare("SELECT 1 AS ok FROM point_logs WHERE user_id = ? AND reason = ? LIMIT 1")
    .get(userId, SIGNUP_BONUS_REASON) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

/** Single writer for the new-user bonus. Returns false when already granted. */
export function grantSignupBonusOnce(userId: number): boolean {
  const db = getDb();
  return db.transaction(() => {
    if (hasSignupBonus(userId)) return false;
    creditPointsWithIds(db, userId, SIGNUP_BONUS_POINTS, "FREE", SIGNUP_BONUS_REASON);
    return true;
  })();
}
