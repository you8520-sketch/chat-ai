import type Database from "better-sqlite3";
import {
  CREATOR_PRO_MIN_CHARACTERS,
  CREATOR_PRO_MIN_MONTHLY_SPENT,
  CREATOR_PRO_MIN_TOTAL_CHATS,
  CREATOR_PRO_RENEWAL_MAINTENANCE_RATE,
  CREATOR_PRO_TERM_MONTHS,
  roundCreatorAmount,
} from "./creatorShared";
import { addCalendarMonths, formatIsoDate } from "./partnerTier";

export const CREATOR_PRO_RENEWAL_MIN_AVERAGE_SPENT = Math.floor(
  CREATOR_PRO_MIN_MONTHLY_SPENT * CREATOR_PRO_RENEWAL_MAINTENANCE_RATE
);

export function meetsProPromotionCriteria(opts: {
  publicCharacterCount: number;
  totalChats: number;
  monthlySpentOnChars: number;
}): boolean {
  return (
    opts.publicCharacterCount >= CREATOR_PRO_MIN_CHARACTERS &&
    opts.totalChats >= CREATOR_PRO_MIN_TOTAL_CHATS &&
    opts.monthlySpentOnChars >= CREATOR_PRO_MIN_MONTHLY_SPENT
  );
}

export function passesProRenewal(monthSpends: Record<string, number>): boolean {
  const total = Object.values(monthSpends).reduce((sum, spent) => sum + spent, 0);
  return total / CREATOR_PRO_TERM_MONTHS >= CREATOR_PRO_RENEWAL_MIN_AVERAGE_SPENT;
}

function fetchTermSpend(
  db: Database.Database,
  creatorId: number,
  grantedAt: string,
  validUntil: string
): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(points_spent), 0) AS spent
     FROM creator_earnings
     WHERE creator_id = ? AND reversed = 0
       AND created_at >= ? AND created_at < ?`
  ).get(creatorId, grantedAt, validUntil) as { spent: number };
  return roundCreatorAmount(Number(row.spent));
}

/** 최초 승급, 3개월 보장, 만료 시 3개월 평균 소비 기준 갱신을 DB에 반영한다. */
export function syncProTierStatus(
  db: Database.Database,
  creatorId: number,
  stats: { publicCharacterCount: number; totalChats: number; monthlySpentOnChars: number },
  now = new Date()
): boolean {
  const nowIso = formatIsoDate(now);
  const row = db.prepare(
    "SELECT pro_tier_granted_at, pro_tier_valid_until FROM users WHERE id = ?"
  ).get(creatorId) as { pro_tier_granted_at: string | null; pro_tier_valid_until: string | null } | undefined;
  let grantedAt = row?.pro_tier_granted_at?.trim() || null;
  let validUntil = row?.pro_tier_valid_until?.trim() || null;

  if (grantedAt && validUntil && nowIso >= validUntil) {
    const termSpend = fetchTermSpend(db, creatorId, grantedAt, validUntil);
    if (passesProRenewal({ term: termSpend })) {
      grantedAt = validUntil;
      validUntil = formatIsoDate(addCalendarMonths(new Date(validUntil), CREATOR_PRO_TERM_MONTHS));
      db.prepare("UPDATE users SET pro_tier_granted_at = ?, pro_tier_valid_until = ? WHERE id = ?")
        .run(grantedAt, validUntil, creatorId);
    } else {
      grantedAt = null;
      validUntil = null;
      db.prepare("UPDATE users SET pro_tier_granted_at = NULL, pro_tier_valid_until = NULL WHERE id = ?")
        .run(creatorId);
    }
  }

  if ((!validUntil || nowIso >= validUntil) && meetsProPromotionCriteria(stats)) {
    grantedAt = formatIsoDate(now);
    validUntil = formatIsoDate(addCalendarMonths(now, CREATOR_PRO_TERM_MONTHS));
    db.prepare("UPDATE users SET pro_tier_granted_at = ?, pro_tier_valid_until = ? WHERE id = ?")
      .run(grantedAt, validUntil, creatorId);
  }

  return Boolean(validUntil && nowIso < validUntil);
}
