import type { Usage } from "@/lib/chatUsage";

export const BILLING_BREAKDOWN_SYSTEM_RULES_LABEL = "시스템 프롬프트 (고정 규칙)";
/** Keyword-activated lorebook entries injected this turn */
export const BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL = "활성화 로어북";

function isAdminEmailUser(user: { email: string } & { is_admin?: number }): boolean {
  if (user.is_admin === 1) return true;
  const allow = process.env.ADMIN_EMAILS?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allow?.length) return false;
  return allow.includes(user.email.toLowerCase());
}

/** 관리자·로컬 데모유저만 영수증 상세(thinking·API raw·strip 등) 노출 */
export function canShowFullBillingReceipt(
  user: { email: string } & { is_admin?: number }
): boolean {
  return isAdminEmailUser(user);
}

export function filterUsageBreakdownForReceipt(
  breakdown: Usage["breakdown"] | undefined,
  showFullReceipt: boolean
): Usage["breakdown"] {
  if (!breakdown?.length) return breakdown ?? [];
  if (showFullReceipt) return breakdown;
  return breakdown.filter((b) => b.label !== BILLING_BREAKDOWN_SYSTEM_RULES_LABEL);
}

/** 일반 이용자 영수증 — 위젯·환율·시스템 규칙 breakdown 등 상세 필드 제거 */
export function sanitizeUsageForPublicReceipt(usage: Usage): Usage {
  const {
    statusWidgetExtract: _statusWidgetExtract,
    widgetCostPoints: _widgetCostPoints,
    mainApiRawCostKrw: _mainApiRawCostKrw,
    exchangeRateKrwPerUsd: _exchangeRateKrwPerUsd,
    exchangeRateDateKey: _exchangeRateDateKey,
    exchangeRateMode: _exchangeRateMode,
    exchangeRateSource: _exchangeRateSource,
    ...rest
  } = usage;
  return {
    ...rest,
    breakdown: filterUsageBreakdownForReceipt(rest.breakdown, false),
  };
}
