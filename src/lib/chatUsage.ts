import type { OutputLeakageAudit } from "@/lib/outputLeakageAudit";
import type { BillingWaiverReason } from "@/lib/points";

export type Usage = {
  input: number;
  output: number;
  model: string;
  provider?: "gemini" | "openrouter";
  route: "safe" | "nsfw";
  cost: number;
  estimated?: boolean;
  baseCost?: number;
  surchargeAmount?: number;
  noteSurcharge?: number;
  modelLabel?: string;
  selectedAI?: string;
  /** OpenRouter — cache read */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  standardInputTokens?: number;
  /** OpenRouter upstream_inference_cost (USD) — API 보고값 */
  upstreamCostUsd?: number;
  cacheDiscountUsd?: number;
  /** 영수증 — 모델별 캐시 설명 */
  cacheReadLine?: string | null;
  cacheWriteLine?: string | null;
  cacheRateSummary?: string;
  cacheFamily?: "anthropic" | "deepseek" | "google" | "unknown";
  /** OpenRouter — 턴 내 API completion_tokens 합산 (recovery 포함) */
  apiOutputTokens?: number;
  /** OpenRouter — reasoning_tokens 합산 (과금·미저장) */
  apiReasoningOutputTokens?: number;
  /** OpenRouter — completion − reasoning (표시 RP 대응) */
  apiContentOutputTokens?: number;
  /** OpenRouter — 턴 내 API prompt_tokens 합산 (recovery 포함) */
  apiInputTokens?: number;
  /** under-length / truncation recovery 호출 횟수 */
  lengthRecoveryPasses?: number;
  /** 저장 RP 글자 (tier cap) */
  savedOutputChars?: number;
  /** OpenRouter — primary + recovery API 호출 수 */
  apiCallCount?: number;
  /** OpenRouter API 원가 (KRW, 마진 전) */
  apiRawCostKrw?: number;
  /** Opus — cache-hit-normalized API 원가 (KRW, 마진 floor 입력) */
  normalizedRawCostKrw?: number;
  /** 과금 시점 USD→KRW (×2% 포함) */
  exchangeRateKrwPerUsd?: number;
  exchangeRateDateKey?: string;
  exchangeRateMode?: "daily_kst" | "realtime";
  exchangeRateSource?: "api" | "fallback";
  breakdown: { label: string; tokens: number; pct: number }[];
  stages?: { stage: string; model: string; input: number; output: number; cost: number }[];
  fallback?: string | null;
  /** 0P 면제 턴 — 영수증에 면제 사유 표시 */
  billingWaived?: boolean;
  billingWaiverReason?: BillingWaiverReason;
  /** Opus cold start — 85% 원가 방어선 적용 여부 */
  coldStartShieldApplied?: boolean;
  uncappedChargePoints?: number;
  coldStartCostFloorPoints?: number;
  /** 턴별 숨은 출력 audit — status/JSON/HTML strip 여부 */
  outputLeakage?: OutputLeakageAudit;
  /** HTML 전용 턴 — DeepSeek V3, 메인 RP 모델 미사용 */
  htmlFlashOnly?: boolean;
  /** 메인 RP OpenRouter 원가 (KRW) — 위젯 V3 분리 표시용 */
  mainApiRawCostKrw?: number;
  /** 상태창 위젯 V3 추출 — 관리자·데모 영수증 */
  statusWidgetExtract?: {
    model: string;
    modelLabel: string;
    input: number;
    output: number;
    apiRawCostKrw: number;
    upstreamCostUsd?: number;
    estimated?: boolean;
  };
};
