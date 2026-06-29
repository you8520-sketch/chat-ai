import { getDb } from "@/lib/db";
import { enrichChargeCancelForLog } from "@/lib/chargeCancellation";
import { enrichPointLogsForRefund } from "@/lib/pointLogRefundLink";
import type { PointUsageLog } from "@/lib/pointUsageLog";
import {
  CHARGE_MAX_ITEMS,
  CHARGE_PAGE_SIZE,
  pointCreditHistorySqlFilter,
  pointFreeCreditHistorySqlFilter,
  pointPaidCreditHistorySqlFilter,
  USAGE_MAX_ITEMS,
  USAGE_PAGE_SIZE,
} from "@/lib/pointUsageLog";

export {
  CHARGE_MAX_ITEMS,
  CHARGE_PAGE_SIZE,
  USAGE_MAX_ITEMS,
  USAGE_PAGE_SIZE,
};

export type PointLogKind = "usage" | "paid" | "free";

type RawPointLogRow = {
  id: number;
  delta: number;
  reason: string;
  created_at: string;
  message_id: number | null;
  chat_id: number | null;
  is_refunded: number;
};

const BASE_SELECT = `
  SELECT pl.id, pl.delta, pl.reason, pl.created_at, pl.message_id, pl.chat_id,
         COALESCE(m.is_refunded, 0) AS is_refunded
  FROM point_logs pl
  LEFT JOIN messages m ON m.id = pl.message_id AND m.chat_id = pl.chat_id
`;

function filterSqlForKind(kind: PointLogKind): string {
  if (kind === "paid") return pointPaidCreditHistorySqlFilter("pl");
  if (kind === "free") return pointFreeCreditHistorySqlFilter("pl");
  return `NOT (${pointCreditHistorySqlFilter("pl")})`;
}

function fetchRawLogs(
  userId: number,
  kind: PointLogKind,
  opts: { limit: number; offset?: number }
): RawPointLogRow[] {
  const filter = filterSqlForKind(kind);
  const offset = opts.offset ?? 0;
  return getDb()
    .prepare(
      `${BASE_SELECT}
       WHERE pl.user_id = ? AND ${filter}
       ORDER BY pl.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, opts.limit, offset) as RawPointLogRow[];
}

function countLogs(userId: number, kind: PointLogKind): number {
  const filter = filterSqlForKind(kind);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS cnt FROM point_logs pl WHERE pl.user_id = ? AND ${filter}`)
    .get(userId) as { cnt: number };
  return row.cnt;
}

export function enrichPointLogRows(userId: number, logs: RawPointLogRow[]): PointUsageLog[] {
  const enriched = enrichPointLogsForRefund(
    userId,
    logs.map((l) => ({
      delta: l.delta,
      reason: l.reason,
      created_at: l.created_at,
      message_id: l.message_id,
      chat_id: l.chat_id,
      is_refunded: !!l.is_refunded,
    })),
    logs.map((l) => l.id)
  );

  return enriched.map((l, index) => {
    const logId = logs[index]?.id;
    const charge = enrichChargeCancelForLog(userId, {
      id: logId,
      delta: l.delta,
      reason: l.reason,
    });
    return {
      id: logId,
      delta: l.delta,
      reason: l.reason,
      created_at: l.created_at,
      message_id: l.message_id,
      chat_id: l.chat_id,
      is_refunded: l.is_refunded,
      ...charge,
    };
  });
}

export type PointLogsPageResult = {
  logs: PointUsageLog[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function clampLogPage(page: number, pageSize: number, maxItems: number): number {
  const maxPage = Math.max(1, Math.ceil(maxItems / pageSize));
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), maxPage);
}

export function clampUsagePage(page: number): number {
  return clampLogPage(page, USAGE_PAGE_SIZE, USAGE_MAX_ITEMS);
}

export function clampCreditPage(page: number): number {
  return clampLogPage(page, CHARGE_PAGE_SIZE, CHARGE_MAX_ITEMS);
}

/** @deprecated */ export const clampChargePage = clampCreditPage;

function fetchLogsPage(
  userId: number,
  kind: PointLogKind,
  page: number,
  pageSize: number,
  maxItems: number
): PointLogsPageResult {
  const safePage = clampLogPage(page, pageSize, maxItems);
  const totalRaw = countLogs(userId, kind);
  const total = Math.min(totalRaw, maxItems);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = Math.min(safePage, totalPages);
  const offset = (effectivePage - 1) * pageSize;

  const raw = fetchRawLogs(userId, kind, {
    limit: pageSize,
    offset,
  });

  return {
    logs: enrichPointLogRows(userId, raw),
    page: effectivePage,
    pageSize,
    total,
    totalPages,
  };
}

export function fetchUsageLogsPage(userId: number, page: number): PointLogsPageResult {
  return fetchLogsPage(userId, "usage", page, USAGE_PAGE_SIZE, USAGE_MAX_ITEMS);
}

export function fetchPaidCreditLogsPage(userId: number, page: number): PointLogsPageResult {
  return fetchLogsPage(userId, "paid", page, CHARGE_PAGE_SIZE, CHARGE_MAX_ITEMS);
}

export function fetchFreeCreditLogsPage(userId: number, page: number): PointLogsPageResult {
  return fetchLogsPage(userId, "free", page, CHARGE_PAGE_SIZE, CHARGE_MAX_ITEMS);
}

/** @deprecated */ export const fetchChargeLogsPage = fetchPaidCreditLogsPage;
