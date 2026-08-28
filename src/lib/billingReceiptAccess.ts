import {
  applySelectedModelIdentity,
  collapsePublicHandoffStages,
} from "@/lib/adultHandoffDisplay";
import type { Usage } from "@/lib/chatUsage";

export const BILLING_BREAKDOWN_SYSTEM_RULES_LABEL = "시스템 프롬프트 (고정 규칙)";
/** Keyword-activated lorebook entries injected this turn */
export const BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL = "활성화 로어북";

export type StripAdultRoutingOptions = {
  /** Admin/debug — keep full adultRouting metadata. Public clients never receive it. */
  keepInternal?: boolean;
};

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

export function keepInternalAdultRoutingForUser(
  user: { email: string } & { is_admin?: number }
): boolean {
  return canShowFullBillingReceipt(user);
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
  const routing = usage.adultRouting;
  const {
    statusWidgetExtract: _statusWidgetExtract,
    statusWidgetExtractDiagnostics: _statusWidgetExtractDiagnostics,
    widgetCostPoints: _widgetCostPoints,
    mainApiRawCostKrw: _mainApiRawCostKrw,
    exchangeRateKrwPerUsd: _exchangeRateKrwPerUsd,
    exchangeRateDateKey: _exchangeRateDateKey,
    exchangeRateMode: _exchangeRateMode,
    exchangeRateSource: _exchangeRateSource,
    museAcceptance: _museAcceptance,
    adultRouting: _adultRouting,
    assembledPromptChars: _assembledPromptChars,
    breakdownAllocation: _breakdownAllocation,
    usedEnglishCharacterPrompt: _usedEnglishCharacterPrompt,
    characterPromptLanguage: _characterPromptLanguage,
    generationKind: _generationKind,
    canonical: _canonical,
    canonAdopted: _canonAdopted,
    canonAdoptedAt: _canonAdoptedAt,
    shadowPricing: _shadowPricing,
    ...rest
  } = usage;
  void _canonAdopted;
  void _canonAdoptedAt;
  const publicUsage: Usage = {
    ...rest,
    breakdown: filterUsageBreakdownForReceipt(rest.breakdown, false),
  };
  if (routing?.activeRoute === "adult" || routing?.fallbackSucceeded) {
    Object.assign(publicUsage, applySelectedModelIdentity(publicUsage, routing));
    Object.assign(publicUsage, collapsePublicHandoffStages(publicUsage, routing));
  }
  return publicUsage;
}

/**
 * Client serialization — keep selected-model identity on top-level fields.
 * Public clients never receive adultRouting. Admin/debug may keep the full object.
 */
export function stripAdultRoutingForClient(
  usage: Usage,
  options?: StripAdultRoutingOptions
): Usage {
  const routing = usage.adultRouting;
  const {
    adultRouting: _adultRouting,
    generationKind: _generationKind,
    canonical: _canonical,
    canonAdopted: _canonAdopted,
    canonAdoptedAt: _canonAdoptedAt,
    shadowPricing: _shadowPricing,
    ...rest
  } = usage;
  void _canonAdopted;
  void _canonAdoptedAt;
  let client = { ...rest } as Usage;
  if (routing?.activeRoute === "adult" || routing?.fallbackSucceeded) {
    client = applySelectedModelIdentity(client, routing);
    if (!options?.keepInternal) {
      client = collapsePublicHandoffStages(client, routing);
    }
  }
  if (options?.keepInternal) {
    if (routing) client.adultRouting = routing;
    if (usage.generationKind) client.generationKind = usage.generationKind;
    if (usage.canonical != null) client.canonical = usage.canonical;
    if (usage.canonAdopted != null) client.canonAdopted = usage.canonAdopted;
    if (usage.canonAdoptedAt) client.canonAdoptedAt = usage.canonAdoptedAt;
    if (usage.shadowPricing) client.shadowPricing = usage.shadowPricing;
  }
  return client;
}
