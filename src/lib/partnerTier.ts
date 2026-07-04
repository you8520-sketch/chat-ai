import type Database from "better-sqlite3";
import {
  CREATOR_PARTNER_MIN_CHARACTERS,
  CREATOR_PARTNER_MIN_MONTHLY_SPENT,
  CREATOR_PARTNER_RENEWAL_MAINTENANCE_RATE,
  CREATOR_PARTNER_TERM_MONTHS,
  roundCreatorAmount,
  type PartnerTermInfo,
} from "./creatorShared";

export const CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT = Math.floor(
  CREATOR_PARTNER_MIN_MONTHLY_SPENT * CREATOR_PARTNER_RENEWAL_MAINTENANCE_RATE
);

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addCalendarMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 파트너 유지 기간에 해당하는 연-월 목록 (승급 월 포함 N개월) */
export function listPartnerTermMonths(grantedAtIso: string, monthCount = CREATOR_PARTNER_TERM_MONTHS): string[] {
  const start = startOfMonth(new Date(grantedAtIso));
  const months: string[] = [];
  for (let i = 0; i < monthCount; i++) {
    months.push(monthKey(addCalendarMonths(start, i)));
  }
  return months;
}

export function meetsPartnerPromotionCriteria(
  publicCharacterCount: number,
  monthlySpentOnChars: number
): boolean {
  return (
    publicCharacterCount >= CREATOR_PARTNER_MIN_CHARACTERS &&
    monthlySpentOnChars >= CREATOR_PARTNER_MIN_MONTHLY_SPENT
  );
}

export function passesPartnerRenewal(opts: {
  termMonths: string[];
  monthSpends: Record<string, number>;
  publicCharacterCount: number;
  minMonthly?: number;
}): boolean {
  const minMonthly = opts.minMonthly ?? CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT;
  if (opts.publicCharacterCount < CREATOR_PARTNER_MIN_CHARACTERS) return false;
  return opts.termMonths.every((m) => (opts.monthSpends[m] ?? 0) >= minMonthly);
}

export function buildPartnerTermMonthRows(
  termMonths: string[],
  monthSpends: Record<string, number>,
  minMonthly = CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT
): PartnerTermInfo["termMonths"] {
  return termMonths.map((month) => {
    const spent = roundCreatorAmount(monthSpends[month] ?? 0);
    return { month, spent, met: spent >= minMonthly };
  });
}

