import type Database from "better-sqlite3";
import {
  formatAccountInfoLabel,
  parseAccountInfo,
  type WithdrawalStatus,
} from "@/lib/creatorShared";
import type {
  AdminPayoutApplicationRow,
  AdminPayoutAutomation,
  AdminPayoutCounts,
  AdminPayoutTaxPreview,
} from "@/lib/adminPayoutShared";
import {
  calcLocalTax,
  isPayoutSchedulerEnabled,
  PAYOUT_SCHEDULE_LABEL,
  PAYOUT_TIMEZONE,
} from "@/lib/payoutSchedule";

export type {
  AdminPayoutApplicationRow,
  AdminPayoutAutomation,
  AdminPayoutCounts,
  AdminPayoutTaxPreview,
} from "@/lib/adminPayoutShared";

export const ADMIN_PAYOUT_STATUSES = ["PENDING", "APPROVED", "FAILED", "REJECTED"] as const;
export type AdminPayoutStatusFilter = "all" | WithdrawalStatus;

type WithdrawalListRecord = {
  id: number;
  user_id: number;
  requested_cp: number;
  tax_amount: number;
  platform_fee: number;
  payout_amount: number;
  account_info: string;
  status: WithdrawalStatus;
  failure_reason: string;
  created_at: string;
  processed_at: string | null;
  nickname: string;
  email: string;
  real_name: string | null;
};

type StatusCountRow = { status: string; c: number };

type TaxAmountRow = {
  requested_cp: number;
  tax_amount: number;
  payout_amount: number;
};

export function parseAdminPayoutStatusFilter(raw: string | null): AdminPayoutStatusFilter {
  const value = String(raw ?? "all").trim().toUpperCase();
  if (value === "ALL" || value === "") return "all";
  if ((ADMIN_PAYOUT_STATUSES as readonly string[]).includes(value)) {
    return value as WithdrawalStatus;
  }
  return "all";
}

export function getPayoutAutomationStatus(): AdminPayoutAutomation {
  return {
    enabled: isPayoutSchedulerEnabled(),
    scheduleLabel: PAYOUT_SCHEDULE_LABEL,
    timezone: PAYOUT_TIMEZONE,
  };
}

export function countAdminPayoutApplications(db: Database.Database): AdminPayoutCounts {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS c FROM withdrawal_requests GROUP BY status`)
    .all() as StatusCountRow[];

  const counts: AdminPayoutCounts = {
    all: 0,
    pending: 0,
    approved: 0,
    failed: 0,
    rejected: 0,
  };

  for (const row of rows) {
    const n = Number(row.c) || 0;
    counts.all += n;
    switch (row.status) {
      case "PENDING":
        counts.pending += n;
        break;
      case "APPROVED":
        counts.approved += n;
        break;
      case "FAILED":
        counts.failed += n;
        break;
      case "REJECTED":
        counts.rejected += n;
        break;
      default:
        break;
    }
  }

  return counts;
}

export function toAdminPayoutApplicationRow(record: WithdrawalListRecord): AdminPayoutApplicationRow {
  const account = parseAccountInfo(record.account_info);
  const creatorName =
    record.real_name?.trim() ||
    account?.accountHolder?.trim() ||
    record.nickname?.trim() ||
    "미등록";

  return {
    id: record.id,
    userId: record.user_id,
    nickname: record.nickname,
    email: record.email,
    creatorName,
    requestedCp: record.requested_cp,
    taxAmount: record.tax_amount,
    platformFee: record.platform_fee,
    payoutAmount: record.payout_amount,
    bankName: account?.bankName ?? "",
    accountMasked: account?.accountMasked ?? "",
    accountHolder: account?.accountHolder ?? "",
    accountLabel: formatAccountInfoLabel(record.account_info),
    status: record.status,
    failureReason: record.failure_reason ?? "",
    createdAt: record.created_at,
    processedAt: record.processed_at,
  };
}

export function listAdminPayoutApplications(
  db: Database.Database,
  status: AdminPayoutStatusFilter = "all",
  limit = 200
): AdminPayoutApplicationRow[] {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 500);
  const rows =
    status === "all"
      ? (db
          .prepare(
            `SELECT w.id, w.user_id, w.requested_cp, w.tax_amount, w.platform_fee, w.payout_amount,
                    w.account_info, w.status, w.failure_reason, w.created_at, w.processed_at,
                    u.nickname, u.email, u.real_name
             FROM withdrawal_requests w
             JOIN users u ON u.id = w.user_id
             ORDER BY w.created_at DESC, w.id DESC
             LIMIT ?`
          )
          .all(capped) as WithdrawalListRecord[])
      : (db
          .prepare(
            `SELECT w.id, w.user_id, w.requested_cp, w.tax_amount, w.platform_fee, w.payout_amount,
                    w.account_info, w.status, w.failure_reason, w.created_at, w.processed_at,
                    u.nickname, u.email, u.real_name
             FROM withdrawal_requests w
             JOIN users u ON u.id = w.user_id
             WHERE w.status = ?
             ORDER BY w.created_at DESC, w.id DESC
             LIMIT ?`
          )
          .all(status, capped) as WithdrawalListRecord[]);

  return rows.map(toAdminPayoutApplicationRow);
}

export function previewApprovedPayoutTaxes(
  db: Database.Database,
  year: number,
  month: number
): AdminPayoutTaxPreview {
  const monthPadded = String(month).padStart(2, "0");
  const rows = db
    .prepare(
      `SELECT requested_cp, tax_amount, payout_amount
       FROM withdrawal_requests
       WHERE status = 'APPROVED'
         AND processed_at IS NOT NULL
         AND strftime('%Y', processed_at) = ?
         AND strftime('%m', processed_at) = ?`
    )
    .all(String(year), monthPadded) as TaxAmountRow[];

  let grossAmount = 0;
  let nationalTax = 0;
  let localTax = 0;
  let netPayout = 0;
  for (const row of rows) {
    const national = Math.round(row.tax_amount);
    grossAmount += Math.round(row.requested_cp);
    nationalTax += national;
    localTax += calcLocalTax(national);
    netPayout += row.payout_amount;
  }

  return {
    year,
    month,
    count: rows.length,
    grossAmount,
    nationalTax,
    localTax,
    netPayout,
  };
}
