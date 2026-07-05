import { getDb } from "@/lib/db";

export type ExpiringPointSummary = {
  total: number;
  paid: number;
  free: number;
  nearestExpiresAt: string | null;
  daysLeft: number | null;
};

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

export function getExpiringPointsWithinDays(userId: number, days = 3): ExpiringPointSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT point_type, COALESCE(SUM(remaining_amount), 0) AS amount, MIN(expires_at) AS nearest
       FROM point_transactions
       WHERE user_id = ?
         AND remaining_amount > 0
         AND expires_at > datetime('now')
         AND expires_at <= datetime('now', ?)
       GROUP BY point_type`
    )
    .all(userId, `+${Math.max(0, days)} days`) as { point_type: "PAID" | "FREE"; amount: number; nearest: string | null }[];

  let paid = 0;
  let free = 0;
  let nearestExpiresAt: string | null = null;
  for (const row of rows) {
    if (row.point_type === "PAID") paid = roundAmount(Number(row.amount));
    else free = roundAmount(Number(row.amount));
    if (row.nearest && (!nearestExpiresAt || row.nearest < nearestExpiresAt)) nearestExpiresAt = row.nearest;
  }
  const total = roundAmount(paid + free);
  const daysLeft = nearestExpiresAt
    ? Math.max(0, Math.ceil((new Date(nearestExpiresAt.replace(" ", "T") + "Z").getTime() - Date.now()) / 86400000))
    : null;
  return { total, paid, free, nearestExpiresAt, daysLeft };
}