function fetchMonthlySpends(
  db: Database.Database,
  creatorId: number,
  months: string[]
): Record<string, number> {
  if (months.length === 0) return {};
  const placeholders = months.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS month,
              COALESCE(SUM(points_spent), 0) AS spent
       FROM creator_earnings
       WHERE creator_id = ? AND reversed = 0
         AND strftime('%Y-%m', created_at) IN (${placeholders})
       GROUP BY month`
    )
    .all(creatorId, ...months) as { month: string; spent: number }[];

  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.month] = roundCreatorAmount(Number(row.spent));
  }
  return out;
}

type PartnerTierRow = {
  partner_tier_granted_at: string | null;
  partner_tier_valid_until: string | null;
};

export type SyncPartnerTierResult = {
  grantedAt: string | null;
  validUntil: string | null;
  hasActiveTerm: boolean;
  partnerTerm: PartnerTermInfo | null;
};

/** DB의 파트너 유지 기간을 갱신·만료 처리하고 현재 파트너 자격 여부를 반환 */
export function syncPartnerTierStatus(
  db: Database.Database,
  creatorId: number,
  opts: {
    publicCharacterCount: number;
    monthlySpentOnChars: number;
    now?: Date;
  }
): SyncPartnerTierResult {
  const now = opts.now ?? new Date();
  const nowIso = formatIsoDate(now);
  const minMaintenance = CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT;

  const row = db
    .prepare("SELECT partner_tier_granted_at, partner_tier_valid_until FROM users WHERE id = ?")
    .get(creatorId) as PartnerTierRow | undefined;

  let grantedAt = row?.partner_tier_granted_at?.trim() || null;
  let validUntil = row?.partner_tier_valid_until?.trim() || null;

  const meetsPromotion = meetsPartnerPromotionCriteria(
    opts.publicCharacterCount,
    opts.monthlySpentOnChars
  );

  if (validUntil && grantedAt && nowIso >= validUntil) {
    const termMonths = listPartnerTermMonths(grantedAt);
    const monthSpends = fetchMonthlySpends(db, creatorId, termMonths);

    if (
      passesPartnerRenewal({
        termMonths,
        monthSpends,
        publicCharacterCount: opts.publicCharacterCount,
        minMonthly: minMaintenance,
      })
    ) {
      const nextGrantedAt = validUntil;
      const nextValidUntil = formatIsoDate(
        addCalendarMonths(startOfMonth(new Date(validUntil)), CREATOR_PARTNER_TERM_MONTHS)
      );
      db.prepare(
        "UPDATE users SET partner_tier_granted_at = ?, partner_tier_valid_until = ? WHERE id = ?"
      ).run(nextGrantedAt, nextValidUntil, creatorId);
      grantedAt = nextGrantedAt;
      validUntil = nextValidUntil;
    } else {
      db.prepare(
        "UPDATE users SET partner_tier_granted_at = NULL, partner_tier_valid_until = NULL WHERE id = ?"
      ).run(creatorId);
      grantedAt = null;
      validUntil = null;
    }
  }

  let hasActiveTerm = Boolean(validUntil && nowIso < validUntil);

  if (!hasActiveTerm && meetsPromotion) {
    const grantStart = startOfMonth(now);
    grantedAt = formatIsoDate(grantStart);
    validUntil = formatIsoDate(addCalendarMonths(grantStart, CREATOR_PARTNER_TERM_MONTHS));
    db.prepare(
      "UPDATE users SET partner_tier_granted_at = ?, partner_tier_valid_until = ? WHERE id = ?"
    ).run(grantedAt, validUntil, creatorId);
    hasActiveTerm = true;
  }

  let partnerTerm: PartnerTermInfo | null = null;
  if (grantedAt && validUntil && hasActiveTerm) {
    const termMonths = listPartnerTermMonths(grantedAt);
    const monthSpends = fetchMonthlySpends(db, creatorId, termMonths);
    partnerTerm = {
      active: true,
      grantedAt,
      validUntil,
      maintenanceMinMonthly: minMaintenance,
      termMonths: buildPartnerTermMonthRows(termMonths, monthSpends, minMaintenance),
    };
  }

  return { grantedAt, validUntil, hasActiveTerm, partnerTerm };
}

export function hasPartnerTierBenefit(
  sync: SyncPartnerTierResult,
  publicCharacterCount: number,
  monthlySpentOnChars: number
): boolean {
  if (sync.hasActiveTerm) return true;
  return meetsPartnerPromotionCriteria(publicCharacterCount, monthlySpentOnChars);
}

/**
 * 공개 페이지(캐릭터·크리에이터 프로필)의 "공식 크리에이터" 뱃지 표시용 — 가벼운 읽기 전용 조회.
 * 갱신·강등 판정(syncPartnerTierStatus)은 대시보드 접속 시 이미 반영되므로 여기서는 재계산하지 않음.
 */
export function isActivePartnerCreator(
  db: Database.Database,
  creatorId: number | null | undefined,
  now: Date = new Date()
): boolean {
  if (!creatorId || creatorId <= 0) return false;
  const row = db
    .prepare("SELECT partner_tier_valid_until, creator_exclusive FROM users WHERE id = ?")
    .get(creatorId) as { partner_tier_valid_until: string | null; creator_exclusive: number } | undefined;
  if (!row) return false;
  if (row.creator_exclusive === 1) return true;
  const validUntil = row.partner_tier_valid_until?.trim();
  if (!validUntil) return false;
  return formatIsoDate(now) < validUntil;
}
