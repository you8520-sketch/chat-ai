/** Client-safe creator constants, types, and pure helpers (no DB/auth). */

export const CREATOR_REWARD_RATE = 0.08;
/** 일반: 캐릭터 2개+ */
export const CREATOR_STANDARD_MIN_CHARACTERS = 2;
/** 플러스: 캐릭터 3개+ & 통합 대화 1만+ */
export const CREATOR_REWARD_RATE_PLUS = 0.1;
export const CREATOR_PLUS_MIN_CHARACTERS = 3;
export const CREATOR_PLUS_MIN_TOTAL_CHATS = 10_000;
/** 프로: 공개(검수 통과) 캐릭터 10개+ & 월간 소비 200만P+ */
export const CREATOR_REWARD_RATE_PRO = 0.12;
export const CREATOR_PRO_MIN_CHARACTERS = 10;
export const CREATOR_PRO_MIN_TOTAL_CHATS = 100_000;
export const CREATOR_PRO_MIN_MONTHLY_SPENT = 2_000_000;
/** 파트너: 공개(검수 통과) 캐릭터 10개+ & 월간 소비 500만P+ */
export const CREATOR_REWARD_RATE_PARTNER = 0.15;
export const CREATOR_PARTNER_MIN_CHARACTERS = 10;
export const CREATOR_PARTNER_MIN_MONTHLY_SPENT = 5_000_000;
/** 파트너 등급 유지 기간 (개월) — 갱신 시 동일 기간 연장 */
export const CREATOR_PARTNER_TERM_MONTHS = 3;
/** 유지 기간 중 월간 소비 갱신 기준 (승급 조건의 80%) */
export const CREATOR_PARTNER_RENEWAL_MAINTENANCE_RATE = 0.8;
/** 전속 20% — 파트너 등급 달성 후 운영팀 문의·전속 계약 체결 시 (creator_exclusive 플래그) */
export const CREATOR_REWARD_RATE_EXCLUSIVE = 0.2;

export type CreatorTierLevel = "standard" | "plus" | "pro" | "partner" | "exclusive";

export const CREATOR_TIER_LABELS: Record<CreatorTierLevel, string> = {
  standard: "일반",
  plus: "플러스",
  pro: "프로",
  partner: "파트너",
  exclusive: "전속",
};

export const WITHDRAWAL_MIN_CP = 30_000;
export const WITHDRAWAL_TAX_RATE = 0.088;
export const WITHDRAWAL_PLATFORM_FEE_RATE = 0.112;
export const WITHDRAWAL_TOTAL_DEDUCTION_RATE =
  WITHDRAWAL_TAX_RATE + WITHDRAWAL_PLATFORM_FEE_RATE;

export type WithdrawalStatus = "PENDING" | "APPROVED" | "REJECTED" | "FAILED";

export type WithdrawalBreakdown = {
  requestedCp: number;
  taxAmount: number;
  platformFee: number;
  payoutAmount: number;
};

export type AccountInfo = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  accountMasked: string;
};

export type PartnerTermInfo = {
  active: boolean;
  grantedAt: string | null;
  validUntil: string | null;
  /** 갱신에 필요한 월간 최소 소비 (승급 조건의 80%) */
  maintenanceMinMonthly: number;
  termMonths: { month: string; spent: number; met: boolean }[];
};

export type CreatorTierInfo = {
  characterCount: number;
  /** 공개·검수 통과 캐릭터 수 (파트너 등급 조건) */
  publicCharacterCount: number;
  /** 이번 달 내 캐릭터 이용 소비 포인트 합계 */
  monthlySpentOnChars: number;
  totalChats: number;
  rewardRate: number;
  tierLevel: CreatorTierLevel;
  isExclusive: boolean;
  /** 프로 이상 (pro | partner | exclusive) */
  isPro: boolean;
  /** 파트너 유지 기간·갱신 진행 (파트너/전속일 때) */
  partnerTerm?: PartnerTermInfo | null;
};

export type CreatorCharacterStat = {
  id: number;
  name: string;
  emoji: string;
  hue: number;
  assets: string;
  images: string;
  chats_count: number;
  total_turns: number;
  likes: number;
  total_spent: number;
  total_reward: number;
};

export type CreatorEarningPeriod = "day" | "week" | "month";

export type CreatorCharacterEarningShare = {
  id: number;
  name: string;
  emoji: string;
  hue: number;
  assets: string;
  images: string;
  period_spent: number;
  period_reward: number;
  share_ratio: number;
};

export type CreatorEarningRow = {
  id: number;
  character_name: string;
  points_spent: number;
  reward_amount: number;
  reversed: number;
  created_at: string;
};

export type WithdrawalRequestRow = {
  id: number;
  requested_cp: number;
  tax_amount: number;
  platform_fee: number;
  payout_amount: number;
  account_info: string;
  status: WithdrawalStatus;
  created_at: string;
  processed_at: string | null;
};

/** @deprecated use WithdrawalRequestRow */
export type CreatorWithdrawalRow = WithdrawalRequestRow & {
  cp_amount?: number;
  fee_amount?: number;
  net_krw?: number;
  bank_name?: string;
  account_holder?: string;
  account_number_masked?: string;
  admin_note?: string;
};

export type WithdrawalEligibility = {
  canWithdraw: boolean;
  verifiedRealName: string;
  blockReason: string | null;
};

export type CreatorDashboard = {
  creatorPoints: number;
  totalReward: number;
  totalSpentOnChars: number;
  tier: CreatorTierInfo;
  characters: CreatorCharacterStat[];
  characterEarningShares: Record<CreatorEarningPeriod, CreatorCharacterEarningShare[]>;
  recentEarnings: CreatorEarningRow[];
  recentLogs: { delta: number; reason: string; created_at: string }[];
  recentWithdrawals: WithdrawalRequestRow[];
  hasPendingWithdrawal: boolean;
  withdrawal: WithdrawalEligibility;
  creatorCommentsEnabled: boolean;
  creatorProfileHtml: string;
  creatorNoticeHtml: string;
};

export function roundCreatorAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

export function calcWithdrawalBreakdown(cpAmount: number): WithdrawalBreakdown {
  const requestedCp = roundCreatorAmount(cpAmount);
  const taxAmount = roundCreatorAmount(requestedCp * WITHDRAWAL_TAX_RATE);
  const platformFee = roundCreatorAmount(requestedCp * WITHDRAWAL_PLATFORM_FEE_RATE);
  const payoutAmount = Math.floor(requestedCp - taxAmount - platformFee);
  return { requestedCp, taxAmount, platformFee, payoutAmount };
}

function maskAccountNumber(account: string): string {
  const digits = account.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function parseAccountInfo(json: string): AccountInfo | null {
  try {
    const o = JSON.parse(json) as AccountInfo;
    if (!o.bankName || !o.accountHolder) return null;
    return o;
  } catch {
    return null;
  }
}

export function formatAccountInfoLabel(json: string): string {
  const info = parseAccountInfo(json);
  if (!info) return "계좌 정보";
  return `${info.bankName} ${info.accountMasked ?? maskAccountNumber(info.accountNumber)} · ${info.accountHolder}`;
}

export function maskCreatorAccountNumber(account: string): string {
  return maskAccountNumber(account);
}
