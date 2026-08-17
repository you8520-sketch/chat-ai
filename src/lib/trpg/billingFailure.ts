export const TRPG_BILLING_SUBSTAGES = [
  "pricing_quote",
  "payer_preflight",
  "point_deduction",
  "creator_reward",
  "economics_observation",
  "billing_persist",
] as const;
export type TrpgBillingSubstage = (typeof TRPG_BILLING_SUBSTAGES)[number];

export const TRPG_BILLING_ERROR_CODES = [
  "SQLITE_CONSTRAINT",
  "POINT_DEDUCTION",
  "CREATOR_REWARD",
  "ECONOMICS",
  "BILLING_PERSIST",
  "UNKNOWN",
] as const;
export type TrpgBillingErrorCode = (typeof TRPG_BILLING_ERROR_CODES)[number];

export function parseTrpgBillingSubstage(value: unknown): TrpgBillingSubstage | undefined {
  return TRPG_BILLING_SUBSTAGES.find((item) => item === value);
}

export function parseTrpgBillingErrorCode(value: unknown): TrpgBillingErrorCode | undefined {
  return TRPG_BILLING_ERROR_CODES.find((item) => item === value);
}

export function classifyTrpgBillingErrorCode(opts: {
  substage?: TrpgBillingSubstage;
  error: unknown;
}): TrpgBillingErrorCode {
  const raw = opts.error instanceof Error ? opts.error.message : String(opts.error ?? "");
  if (/UNIQUE constraint|SQLITE_CONSTRAINT|no such table|SQLITE_/i.test(raw)) return "SQLITE_CONSTRAINT";
  switch (opts.substage) {
    case "point_deduction":
    case "payer_preflight":
      return "POINT_DEDUCTION";
    case "creator_reward":
      return "CREATOR_REWARD";
    case "economics_observation":
      return "ECONOMICS";
    case "billing_persist":
      return "BILLING_PERSIST";
    case "pricing_quote":
      return "UNKNOWN";
    case undefined:
      return "UNKNOWN";
    default: {
      const _exhaustive: never = opts.substage;
      return _exhaustive;
    }
  }
}

export function sanitizeTrpgBillingFailureHint(substage?: TrpgBillingSubstage): string {
  switch (substage) {
    case "pricing_quote":
      return "라운드 과금 실패 · 요금 계산 단계";
    case "payer_preflight":
      return "라운드 과금 실패 · 잔액 확인 단계";
    case "point_deduction":
      return "라운드 과금 실패 · 포인트 차감 단계";
    case "creator_reward":
      return "라운드 과금 실패 · 제작자 정산 단계";
    case "economics_observation":
      return "라운드 과금 실패 · 정산 기록 단계";
    case "billing_persist":
      return "라운드 과금 실패 · 정산 저장 단계";
    case undefined:
      return "라운드 과금에 실패했습니다.";
    default: {
      const _exhaustive: never = substage;
      return _exhaustive;
    }
  }
}

export function extractTrpgBillingSubstage(error: unknown): TrpgBillingSubstage | undefined {
  if (typeof error === "object" && error && "billingSubstage" in error) {
    return parseTrpgBillingSubstage((error as { billingSubstage?: unknown }).billingSubstage);
  }
  return undefined;
}

export function extractTrpgBillingErrorCode(error: unknown): TrpgBillingErrorCode | undefined {
  if (typeof error === "object" && error && "billingErrorCode" in error) {
    return parseTrpgBillingErrorCode((error as { billingErrorCode?: unknown }).billingErrorCode);
  }
  return undefined;
}
