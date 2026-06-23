import { getDb } from "./db";
import { decryptSensitive } from "./fieldEncryption";
import { formatResidentNumberDisplay } from "./residentId";
import { parseAccountInfo, WITHDRAWAL_TAX_RATE } from "./creatorShared";

/** 지방소득세 = 국세(원천징수)의 10% (소득세법 기준) */
export const LOCAL_TAX_RATE_OF_NATIONAL = 0.1;

export type PayoutExportRow = {
  payoutDate: string;
  creatorName: string;
  residentId: string;
  bankName: string;
  accountNumber: string;
  grossAmount: number;
  nationalTax: number;
  localTax: number;
  netPayout: number;
};

export type ApprovedWithdrawalRecord = {
  id: number;
  user_id: number;
  requested_cp: number;
  tax_amount: number;
  payout_amount: number;
  account_info: string;
  processed_at: string;
  resident_number: string;
  real_name: string | null;
  resident_id: string | null;
  nickname: string;
};

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

export function parseYearMonth(yearParam: string | null, monthParam: string | null) {
  const year = parseInt(String(yearParam ?? ""), 10);
  const month = parseInt(String(monthParam ?? ""), 10);
  if (!year || year < 2000 || year > 2100) {
    throw new Error("유효한 연도(year)를 입력하세요.");
  }
  if (!month || month < 1 || month > 12) {
    throw new Error("유효한 월(month, 1–12)을 입력하세요.");
  }
  return { year, month, monthPadded: padMonth(month) };
}

export function calcLocalTax(nationalTax: number): number {
  return Math.floor(nationalTax * LOCAL_TAX_RATE_OF_NATIONAL);
}

export function listApprovedWithdrawalsForMonth(year: number, monthPadded: string): ApprovedWithdrawalRecord[] {
  const yearStr = String(year);
  return getDb()
    .prepare(
      `SELECT w.id, w.user_id, w.requested_cp, w.tax_amount, w.payout_amount, w.account_info, w.processed_at,
              w.resident_number,
              u.real_name, u.resident_id, u.nickname
       FROM withdrawal_requests w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'APPROVED'
         AND w.processed_at IS NOT NULL
         AND strftime('%Y', w.processed_at) = ?
         AND strftime('%m', w.processed_at) = ?
       ORDER BY w.processed_at ASC, w.id ASC`
    )
    .all(yearStr, monthPadded) as ApprovedWithdrawalRecord[];
}

export function toExportRow(record: ApprovedWithdrawalRecord): PayoutExportRow {
  const account = parseAccountInfo(record.account_info);
  const grossAmount = Math.round(record.requested_cp);
  const nationalTax = Math.round(record.tax_amount);
  const localTax = calcLocalTax(nationalTax);
  const creatorName =
    record.real_name?.trim() ||
    account?.accountHolder?.trim() ||
    record.nickname?.trim() ||
    "미등록";

  const payoutDate = record.processed_at.slice(0, 10);

  let residentId = "";
  if (record.resident_number) {
    try {
      residentId = formatResidentNumberDisplay(decryptSensitive(record.resident_number));
    } catch {
      residentId = "";
    }
  }
  if (!residentId && record.resident_id?.trim()) {
    residentId = record.resident_id.trim();
  }

  return {
    payoutDate,
    creatorName,
    residentId,
    bankName: account?.bankName ?? "",
    accountNumber: account?.accountNumber ?? "",
    grossAmount,
    nationalTax,
    localTax,
    netPayout: record.payout_amount,
  };
}

function csvCell(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADERS = [
  "지급일자",
  "크리에이터명",
  "주민등록번호",
  "은행명",
  "계좌번호",
  "총지급액",
  "원천징수세액(국세)",
  "지방세",
  "실수령액",
] as const;

export function buildPayoutCsv(rows: PayoutExportRow[]): string {
  const lines = [
    CSV_HEADERS.join(","),
    ...rows.map((r) =>
      [
        csvCell(r.payoutDate),
        csvCell(r.creatorName),
        csvCell(r.residentId),
        csvCell(r.bankName),
        csvCell(r.accountNumber),
        csvCell(r.grossAmount),
        csvCell(r.nationalTax),
        csvCell(r.localTax),
        csvCell(r.netPayout),
      ].join(",")
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function exportFilename(year: number, month: number): string {
  return `정산내역_${year}_${padMonth(month)}.csv`;
}

/** 세무 검증용 — 국세율 8.8% 기준 역산 허용 오차 */
export function expectedNationalTax(gross: number): number {
  return Math.round(gross * WITHDRAWAL_TAX_RATE);
}
