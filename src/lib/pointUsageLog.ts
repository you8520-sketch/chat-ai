/** 포인트 사용 내역 — 클라이언트·서버 공용 (DB import 금지) */

export const USAGE_PAGE_SIZE = 10;
export const USAGE_MAX_ITEMS = 100;
export const CHARGE_PAGE_SIZE = 20;
export const CHARGE_MAX_ITEMS = 100;

export type PointUsageLog = {

  id?: number;

  delta: number;

  reason: string;

  created_at: string;

  message_id: number | null;

  chat_id: number | null;

  is_refunded: boolean;

  charge_batch_id?: number | null;

  can_cancel_charge?: boolean;

  charge_cancelled?: boolean;

  charge_cancel_block_reason?: string;

};



/** `대화 · …` 및 구형 `대화(입력토큰 …)` 차감 */

export function isChatPointDeductionLog(log: Pick<PointUsageLog, "delta" | "reason">): boolean {

  if (log.delta >= 0) return false;

  const reason = log.reason.trim();

  return reason.startsWith("대화 · ") || reason.startsWith("대화(");

}



export function isPointChargeLog(log: Pick<PointUsageLog, "delta" | "reason">): boolean {

  return log.delta > 0 && log.reason.trim().startsWith("포인트 충전");

}

/** 유료 포인트 적립 — 결제 충전·선물 수령·결제 취소 */
export const POINT_PAID_CREDIT_POSITIVE_PREFIXES = [
  "포인트 충전",
  "포인트 선물 수령",
] as const;

/** 무료 포인트 적립 — 출석·이벤트·보너스·멤버십 등 */
export const POINT_FREE_CREDIT_POSITIVE_PREFIXES = [
  "일일 출석 보상",
  "캐릭터 제작·이식 이벤트",
  "신규 가입 보너스",
  "충전 보너스",
  "관리자 무료 포인트 지급",
] as const;

export function isPointPaidCreditHistoryReason(reason: string): boolean {
  const r = reason.trim();
  if (r.startsWith("결제 취소")) return true;
  if (POINT_PAID_CREDIT_POSITIVE_PREFIXES.some((prefix) => r.startsWith(prefix))) return true;
  if (r.startsWith("크리에이터 포인트 → 유료 포인트 교환")) return true;
  return false;
}

export function isPointFreeCreditHistoryReason(reason: string): boolean {
  const r = reason.trim();
  if (POINT_FREE_CREDIT_POSITIVE_PREFIXES.some((prefix) => r.startsWith(prefix))) return true;
  if (r.includes("멤버십 지급") || r.includes("정기결제")) return true;
  return false;
}

export function isPointPaidCreditHistoryLog(log: Pick<PointUsageLog, "delta" | "reason">): boolean {
  if (!isPointPaidCreditHistoryReason(log.reason)) return false;
  if (log.reason.trim().startsWith("결제 취소")) return true;
  return log.delta > 0;
}

export function isPointFreeCreditHistoryLog(log: Pick<PointUsageLog, "delta" | "reason">): boolean {
  if (!isPointFreeCreditHistoryReason(log.reason)) return false;
  return log.delta > 0;
}

/** @deprecated — paid + free 합산 분류 */
export function isPointCreditHistoryReason(reason: string): boolean {
  return isPointPaidCreditHistoryReason(reason) || isPointFreeCreditHistoryReason(reason);
}

/** @deprecated */
export function isPointChargeHistoryLog(log: Pick<PointUsageLog, "delta" | "reason">): boolean {
  return isPointPaidCreditHistoryLog(log) || isPointFreeCreditHistoryLog(log);
}

export function pointPaidCreditHistorySqlFilter(tableAlias = "pl"): string {
  const p = tableAlias;
  const prefixConds = POINT_PAID_CREDIT_POSITIVE_PREFIXES.map(
    (prefix) => `(${p}.delta > 0 AND ${p}.reason LIKE '${prefix.replace(/'/g, "''")}%')`
  ).join(" OR ");
  const creatorExchange = `(${p}.delta > 0 AND ${p}.reason LIKE '크리에이터 포인트 → 유료 포인트 교환%')`;
  const cancel = `${p}.reason LIKE '결제 취소%'`;
  return `(${prefixConds} OR ${creatorExchange} OR ${cancel})`;
}

export function pointFreeCreditHistorySqlFilter(tableAlias = "pl"): string {
  const p = tableAlias;
  const prefixConds = POINT_FREE_CREDIT_POSITIVE_PREFIXES.map(
    (prefix) => `(${p}.delta > 0 AND ${p}.reason LIKE '${prefix.replace(/'/g, "''")}%')`
  ).join(" OR ");
  const membership = `(${p}.delta > 0 AND (${p}.reason LIKE '%멤버십 지급%' OR ${p}.reason LIKE '%정기결제%'))`;
  return `(${prefixConds} OR ${membership})`;
}

export function pointCreditHistorySqlFilter(tableAlias = "pl"): string {
  return `(${pointPaidCreditHistorySqlFilter(tableAlias)} OR ${pointFreeCreditHistorySqlFilter(tableAlias)})`;
}



/** 사용 내역 탭 — 유·무료 적립을 제외한 포인트 변동 */

export function isPointUsageHistoryLog(log: Pick<PointUsageLog, "delta" | "reason">): boolean {

  return !isPointPaidCreditHistoryLog(log) && !isPointFreeCreditHistoryLog(log);

}


export function canShowChargeCancelButton(log: PointUsageLog): boolean {
  return (
    isPointChargeLog(log) &&
    !!log.id &&
    !log.charge_cancelled &&
    log.charge_batch_id != null
  );
}

