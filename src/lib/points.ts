import { getDb } from "./db";
import { getEffectiveKrwPerUsd } from "./exchangeRate";
import type { User } from "@/lib/auth-types";
import { isSubscribed } from "@/lib/auth-types";
import {
  billingModelId,
  isDeepSeekV4ProModel,
  isGemini25ProModel,
  isGemini31ProModel,
  isGeminiProOpenRouterModel,
  isGlmModel,
  isQwenModel,
  OPENROUTER_DEEPSEEK_V3_MODEL,
  type SelectedAI,
  resolveSelectedAI,
} from "./chatModels";
import { savedVisibleTextForReceipt } from "./chatRichContent";
import { resolveResponseLengthTarget, isCatastrophicallyShortResponse, type GenerationFailureReason } from "./responseLength";
import { isDegenerateOutput } from "./gibberishGuard";
import { PLANS, type PlanId, FREE_MEMORY_LIMIT, FREE_POINTS_VALID_MONTHS } from "./plans";
import { ATTENDANCE_POINTS_VALID_MONTHS } from "./attendanceConstants";
import type { StageUsage } from "./ai";
import {
  HTML_FLASH_MAX_OUTPUT_TOKENS,
  HTML_ONLY_MODEL_LABEL,
  HTML_ONLY_TURN_MAX_INPUT_TOKENS,
  HTML_ONLY_TURN_MAX_OUTPUT_TOKENS,
} from "./htmlVisualCardRecovery";

export type BillingWaiverReason =
  | "over_reasoning"
  | "garbage_output"
  | "forced_abort"
  | "degeneration"
  | "generation_failure";

export { PLANS, type PlanId, FREE_MEMORY_LIMIT, FREE_POINTS_VALID_MONTHS, ATTENDANCE_POINTS_VALID_MONTHS };

/** Gemini: (입력/1000)×3×tier + (출력/1000)×9×tier */
const BASE_GEMINI_INPUT = 3;
const BASE_GEMINI_OUTPUT = 9;

/** tier — Flash 1.0 (배경·메모리 작업용) */
const GEMINI_TIER: Record<string, number> = {
  "gemini-2.5-flash": 1.0,
  "gemini-3-flash-preview": 1.0,
};

export const TOKEN_RATES = {
  input: BASE_GEMINI_INPUT,
  output: BASE_GEMINI_OUTPUT,
} as const;

export const MIN_POINTS_TO_CHAT = 80;

/** 19+ OpenRouter — legacy 고정 차감 (OPENROUTER_BILLING_MODE=fixed 일 때만) */
export const OPENROUTER_ADULT_FIXED_TURN_COST = 20;

/** DeepSeek — 0P 면제 턴이라도 유의미한 본문이 전달되면 최소 차감 */
export const DEEPSEEK_WAIVER_SUCCESS_MIN_COST = 20;

/** Qwen — 0P 면제 턴이라도 유의미한 본문이 전달되면 최소 차감 */
export const QWEN_WAIVER_SUCCESS_MIN_COST = 50;

/** Gemini 2.5 Pro — 0P 면제 턴이라도 유의미한 본문이 전달되면 최소 차감 (Qwen과 동일) */
export const GEMINI_25_WAIVER_SUCCESS_MIN_COST = 50;

/** Gemini 3.1 Pro — 0P 면제 턴이라도 유의미한 본문이 전달되면 최소 65P 차감 */
export const GEMINI_31_WAIVER_SUCCESS_MIN_COST = 65;

/** OpenRouter Claude Opus 4.x — OpenRouter 공시 $/1M (2025–2026, claude-opus-4.5/4.6) */
export const OPENROUTER_CLAUDE_OPUS_INPUT_USD_PER_M = 5;
export const OPENROUTER_CLAUDE_OPUS_OUTPUT_USD_PER_M = 25;

/** @deprecated Claude 3 Opus era — 현재 라우팅은 4.x 단가 사용 */
export const OPENROUTER_CLAUDE_OPUS_LEGACY_INPUT_USD_PER_M = 15;
export const OPENROUTER_CLAUDE_OPUS_LEGACY_OUTPUT_USD_PER_M = 75;

/** Anthropic cache read — 입력 단가의 10% (90% 할인) */
export const OPENROUTER_CACHE_READ_COST_MULTIPLIER = 0.1;

/** Anthropic cache write/creation — 입력 단가의 125% */
export const OPENROUTER_CACHE_WRITE_COST_MULTIPLIER = 1.25;

import {
  openRouterUsdCostDetailed,
  resolveOpenRouterBillingRawCostKrw,
  type OpenRouterBillingInput,
} from "@/lib/billingRawCost";
import { openRouterNormalizedUsdCostFromRates } from "@/lib/openRouterModelPricing";
export {
  openRouterRawCostKrw,
  resolveOpenRouterBillingRawCostKrw,
  type OpenRouterBillingInput,
} from "@/lib/billingRawCost";

/** @deprecated getEffectiveKrwPerUsd() — 실시간 환율×2% 수수료 사용 */
export const OPENROUTER_KRW_PER_USD = Number(process.env.OPENROUTER_KRW_PER_USD) || 1500;

/** usage 과금 — 매출총이익률 (기본 30%, env OPENROUTER_GROSS_MARGIN으로 조정) */
export const OPENROUTER_GROSS_MARGIN = Number(process.env.OPENROUTER_GROSS_MARGIN) || 0.3;

/** usage 과금 최소 1턴 차감 */
export const OPENROUTER_MIN_TURN_COST = 5;

/** 입력 토큰 10,000 초과 — 초과 1,000토큰당 추가 청구 (P) */
export const OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS = 10000;
export const OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS = (() => {
  const per1000 = process.env.OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS?.trim();
  if (per1000) return Number(per1000) || 1.25;
  return 1.25;
})();

/** Claude Opus — 출력 1자당 청구 상한 (P) */
export const OPENROUTER_OPUS_POINTS_PER_CHAR = (() => {
  const perChar = process.env.OPENROUTER_OPUS_POINTS_PER_CHAR?.trim();
  if (perChar) return Number(perChar) || 0.142;
  const per1000 = process.env.OPENROUTER_OPUS_KRW_PER_1000_CHARS?.trim();
  if (per1000) return (Number(per1000) || 142) / 1000;
  return 0.142;
})();

/** Opus — 원가>글자상한(0.142) 블렌드 시 글자 가중 요율 (P/자) */
export const OPENROUTER_OPUS_BLEND_POINTS_PER_CHAR = 0.135;

/** cache_write가 이 값 초과면 TTL cache miss(cold start)로 판정 — 로그·진단용 */
export const OPUS_COLD_START_CACHE_WRITE_THRESHOLD = 3000;

/** API cache_write_tokens 기준 cold start(cache miss) 판정 */
export function isOpusColdStartCacheMiss(cacheWriteTokens?: number): boolean {
  return Math.max(0, cacheWriteTokens ?? 0) > OPUS_COLD_START_CACHE_WRITE_THRESHOLD;
}

/** Opus — 원가>0.142P/자 상한일 때 (API 원가 + 글자수×0.135P)/2 */
export function openRouterOpusBlendCharPoints(outputChars: number): number {
  return chargePoints(Math.max(0, outputChars) * OPENROUTER_OPUS_BLEND_POINTS_PER_CHAR);
}

export function opusCostCharCapBlendPoints(
  actualApiCostKrw: number,
  outputChars: number
): number {
  const actualCostPoints = chargePoints(Math.max(0, actualApiCostKrw));
  const blendCharPoints = openRouterOpusBlendCharPoints(outputChars);
  return chargePoints((actualCostPoints + blendCharPoints) / 2);
}

/** @deprecated 85% 방어선 — opusCostCharCapBlendPoints 사용 */
export const OPUS_COST_DEFENSE_RATE = 0.85;

/** @deprecated opusCostCharCapBlendPoints 사용 */
export function opusCostDefenseFloorPoints(actualApiCostKrw: number): number {
  return chargePoints(Math.max(0, actualApiCostKrw) * OPUS_COST_DEFENSE_RATE);
}

/** @deprecated opusCostDefenseFloorPoints */
export const opusColdStartStrictCostFloorPoints = opusCostDefenseFloorPoints;

type OpusTurnChargeResult = {
  total: number;
  uncappedChargePoints: number;
  charCapPoints: number;
  marginChargePoints: number;
  costBlendApplied: boolean;
  costBlendPoints?: number;
  applied: "char_floor" | "cost_plus_margin" | "min_turn" | "cost_blend" | "cold_start_shield";
};

/** Opus — min(45% 마진, 0.142P/자); 원가>0.142P/자 상한이면 (원가+글자수×0.135P)/2 */
export function resolveOpenRouterOpusTurnCharge(
  actualApiCostKrw: number,
  outputChars: number
): OpusTurnChargeResult {
  const charCapPoints = openRouterOpusCharFloorKrw(outputChars);
  const total = Math.max(OPENROUTER_MIN_TURN_COST, charCapPoints);
  let applied: OpusTurnChargeResult["applied"] = "char_floor";
  if (total === OPENROUTER_MIN_TURN_COST && charCapPoints < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  }
  return {
    total,
    uncappedChargePoints: total,
    charCapPoints,
    marginChargePoints: 0,
    costBlendApplied: false,
    applied,
  };
}

type OpusCostDefenseResult = {
  total: number;
  costDefenseApplied: boolean;
  uncappedChargePoints: number;
  costDefenseFloorPoints?: number;
};

function applyOpusCostDefenseToCharge(
  uncappedCharge: number,
  outputChars: number,
  actualApiCostKrw?: number
): OpusCostDefenseResult {
  const resolved = resolveOpenRouterOpusTurnCharge(actualApiCostKrw ?? 0, outputChars);
  return {
    total: resolved.total,
    costDefenseApplied: resolved.costBlendApplied,
    uncappedChargePoints: uncappedCharge,
    costDefenseFloorPoints: resolved.costBlendPoints,
  };
}

/** @deprecated resolveOpenRouterOpusTurnCharge — coldStartShieldApplied 필드명 호환 */
function applyOpusColdStartShieldToCharge(
  uncappedCharge: number,
  outputChars: number,
  actualApiCostKrw?: number
): OpusCostDefenseResult & {
  coldStartShieldApplied: boolean;
  coldStartCostFloorPoints?: number;
} {
  const result = applyOpusCostDefenseToCharge(uncappedCharge, outputChars, actualApiCostKrw);
  return {
    ...result,
    coldStartShieldApplied: result.costDefenseApplied,
    coldStartCostFloorPoints: result.costDefenseFloorPoints,
  };
}

function logBillingCostDefense(fields: {
  modelId?: string;
  cacheWriteTokens: number;
  outputChars: number;
  uncappedChargePoints: number;
  costBlendPoints?: number;
  finalChargePoints: number;
  costBlendApplied: boolean;
  actualApiCostPoints?: number;
  charCapPoints?: number;
}): void {
  if (!fields.costBlendApplied) return;
  console.log("[billing-opus-cost-blend]", {
    modelId: fields.modelId,
    cacheWriteTokens: fields.cacheWriteTokens,
    outputChars: fields.outputChars,
    actualApiCostPoints: fields.actualApiCostPoints,
    charCapPoints: fields.charCapPoints,
    uncappedChargePoints: fields.uncappedChargePoints,
    costBlendPoints: fields.costBlendPoints,
    finalChargePoints: fields.finalChargePoints,
  });
}

/** @deprecated OPENROUTER_OPUS_POINTS_PER_CHAR × 1000 */
export const OPENROUTER_OPUS_KRW_PER_1000_CHARS = OPENROUTER_OPUS_POINTS_PER_CHAR * 1000;

/** Claude Opus — API 원가 대비 최저 매출총이익률 (45% → 원가÷0.55) */
export const OPENROUTER_OPUS_GROSS_MARGIN =
  Number(process.env.OPENROUTER_OPUS_GROSS_MARGIN) || 0.45;

/** @deprecated OPENROUTER_OPUS_GROSS_MARGIN 사용 (markup ≠ gross margin) */
export const OPENROUTER_OPUS_COST_MARKUP = OPENROUTER_OPUS_GROSS_MARGIN;

/** DeepSeek V4 Pro — 출력 1토큰당 청구 (P) */
export const OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN = (() => {
  const perToken = process.env.OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN?.trim();
  if (perToken) return Number(perToken) || 0.022;
  return 0.022;
})();

/** @deprecated OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN 사용 */
export const OPENROUTER_DEEPSEEK_POINTS_PER_CHAR = OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN;

/** @deprecated OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN × 3000 — 레거시 env·audit용 */
export const OPENROUTER_DEEPSEEK_KRW_PER_3000_TOKENS =
  Number(
    process.env.OPENROUTER_DEEPSEEK_KRW_PER_3000_TOKENS ??
      process.env.OPENROUTER_DEEPSEEK_KRW_PER_3000_CHARS
  ) || OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN * 3000;

/** DeepSeek V4 Pro — API 원가 대비 최저 매출총이익률 (55% → 원가÷0.45) */
export const OPENROUTER_DEEPSEEK_GROSS_MARGIN =
  Number(process.env.OPENROUTER_DEEPSEEK_GROSS_MARGIN) || 0.55;

/** @deprecated OPENROUTER_DEEPSEEK_GROSS_MARGIN 사용 */
export const OPENROUTER_DEEPSEEK_COST_MARKUP = OPENROUTER_DEEPSEEK_GROSS_MARGIN;

/** Qwen 3.7 — 출력 1토큰당 청구 (P) */
export const OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN = (() => {
  const perToken = process.env.OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN?.trim();
  if (perToken) return Number(perToken) || 0.062;
  return 0.062;
})();

/** @deprecated OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN 사용 (구 1자당 과금) */
export const OPENROUTER_QWEN_POINTS_PER_CHAR = OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN;

/** Qwen — API 원가 대비 최저 매출총이익률 (55% → 원가÷0.45) */
export const OPENROUTER_QWEN_GROSS_MARGIN =
  Number(process.env.OPENROUTER_QWEN_GROSS_MARGIN) || 0.55;

/** GLM 5.2 — 출력 1토큰당 청구 (P) */
export const OPENROUTER_GLM_POINTS_PER_OUTPUT_TOKEN = (() => {
  const perToken = process.env.OPENROUTER_GLM_POINTS_PER_OUTPUT_TOKEN?.trim();
  if (perToken) return Number(perToken) || 0.03;
  return 0.03;
})();

/** GLM — API 원가 대비 최저 매출총이익률 (55% → 원가÷0.45) */
export const OPENROUTER_GLM_GROSS_MARGIN =
  Number(process.env.OPENROUTER_GLM_GROSS_MARGIN) || 0.55;

/** GLM — 과금 면제 턴 최소 차감 */
export const GLM_WAIVER_SUCCESS_MIN_COST = 50;

/** Gemini 2.5 Pro — 출력 1토큰당 청구 (P) — Qwen과 동일 단가 */
export const OPENROUTER_GEMINI_25_POINTS_PER_OUTPUT_TOKEN = (() => {
  const perToken = process.env.OPENROUTER_GEMINI_25_POINTS_PER_OUTPUT_TOKEN?.trim();
  if (perToken) return Number(perToken) || 0.065;
  return 0.065;
})();

/** Gemini 2.5 Pro — API 원가 대비 최저 매출총이익률 (55% → 원가÷0.45) */
export const OPENROUTER_GEMINI_25_GROSS_MARGIN =
  Number(process.env.OPENROUTER_GEMINI_25_GROSS_MARGIN) || 0.55;

/** Gemini 3.1 Pro — 출력 1토큰당 청구 (P) */
export const OPENROUTER_GEMINI_31_POINTS_PER_OUTPUT_TOKEN = (() => {
  const perToken = process.env.OPENROUTER_GEMINI_31_POINTS_PER_OUTPUT_TOKEN?.trim();
  if (perToken) return Number(perToken) || 0.075;
  return 0.075;
})();

/** @deprecated OPENROUTER_GEMINI_PRO_GROSS_MARGIN — 마진 과금 제거, 토큰 단가만 사용 */
export const OPENROUTER_GEMINI_PRO_GROSS_MARGIN =
  Number(process.env.OPENROUTER_GEMINI_PRO_GROSS_MARGIN) ||
  Number(process.env.OPENROUTER_GEMINI_31_PRO_GROSS_MARGIN) ||
  Number(process.env.OPENROUTER_SONNET_GROSS_MARGIN) ||
  0.55;

export type BillingProvider = "gemini" | "openrouter";

export type PointType = "PAID" | "FREE";

export type DeductionSlice = {
  transactionId: number;
  pointType: PointType;
  amount: number;
};

export type DeductResult = {
  balance: PointBalance;
  slices: DeductionSlice[];
  total: number;
};
export type PointBalance = {
  total: number;
  paid: number;
  free: number;
};

export class InsufficientPointsError extends Error {
  constructor(public balance: PointBalance) {
    super("INSUFFICIENT_POINTS");
    this.name = "InsufficientPointsError";
  }
}

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

export const PAID_POINTS_VALID_YEARS = 2;

function expiresModifier(pointType: PointType, validity?: { months?: number; years?: number }): string {
  if (validity?.years) return `+${validity.years} years`;
  if (validity?.months) return `+${validity.months} months`;
  return pointType === "PAID" ? `+${PAID_POINTS_VALID_YEARS} years` : `+${FREE_POINTS_VALID_MONTHS} months`;
}

function readBalance(db: ReturnType<typeof getDb>, userId: number): PointBalance {
  const rows = db
    .prepare(
      `SELECT point_type, COALESCE(SUM(remaining_amount), 0) AS amt
       FROM point_transactions
       WHERE user_id = ? AND remaining_amount > 0 AND expires_at > datetime('now')
       GROUP BY point_type`
    )
    .all(userId) as { point_type: PointType; amt: number }[];

  let paid = 0;
  let free = 0;
  for (const row of rows) {
    const amt = roundAmount(Number(row.amt));
    if (row.point_type === "PAID") paid = amt;
    else if (row.point_type === "FREE") free = amt;
  }
  return { total: roundAmount(paid + free), paid, free };
}

function syncUserPointsColumn(db: ReturnType<typeof getDb>, userId: number) {
  const { total } = readBalance(db, userId);
  db.prepare("UPDATE users SET points = ? WHERE id = ?").run(total, userId);
}

export type CreditPointsResult = {
  transactionId: number;
  logId: number;
};

/** 원장 적립 — PAID 2년 / FREE 기본 5개월 만료 (출석 등은 validity로 조정) */
export function creditPointsWithIds(
  db: ReturnType<typeof getDb>,
  userId: number,
  amount: number,
  pointType: PointType,
  reason: string,
  validity?: { months?: number; years?: number }
): CreditPointsResult | null {
  const rounded = roundAmount(amount);
  if (rounded <= 0) return null;

  const tx = db
    .prepare(
      `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
       VALUES (?, ?, ?, datetime('now', ?))`
    )
    .run(userId, pointType, rounded, expiresModifier(pointType, validity));
  const log = db
    .prepare("INSERT INTO point_logs (user_id, delta, reason) VALUES (?,?,?)")
    .run(userId, rounded, reason);
  syncUserPointsColumn(db, userId);

  return {
    transactionId: Number(tx.lastInsertRowid),
    logId: Number(log.lastInsertRowid),
  };
}

export function creditPoints(
  userId: number,
  amount: number,
  pointType: PointType,
  reason: string,
  validity?: { months?: number; years?: number }
) {
  const db = getDb();
  db.transaction(() => {
    creditPointsWithIds(db, userId, amount, pointType, reason, validity);
  })();
}

export type PointLogLink = {
  messageId?: number;
  chatId?: number;
};

/** FREE(만료 임박 순) → PAID(만료 임박 순) 우선 차감 */
export function deductPoints(
  userId: number,
  amount: number,
  reason: string,
  link?: PointLogLink
): DeductResult {
  const need = chargePoints(amount);
  if (need <= 0) {
    const balance = getPointBalance(userId);
    return { balance, slices: [], total: 0 };
  }

  const db = getDb();
  return db.transaction(() => {
    let remaining = need;
    const slices: DeductionSlice[] = [];

    const takeFromType = (pointType: PointType) => {
      const rows = db
        .prepare(
          `SELECT id, remaining_amount FROM point_transactions
           WHERE user_id = ? AND point_type = ? AND remaining_amount > 0 AND expires_at > datetime('now')
           ORDER BY expires_at ASC, id ASC`
        )
        .all(userId, pointType) as { id: number; remaining_amount: number }[];

      const update = db.prepare(
        "UPDATE point_transactions SET remaining_amount = ? WHERE id = ?"
      );

      for (const row of rows) {
        if (remaining <= 0) break;
        const available = roundAmount(row.remaining_amount);
        if (available <= 0) continue;
        const take = roundAmount(Math.min(available, remaining));
        update.run(roundAmount(available - take), row.id);
        slices.push({ transactionId: row.id, pointType, amount: take });
        remaining = roundAmount(remaining - take);
      }
    };

    takeFromType("FREE");
    takeFromType("PAID");

    if (remaining > 0.001) {
      throw new InsufficientPointsError(readBalance(db, userId));
    }

    const messageId = link?.messageId ?? null;
    const chatId = link?.chatId ?? null;
    db.prepare(
      "INSERT INTO point_logs (user_id, delta, reason, message_id, chat_id) VALUES (?,?,?,?,?)"
    ).run(userId, -need, reason, messageId, chatId);
    syncUserPointsColumn(db, userId);
    return { balance: readBalance(db, userId), slices, total: need };
  })();
}

export function getPointBalance(userId: number): PointBalance {
  return readBalance(getDb(), userId);
}

/** @deprecated creditPoints / deductPoints 사용 */
export function addPoints(userId: number, delta: number, reason: string, pointType: PointType = "FREE") {
  if (delta >= 0) creditPoints(userId, delta, pointType, reason);
  else deductPoints(userId, -delta, reason);
}

export function getPoints(userId: number): number {
  return getPointBalance(userId).total;
}

/** 중간 과금 계산 — 배율·원가 추정용 (소수 유지) */
function roundCostIntermediate(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 유저 포인트 차감액 — 소수점 없이 올림 */
function chargePoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

function geminiTier(modelId: string): number {
  return GEMINI_TIER[modelId] ?? 1.0;
}

function applyUserNoteSurcharge(
  baseCost: number,
  _userContextChars?: number
): { contextSurcharge: number; multiplier: number; total: number } {
  return { contextSurcharge: 0, multiplier: 1, total: chargePoints(baseCost) };
}

/** Gemini explicit cache read — 입력 단가 90% 할인 */
const GEMINI_CACHE_READ_INPUT_MULTIPLIER = 0.1;

export function computeGeminiStageCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0
): number {
  const tier = geminiTier(modelId);
  const cacheRead = Math.min(Math.max(0, cacheReadTokens), Math.max(0, inputTokens));
  const standardInput = Math.max(0, inputTokens - cacheRead);
  const cost =
    (standardInput / 1000) * BASE_GEMINI_INPUT * tier +
    (cacheRead / 1000) * BASE_GEMINI_INPUT * tier * GEMINI_CACHE_READ_INPUT_MULTIPLIER +
    (outputTokens / 1000) * BASE_GEMINI_OUTPUT * tier;
  return chargePoints(cost);
}

/** @deprecated openRouterUsdCostDetailed(billingRawCost) 사용 */
export function openRouterUsdCost(
  inputTokens: number,
  outputTokens: number,
  modelId?: string
): number {
  return openRouterUsdCostDetailed({
    promptTokens: inputTokens,
    outputTokens,
    modelId,
  });
}

function isOpenRouterOpusModel(modelId?: string): boolean {
  return /opus/i.test(modelId ?? "");
}

function openRouterCharFloorKrw(outputChars: number, unitChars: number, krwPerUnit: number): number {
  const chars = Math.max(0, outputChars);
  return chargePoints((chars / unitChars) * krwPerUnit);
}

function openRouterTokenFloorKrw(outputTokens: number, unitTokens: number, krwPerUnit: number): number {
  const tokens = Math.max(0, outputTokens);
  return chargePoints((tokens / unitTokens) * krwPerUnit);
}

function openRouterOpusCharFloorKrw(outputChars: number): number {
  return chargePoints(Math.max(0, outputChars) * OPENROUTER_OPUS_POINTS_PER_CHAR);
}

function openRouterDeepSeekTokenFloorKrw(outputTokens: number): number {
  return chargePoints(Math.max(0, outputTokens) * OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN);
}

function openRouterQwenTokenFloorKrw(outputTokens: number): number {
  return chargePoints(Math.max(0, outputTokens) * OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN);
}

function openRouterGlmTokenFloorKrw(outputTokens: number): number {
  return chargePoints(Math.max(0, outputTokens) * OPENROUTER_GLM_POINTS_PER_OUTPUT_TOKEN);
}

function openRouterGemini25TokenFloorKrw(outputTokens: number): number {
  return chargePoints(Math.max(0, outputTokens) * OPENROUTER_GEMINI_25_POINTS_PER_OUTPUT_TOKEN);
}

function openRouterGemini31TokenFloorKrw(outputTokens: number): number {
  return chargePoints(Math.max(0, outputTokens) * OPENROUTER_GEMINI_31_POINTS_PER_OUTPUT_TOKEN);
}

/** 입력 10k 초과 — 초과 1,000토큰 단위 × 1.25P (블록 올림) */
export function openRouterInputTokenSurchargeKrw(inputTokens: number): number {
  if (inputTokens < OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS) return 0;
  const excess = inputTokens - OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS;
  const blocks = Math.ceil(excess / 1000);
  return chargePoints(blocks * OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS);
}

function openRouterTokenOnlyTurnCost(tokenFloorKrw: number, inputTokens = 0): number {
  const inputSurcharge = openRouterInputTokenSurchargeKrw(inputTokens);
  return Math.max(
    OPENROUTER_MIN_TURN_COST,
    chargePoints(tokenFloorKrw + inputSurcharge)
  );
}

function openRouterGrossMarginChargeKrw(rawCostKrw: number, grossMargin: number): number {
  const margin = Math.min(0.95, Math.max(0, grossMargin));
  return margin < 1
    ? chargePoints(rawCostKrw / (1 - margin))
    : chargePoints(rawCostKrw);
}

function openRouterOpusMarginChargeKrw(rawCostKrw: number): number {
  return openRouterGrossMarginChargeKrw(rawCostKrw, OPENROUTER_OPUS_GROSS_MARGIN);
}

function openRouterDeepSeekMarginChargeKrw(rawCostKrw: number): number {
  return openRouterGrossMarginChargeKrw(rawCostKrw, OPENROUTER_DEEPSEEK_GROSS_MARGIN);
}

function openRouterQwenMarginChargeKrw(rawCostKrw: number): number {
  return openRouterGrossMarginChargeKrw(rawCostKrw, OPENROUTER_QWEN_GROSS_MARGIN);
}

function openRouterGlmMarginChargeKrw(rawCostKrw: number): number {
  return openRouterGrossMarginChargeKrw(rawCostKrw, OPENROUTER_GLM_GROSS_MARGIN);
}

function openRouterGemini25MarginChargeKrw(rawCostKrw: number): number {
  return openRouterGrossMarginChargeKrw(rawCostKrw, OPENROUTER_GEMINI_25_GROSS_MARGIN);
}

function openRouterGeminiProMarginChargeKrw(rawCostKrw: number): number {
  return openRouterGrossMarginChargeKrw(rawCostKrw, OPENROUTER_GEMINI_PRO_GROSS_MARGIN);
}

type OpenRouterTurnBillingBasis = {
  upstreamCostUsd?: number;
  /** upstream 없을 때 — API 보고 입력/출력 토큰 (reasoning 포함) */
  apiPromptTokens?: number;
  apiCompletionTokens?: number;
};

function resolveOpenRouterTurnRawCostKrw(
  inputTokens: number,
  outputTokens: number,
  modelId?: string,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">,
  basis?: OpenRouterTurnBillingBasis
): number {
  const promptTokens = basis?.apiPromptTokens ?? inputTokens;
  const completionTokens = basis?.apiCompletionTokens ?? outputTokens;
  return roundCostIntermediate(
    resolveOpenRouterBillingRawCostKrw({
      promptTokens,
      outputTokens: completionTokens,
      modelId,
      cacheReadTokens: cache?.cacheReadTokens,
      cacheWriteTokens: cache?.cacheWriteTokens,
      upstreamCostUsd: basis?.upstreamCostUsd,
    })
  );
}

function explainOpenRouterMarginOnlyFromRawCost(
  rawCostKrw: number,
  grossMargin: number
): OpenRouterTurnCostBreakdown & { total: number } {
  const costPlusMarginKrw = openRouterGrossMarginChargeKrw(rawCostKrw, grossMargin);
  const total = Math.max(OPENROUTER_MIN_TURN_COST, chargePoints(costPlusMarginKrw));
  let applied: OpenRouterTurnCostBreakdown["applied"] = "cost_plus_margin";
  if (total === OPENROUTER_MIN_TURN_COST && costPlusMarginKrw < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  }
  return { rawCostKrw, charFloorKrw: 0, costPlusMarginKrw, applied, total };
}

function openRouterMaxFloorTurnCost(charFloorKrw: number, costPlusMarginKrw: number): number {
  return Math.max(OPENROUTER_MIN_TURN_COST, Math.max(charFloorKrw, costPlusMarginKrw));
}

function openRouterMinFloorTurnCost(floorKrw: number, costPlusMarginKrw: number): number {
  return Math.max(OPENROUTER_MIN_TURN_COST, Math.min(floorKrw, costPlusMarginKrw));
}

/** Opus — min(글자 상한, 마진 floor) — 1자당 OPENROUTER_OPUS_POINTS_PER_CHAR P 초과 청구 없음 */
function openRouterOpusPreferredTurnCost(charFloorKrw: number, costPlusMarginKrw: number): number {
  return Math.max(
    OPENROUTER_MIN_TURN_COST,
    Math.min(charFloorKrw, costPlusMarginKrw)
  );
}

/** OpenRouter — Opus: min(1자×0.142P, 실제원가÷0.55); 원가>0.142P/자이면 (원가+1자×0.135P)/2 */
export function computeOpenRouterTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId?: string,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">,
  opts?: { outputChars?: number; billingBasis?: OpenRouterTurnBillingBasis }
): number {
  if (process.env.OPENROUTER_BILLING_MODE === "fixed") {
    return OPENROUTER_ADULT_FIXED_TURN_COST;
  }

  if (isOpenRouterOpusModel(modelId)) {
    return openRouterTokenOnlyTurnCost(
      openRouterOpusCharFloorKrw(opts?.outputChars ?? 0),
      inputTokens
    );
  }

  if (isDeepSeekV4ProModel(modelId ?? "")) {
    return openRouterTokenOnlyTurnCost(
      openRouterDeepSeekTokenFloorKrw(outputTokens),
      inputTokens
    );
  }

  if (isQwenModel(modelId ?? "")) {
    return openRouterTokenOnlyTurnCost(
      openRouterQwenTokenFloorKrw(outputTokens),
      inputTokens
    );
  }

  if (isGlmModel(modelId ?? "")) {
    return openRouterTokenOnlyTurnCost(
      openRouterGlmTokenFloorKrw(outputTokens),
      inputTokens
    );
  }

  if (isGemini25ProModel(modelId ?? "")) {
    return openRouterTokenOnlyTurnCost(
      openRouterGemini25TokenFloorKrw(outputTokens),
      inputTokens
    );
  }

  if (isGemini31ProModel(modelId ?? "")) {
    return openRouterTokenOnlyTurnCost(
      openRouterGemini31TokenFloorKrw(outputTokens),
      inputTokens
    );
  }

  const costKrw = roundCostIntermediate(
    openRouterUsdCostDetailed({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
      cacheReadTokens: cache?.cacheReadTokens,
      cacheWriteTokens: cache?.cacheWriteTokens,
    }) * getEffectiveKrwPerUsd()
  );
  return openRouterTokenOnlyTurnCost(chargePoints(costKrw), inputTokens);
}

export type OpenRouterTurnCostBreakdown = {
  rawCostKrw: number;
  /** Opus — cache-hit-normalized API 원가 (로그·비교용) */
  normalizedRawCostKrw?: number;
  charFloorKrw: number;
  /** 입력 10k 초과 1,000토큰당 1.25P */
  inputSurchargeKrw?: number;
  costPlusMarginKrw: number;
  applied: "char_floor" | "cost_plus_margin" | "min_turn" | "cost_blend" | "cold_start_shield";
  /** min(마진, 글자상한) 적용 전 청구 (P) */
  uncappedChargePoints?: number;
  coldStartShieldApplied?: boolean;
  /** 원가>글자상한 시 (원가+글자상한)/2 (P) */
  coldStartCostFloorPoints?: number;
};

function explainOpenRouterMaxFloorTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  floorKrw: number,
  marginChargeFn: (rawCostKrw: number) => number,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">
): OpenRouterTurnCostBreakdown & { total: number } {
  const rawCostKrw = roundCostIntermediate(
    openRouterUsdCostDetailed({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
      cacheReadTokens: cache?.cacheReadTokens,
      cacheWriteTokens: cache?.cacheWriteTokens,
    }) * getEffectiveKrwPerUsd()
  );
  const costPlusMarginKrw = marginChargeFn(rawCostKrw);
  const candidate = Math.max(floorKrw, costPlusMarginKrw);
  const total = chargePoints(Math.max(OPENROUTER_MIN_TURN_COST, candidate));
  let applied: OpenRouterTurnCostBreakdown["applied"] = "cost_plus_margin";
  if (total === OPENROUTER_MIN_TURN_COST && candidate < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  } else if (floorKrw >= costPlusMarginKrw) {
    applied = "char_floor";
  }
  return { rawCostKrw, charFloorKrw: floorKrw, costPlusMarginKrw, applied, total };
}

function explainOpenRouterMinFloorTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  floorKrw: number,
  marginChargeFn: (rawCostKrw: number) => number,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">
): OpenRouterTurnCostBreakdown & { total: number } {
  const rawCostKrw = roundCostIntermediate(
    openRouterUsdCostDetailed({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
      cacheReadTokens: cache?.cacheReadTokens,
      cacheWriteTokens: cache?.cacheWriteTokens,
    }) * getEffectiveKrwPerUsd()
  );
  const costPlusMarginKrw = marginChargeFn(rawCostKrw);
  const candidate = Math.min(floorKrw, costPlusMarginKrw);
  const total = chargePoints(Math.max(OPENROUTER_MIN_TURN_COST, candidate));
  let applied: OpenRouterTurnCostBreakdown["applied"] = "cost_plus_margin";
  if (total === OPENROUTER_MIN_TURN_COST && candidate < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  } else if (floorKrw <= costPlusMarginKrw) {
    applied = "char_floor";
  }
  return { rawCostKrw, charFloorKrw: floorKrw, costPlusMarginKrw, applied, total };
}

function explainOpenRouterMinFloorFromRawCost(
  rawCostKrw: number,
  floorKrw: number,
  marginChargeFn: (rawCostKrw: number) => number
): OpenRouterTurnCostBreakdown & { total: number } {
  const costPlusMarginKrw = marginChargeFn(rawCostKrw);
  const candidate = Math.min(floorKrw, costPlusMarginKrw);
  const total = chargePoints(Math.max(OPENROUTER_MIN_TURN_COST, candidate));
  let applied: OpenRouterTurnCostBreakdown["applied"] = "cost_plus_margin";
  if (total === OPENROUTER_MIN_TURN_COST && candidate < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  } else if (floorKrw <= costPlusMarginKrw) {
    applied = "char_floor";
  }
  return { rawCostKrw, charFloorKrw: floorKrw, costPlusMarginKrw, applied, total };
}

/** Margin-only floor — no token/char per-unit minimum (Sonnet 등) */
function explainOpenRouterMarginOnlyTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  grossMargin: number,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">
): OpenRouterTurnCostBreakdown & { total: number } {
  const rawCostKrw = roundCostIntermediate(
    openRouterUsdCostDetailed({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
      cacheReadTokens: cache?.cacheReadTokens,
      cacheWriteTokens: cache?.cacheWriteTokens,
    }) * getEffectiveKrwPerUsd()
  );
  const costPlusMarginKrw = openRouterGrossMarginChargeKrw(rawCostKrw, grossMargin);
  const total = Math.max(OPENROUTER_MIN_TURN_COST, chargePoints(costPlusMarginKrw));
  let applied: OpenRouterTurnCostBreakdown["applied"] = "cost_plus_margin";
  if (total === OPENROUTER_MIN_TURN_COST && costPlusMarginKrw < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  }
  return { rawCostKrw, charFloorKrw: 0, costPlusMarginKrw, applied, total };
}

function explainOpenRouterOpusPreferredTurnCost(
  charFloorKrw: number,
  costPlusMarginKrw: number
): Pick<OpenRouterTurnCostBreakdown, "applied"> & { preferredKrw: number } {
  const preferredKrw = Math.min(charFloorKrw, costPlusMarginKrw);
  const total = Math.max(OPENROUTER_MIN_TURN_COST, preferredKrw);
  let applied: OpenRouterTurnCostBreakdown["applied"] = "cost_plus_margin";
  if (total === OPENROUTER_MIN_TURN_COST && preferredKrw < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  } else if (charFloorKrw <= costPlusMarginKrw) {
    applied = "char_floor";
  }
  return { preferredKrw: chargePoints(total), applied };
}

function mapPricingSelectedRule(
  applied: OpenRouterTurnCostBreakdown["applied"]
): string {
  switch (applied) {
    case "char_floor":
      return "charPrice";
    case "cost_plus_margin":
      return "costFloor";
    case "min_turn":
      return "minTurn";
    case "cold_start_shield":
    case "cost_blend":
      return "costBlend";
    default:
      return String(applied);
  }
}

function logPricingStage(stage: "1" | "2" | "final", payload: Record<string, unknown>): void {
  console.log(`[pricing-stage-${stage}]`, payload);
}

function logPricingDebug(fields: {
  model: string;
  isFirstTurn: boolean;
  messageCount: number;
  outputChars: number;
  apiCost: number;
  normalizedApiCost?: number;
  charPrice: number;
  costFloor: number;
  selectedRule: string;
  finalCharge: number;
  coldStartShieldApplied?: boolean;
  uncappedChargePoints?: number;
}): void {
  console.log("[pricing-debug]");
  console.log(`model: ${fields.model}`);
  console.log(`isFirstTurn: ${fields.isFirstTurn}`);
  console.log(`messageCount: ${fields.messageCount}`);
  console.log(`outputChars: ${fields.outputChars}`);
  console.log(`apiCost: ${fields.apiCost}`);
  if (fields.normalizedApiCost != null) {
    console.log(`normalizedApiCost: ${fields.normalizedApiCost}`);
  }
  console.log(`charPrice: ${fields.charPrice}`);
  console.log(`costFloor: ${fields.costFloor}`);
  console.log(`selectedRule: ${fields.selectedRule}`);
  console.log(`finalCharge: ${fields.finalCharge}`);
  if (fields.coldStartShieldApplied) {
    console.log(`coldStartShieldApplied: true`);
    console.log(`uncappedChargePoints: ${fields.uncappedChargePoints}`);
  }
}

function logBillingNormalized(fields: {
  modelId?: string;
  standardInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  virtualInputTokens: number;
  cacheHitRateUsdPerM: number;
  outputRateUsdPerM: number;
  actualApiCostKrw: number;
  normalizedCostKrw: number;
}): void {
  console.log("[billing-normalized]", {
    modelId: fields.modelId,
    standardInputTokens: fields.standardInputTokens,
    cacheReadTokens: fields.cacheReadTokens,
    cacheWriteTokens: fields.cacheWriteTokens,
    virtualInputTokens: fields.virtualInputTokens,
    cacheHitRateUsdPerM: fields.cacheHitRateUsdPerM,
    outputRateUsdPerM: fields.outputRateUsdPerM,
    actualApiCostKrw: fields.actualApiCostKrw,
    normalizedCostKrw: fields.normalizedCostKrw,
  });
}

function logOpusTurnPricingTrace(opts: {
  modelLabel: string;
  messageCount: number;
  isFirstTurn: boolean;
  outputChars: number;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  userContextChars?: number;
  baseCost: number;
  contextSurcharge: number;
  multiplier: number;
  finalCharge: number;
  coldStartShieldApplied?: boolean;
  uncappedChargePoints?: number;
}): void {
  const cache = {
    cacheReadTokens: opts.cacheReadTokens,
    cacheWriteTokens: opts.cacheWriteTokens,
  };
  const explain = explainOpenRouterOpusTurnCost(
    opts.inputTokens,
    opts.outputTokens,
    opts.modelId,
    opts.outputChars,
    cache
  );

  logPricingStage("1", {
    path: "opus_standard_min_floor",
    apiCost: explain.rawCostKrw,
    normalizedApiCost: explain.normalizedRawCostKrw,
    charPrice: explain.charFloorKrw,
    costFloor: explain.costPlusMarginKrw,
    selectedRule: mapPricingSelectedRule(explain.applied),
    baseCostBeforeSurcharge: opts.baseCost,
  });

  logPricingStage("2", {
    baseCost: opts.baseCost,
    contextSurcharge: opts.contextSurcharge,
    multiplier: opts.multiplier,
    chargeAfterSurcharge: opts.finalCharge,
    overwrite:
      opts.multiplier > 1
        ? `userNoteSurcharge ×${opts.multiplier} (${opts.baseCost} → ${opts.finalCharge})`
        : "none",
  });

  logPricingStage("final", {
    selectedRule: opts.coldStartShieldApplied
      ? "coldStartShield"
      : mapPricingSelectedRule(explain.applied),
    baseCost: opts.baseCost,
    finalCharge: opts.finalCharge,
    ...(opts.coldStartShieldApplied
      ? {
          uncappedChargePoints: opts.uncappedChargePoints,
        }
      : {}),
    winner: opts.coldStartShieldApplied
      ? "coldStartShield"
      : opts.finalCharge > opts.baseCost
        ? "userNoteSurcharge"
        : mapPricingSelectedRule(explain.applied),
  });

  logPricingDebug({
    model: opts.modelLabel,
    isFirstTurn: opts.isFirstTurn,
    messageCount: opts.messageCount,
    outputChars: opts.outputChars,
    apiCost: explain.rawCostKrw,
    normalizedApiCost: explain.normalizedRawCostKrw,
    charPrice: explain.charFloorKrw,
    costFloor: explain.costPlusMarginKrw,
    selectedRule: opts.coldStartShieldApplied
      ? "coldStartShield"
      : mapPricingSelectedRule(explain.applied),
    finalCharge: opts.finalCharge,
    coldStartShieldApplied: opts.coldStartShieldApplied,
    uncappedChargePoints: opts.uncappedChargePoints,
  });
}

/** Opus 과금 상세 — 출력 1자당 0.142P */
export function explainOpenRouterOpusTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  outputChars: number,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">
): OpenRouterTurnCostBreakdown & { total: number } {
  const cacheRead = Math.max(0, cache?.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, cache?.cacheWriteTokens ?? 0);
  const rawCostKrw = roundCostIntermediate(
    openRouterUsdCostDetailed({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    }) * getEffectiveKrwPerUsd()
  );
  const normalized = openRouterNormalizedUsdCostFromRates({
    promptTokens: inputTokens,
    outputTokens,
    modelId,
  });
  const normalizedRawCostKrw = roundCostIntermediate(normalized.usdCost * getEffectiveKrwPerUsd());
  const charFloorKrw = openRouterOpusCharFloorKrw(outputChars);
  const inputSurchargeKrw = openRouterInputTokenSurchargeKrw(inputTokens);
  const resolved = resolveOpenRouterOpusTurnCharge(rawCostKrw, outputChars);
  const total = openRouterTokenOnlyTurnCost(charFloorKrw, inputTokens);
  let applied = resolved.applied;
  if (total === OPENROUTER_MIN_TURN_COST && charFloorKrw + inputSurchargeKrw < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  }
  return {
    rawCostKrw,
    normalizedRawCostKrw,
    charFloorKrw,
    inputSurchargeKrw,
    costPlusMarginKrw: 0,
    applied,
    total,
    uncappedChargePoints: total,
    coldStartShieldApplied: false,
    coldStartCostFloorPoints: undefined,
  };
}

function explainOpenRouterTokenOnlyTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  floorKrw: number,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">,
  billingBasis?: OpenRouterTurnBillingBasis
): OpenRouterTurnCostBreakdown & { total: number } {
  const rawCostKrw =
    isGemini25ProModel(modelId) || isGemini31ProModel(modelId)
      ? resolveOpenRouterTurnRawCostKrw(inputTokens, outputTokens, modelId, cache, billingBasis)
      : roundCostIntermediate(
          openRouterUsdCostDetailed({
            promptTokens: inputTokens,
            outputTokens,
            modelId,
            cacheReadTokens: cache?.cacheReadTokens,
            cacheWriteTokens: cache?.cacheWriteTokens,
          }) * getEffectiveKrwPerUsd()
        );
  const inputSurchargeKrw = openRouterInputTokenSurchargeKrw(inputTokens);
  const total = openRouterTokenOnlyTurnCost(floorKrw, inputTokens);
  let applied: OpenRouterTurnCostBreakdown["applied"] = "char_floor";
  if (total === OPENROUTER_MIN_TURN_COST && floorKrw + inputSurchargeKrw < OPENROUTER_MIN_TURN_COST) {
    applied = "min_turn";
  }
  return {
    rawCostKrw,
    charFloorKrw: floorKrw,
    inputSurchargeKrw,
    costPlusMarginKrw: 0,
    applied,
    total,
  };
}

/** DeepSeek V4 Pro 과금 상세 — 출력토큰×0.022P */
export function explainOpenRouterDeepSeekTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">
): OpenRouterTurnCostBreakdown & { total: number } {
  return explainOpenRouterTokenOnlyTurnCost(
    inputTokens,
    outputTokens,
    modelId,
    openRouterDeepSeekTokenFloorKrw(outputTokens),
    cache
  );
}

/** Qwen 3.7 과금 상세 — 출력토큰×0.062P */
export function explainOpenRouterQwenTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  _outputChars?: number,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">
): OpenRouterTurnCostBreakdown & { total: number } {
  return explainOpenRouterTokenOnlyTurnCost(
    inputTokens,
    outputTokens,
    modelId,
    openRouterQwenTokenFloorKrw(outputTokens),
    cache
  );
}

/** GLM 5.2 과금 상세 — 출력토큰×0.03P */
export function explainOpenRouterGlmTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  _outputChars?: number,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">
): OpenRouterTurnCostBreakdown & { total: number } {
  return explainOpenRouterTokenOnlyTurnCost(
    inputTokens,
    outputTokens,
    modelId,
    openRouterGlmTokenFloorKrw(outputTokens),
    cache
  );
}

/** OpenRouter Gemini 2.5 Pro — 출력토큰×0.065P */
export function explainOpenRouterGemini25TurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">,
  billingBasis?: OpenRouterTurnBillingBasis
): OpenRouterTurnCostBreakdown & { total: number } {
  return explainOpenRouterTokenOnlyTurnCost(
    inputTokens,
    outputTokens,
    modelId,
    openRouterGemini25TokenFloorKrw(outputTokens),
    cache,
    billingBasis
  );
}

/** OpenRouter Gemini 3.1 Pro — 출력토큰×0.075P */
export function explainOpenRouterGemini31TurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">,
  billingBasis?: OpenRouterTurnBillingBasis
): OpenRouterTurnCostBreakdown & { total: number } {
  return explainOpenRouterTokenOnlyTurnCost(
    inputTokens,
    outputTokens,
    modelId,
    openRouterGemini31TokenFloorKrw(outputTokens),
    cache,
    billingBasis
  );
}

/** OpenRouter Gemini Pro — 2.5/3.1 토큰 단가 과금 상세 */
export function explainOpenRouterGeminiProTurnCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  cache?: Pick<OpenRouterBillingInput, "cacheReadTokens" | "cacheWriteTokens">,
  billingBasis?: OpenRouterTurnBillingBasis
): OpenRouterTurnCostBreakdown & { total: number } {
  if (isGemini25ProModel(modelId)) {
    return explainOpenRouterGemini25TurnCost(
      inputTokens,
      outputTokens,
      modelId,
      cache,
      billingBasis
    );
  }
  return explainOpenRouterGemini31TurnCost(
    inputTokens,
    outputTokens,
    modelId,
    cache,
    billingBasis
  );
}

export function computeOpenRouterTurnBilling(opts: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputChars?: number;
  userContextChars?: number;
  modelLabel?: string;
  messageCount?: number;
  upstreamCostUsd?: number;
  apiPromptTokens?: number;
  apiCompletionTokens?: number;
}): {
  modelId: string;
  baseCost: number;
  contextSurcharge: number;
  multiplier: number;
  total: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  coldStartShieldApplied?: boolean;
  uncappedChargePoints?: number;
  coldStartCostFloorPoints?: number;
} {
  const cacheRead = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, opts.cacheWriteTokens ?? 0);
  const standardInputTokens = Math.max(0, opts.inputTokens - cacheRead - cacheWrite);
  const outputChars = opts.outputChars ?? 0;
  const modelLabel = opts.modelLabel ?? opts.modelId;
  const messageCount = opts.messageCount ?? 1;

  const billingBasis: OpenRouterTurnBillingBasis | undefined = isGeminiProOpenRouterModel(
    opts.modelId
  )
    ? {
        upstreamCostUsd: opts.upstreamCostUsd,
        apiPromptTokens: opts.apiPromptTokens,
        apiCompletionTokens: opts.apiCompletionTokens,
      }
    : undefined;

  const baseCost = computeOpenRouterTurnCost(
    opts.inputTokens,
    opts.outputTokens,
    opts.modelId,
    {
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    },
    { outputChars, billingBasis }
  );
  const explainForShield = isOpenRouterOpusModel(opts.modelId)
    ? explainOpenRouterOpusTurnCost(
        opts.inputTokens,
        opts.outputTokens,
        opts.modelId,
        outputChars,
        { cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
      )
    : null;
  const { contextSurcharge, multiplier, total } = applyUserNoteSurcharge(
    baseCost,
    opts.userContextChars
  );
  const uncappedChargePoints =
    explainForShield?.uncappedChargePoints != null
      ? applyUserNoteSurcharge(explainForShield.uncappedChargePoints, opts.userContextChars).total
      : baseCost;
  const coldStartShieldApplied =
    isOpenRouterOpusModel(opts.modelId) && Boolean(explainForShield?.coldStartShieldApplied);
  if (coldStartShieldApplied && explainForShield) {
    logBillingCostDefense({
      modelId: opts.modelId,
      cacheWriteTokens: cacheWrite,
      outputChars,
      actualApiCostPoints: chargePoints(explainForShield.rawCostKrw),
      charCapPoints: explainForShield.charFloorKrw,
      uncappedChargePoints,
      costBlendPoints: explainForShield.coldStartCostFloorPoints,
      finalChargePoints: total,
      costBlendApplied: true,
    });
  }
  if (isOpenRouterOpusModel(opts.modelId)) {
    logOpusTurnPricingTrace({
      modelLabel,
      messageCount,
      isFirstTurn: messageCount <= 1,
      outputChars,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      modelId: opts.modelId,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      userContextChars: opts.userContextChars,
      baseCost,
      contextSurcharge,
      multiplier,
      finalCharge: total,
      coldStartShieldApplied,
      uncappedChargePoints,
    });
    return {
      modelId: opts.modelId,
      baseCost,
      contextSurcharge,
      multiplier,
      total,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      standardInputTokens,
      coldStartShieldApplied,
      uncappedChargePoints,
      coldStartCostFloorPoints: explainForShield?.coldStartCostFloorPoints,
    };
  }
  return {
    modelId: opts.modelId,
    baseCost,
    contextSurcharge,
    multiplier,
    total,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    standardInputTokens,
  };
}

export type BillableOutputOpts = Record<string, never>;

/** 과금·tier cap — RP 본문 + 상태창 표시 텍스트 (마크업·파이프·HTML 태그 제외) */
export function narrativeTextForBilling(savedText: string, _opts?: BillableOutputOpts): string {
  return savedVisibleTextForReceipt(savedText);
}

/** 채팅 출력 과금 — 저장 표시 길이 (상태창 셀 텍스트 포함), 상한 없음 */
export function billableOutputChars(
  savedText: string,
  _targetInput?: number | null,
  opts?: BillableOutputOpts
): number {
  return Math.max(0, narrativeTextForBilling(savedText, opts).length);
}

/** 채팅 출력 과금 — API output_tokens 우선 (상태창 포함 토큰은 그대로 과금) */
export function billableOutputTokens(
  apiTokens: number,
  savedText: string,
  _targetInput?: number | null,
  opts?: BillableOutputOpts
): number {
  if (apiTokens > 0) return apiTokens;
  const len = narrativeTextForBilling(savedText, opts).length;
  return Math.max(1, Math.ceil(len * 0.9));
}

/** LOOP_ABORT·unknownError — 극단적 단문·퇴화(쓰레기)만 면제, tier 통과·건강한 부분 출력은 정상 과금 */
function resolveForcedAbortWaiverReason(
  text: string,
  targetResponseChars?: number | null
): BillingWaiverReason | null {
  if (isDegenerateOutput(text)) return "garbage_output";
  if (isCatastrophicallyShortResponse(text, targetResponseChars)) return "forced_abort";
  return null;
}

/** 반복·쓰레기·강제 중단·19+ OpenRouter 실패 응답 — 과금 면제 */
export function shouldWaiveTurnBilling(
  text: string,
  opts?: {
    forcedAbort?: boolean;
    degenerationAborted?: boolean;
    generationFailure?: GenerationFailureReason | null;
    unknownError?: boolean;
    /** 19+ OpenRouter 턴 — 오류·퇴화·조기중단 시 무조건 0P */
    adultMode?: boolean;
    targetResponseChars?: number | null;
  }
): BillingWaiverReason | null {
  if (opts?.degenerationAborted) return "degeneration";
  if (opts?.generationFailure) return "generation_failure";
  if (opts?.unknownError || opts?.forcedAbort) {
    return resolveForcedAbortWaiverReason(text, opts?.targetResponseChars);
  }
  if (isCatastrophicallyShortResponse(text, opts?.targetResponseChars)) return "generation_failure";
  if (isDegenerateOutput(text)) return "garbage_output";

  if (opts?.adultMode && isDegenerateOutput(text)) return "garbage_output";

  return null;
}

function resolveModelWaiverMinimumCharge(
  savedText: string,
  waiverReason: BillingWaiverReason,
  minCost: number,
  opts?: {
    degenerationAborted?: boolean;
    targetResponseChars?: number | null;
  }
): number {
  if (opts?.degenerationAborted) return 0;
  if (
    waiverReason === "garbage_output" ||
    waiverReason === "degeneration" ||
    waiverReason === "generation_failure" ||
    waiverReason === "over_reasoning"
  ) {
    return 0;
  }

  const trimmed = savedText.trim();
  if (!trimmed || isDegenerateOutput(trimmed)) return 0;
  if (isCatastrophicallyShortResponse(trimmed, opts?.targetResponseChars)) return 0;

  return minCost;
}

/**
 * DeepSeek — 과금 면제 턴이어도 본문이 유의미하게 전달됐으면 최소 차감.
 * (LOOP_ABORT 면제는 극단적 단문·퇴화만 — 대부분 정상 과금으로 처리됨)
 */
export function resolveDeepSeekWaiverMinimumCharge(
  savedText: string,
  waiverReason: BillingWaiverReason,
  opts?: {
    degenerationAborted?: boolean;
    targetResponseChars?: number | null;
  }
): number {
  return resolveModelWaiverMinimumCharge(
    savedText,
    waiverReason,
    DEEPSEEK_WAIVER_SUCCESS_MIN_COST,
    opts
  );
}

/** Qwen — 과금 면제 턴이어도 본문이 유의미하게 전달됐으면 최소 50P 차감 */
export function resolveQwenWaiverMinimumCharge(
  savedText: string,
  waiverReason: BillingWaiverReason,
  opts?: {
    degenerationAborted?: boolean;
    targetResponseChars?: number | null;
  }
): number {
  return resolveModelWaiverMinimumCharge(
    savedText,
    waiverReason,
    QWEN_WAIVER_SUCCESS_MIN_COST,
    opts
  );
}

/** GLM — 과금 면제 턴이어도 본문이 유의미하게 전달됐으면 최소 50P 차감 */
export function resolveGlmWaiverMinimumCharge(
  savedText: string,
  waiverReason: BillingWaiverReason,
  opts?: {
    degenerationAborted?: boolean;
    targetResponseChars?: number | null;
  }
): number {
  return resolveModelWaiverMinimumCharge(
    savedText,
    waiverReason,
    GLM_WAIVER_SUCCESS_MIN_COST,
    opts
  );
}

/** Gemini 2.5 Pro — 과금 면제 턴이어도 본문이 유의미하게 전달됐으면 최소 50P 차감 */
export function resolveGemini25WaiverMinimumCharge(
  savedText: string,
  waiverReason: BillingWaiverReason,
  opts?: {
    degenerationAborted?: boolean;
    targetResponseChars?: number | null;
  }
): number {
  return resolveModelWaiverMinimumCharge(
    savedText,
    waiverReason,
    GEMINI_25_WAIVER_SUCCESS_MIN_COST,
    opts
  );
}

/** Gemini 3.1 Pro — 과금 면제 턴이어도 본문이 유의미하게 전달됐으면 최소 65P 차감 */
export function resolveGemini31WaiverMinimumCharge(
  savedText: string,
  waiverReason: BillingWaiverReason,
  opts?: {
    degenerationAborted?: boolean;
    targetResponseChars?: number | null;
  }
): number {
  return resolveModelWaiverMinimumCharge(
    savedText,
    waiverReason,
    GEMINI_31_WAIVER_SUCCESS_MIN_COST,
    opts
  );
}

const GEMINI_BILLING_MODEL = /^gemini/i;

export function isGeminiBillingStage(stage: { model: string }): boolean {
  return GEMINI_BILLING_MODEL.test(stage.model) || stage.model === "demo";
}

/** One provider per turn — stealth fallback must never sum Gemini + OpenRouter stages. */
export function selectBillableStages(
  stages: StageUsage[],
  opts?: { stealthFallback?: boolean }
): StageUsage[] {
  if (!stages.length) return [];
  if (opts?.stealthFallback) {
    const openRouterOnly = stages.filter((s) => !isGeminiBillingStage(s));
    return openRouterOnly.length > 0 ? openRouterOnly : [stages[stages.length - 1]!];
  }
  return [stages[0]!];
}

/** OpenRouter 턴 — primary + continuation 등 모든 non-Gemini stage output 합산 (영수증·원가) */
export function sumOpenRouterStageOutputTokens(stages: StageUsage[]): number {
  return stages
    .filter((s) => !isGeminiBillingStage(s))
    .reduce((sum, s) => sum + Math.max(0, s.apiOutputTokens ?? s.output ?? 0), 0);
}

/** OpenRouter 턴 — primary + continuation stage reasoning_tokens 합산 (영수증 표시) */
export function sumOpenRouterStageReasoningTokens(stages: StageUsage[]): number {
  return stages
    .filter((s) => !isGeminiBillingStage(s))
    .reduce((sum, s) => sum + Math.max(0, s.apiReasoningOutputTokens ?? 0), 0);
}

/** OpenRouter 턴 — stage upstream_inference_cost 합산 (과금 원가 베이스) */
export function sumOpenRouterStageUpstreamUsd(stages: StageUsage[]): number {
  return stages
    .filter((s) => !isGeminiBillingStage(s))
    .reduce((sum, s) => sum + Math.max(0, s.upstreamCostUsd ?? 0), 0);
}

/**
 * OpenRouter 출력 과금 — Gemini Pro는 mandatory reasoning이 upstream에만 발생.
 * 유저 과금·영수증 출력은 content(표시 RP) 토큰만 사용.
 */
export function billableOpenRouterOutputTokens(
  modelId: string,
  totalApiOutputTokens: number,
  reasoningTokens: number
): number {
  if (totalApiOutputTokens <= 0) return 0;
  if (isGeminiProOpenRouterModel(modelId) && reasoningTokens > 0) {
    return Math.max(0, totalApiOutputTokens - reasoningTokens);
  }
  return totalApiOutputTokens;
}

/** Gemini/OpenRouter 공통 — stage 과금 입력을 promptAudit 조립값으로 상한 (패딩·API 과다 보고 방지) */
export function resolveTurnBillableInput(opts: {
  stageInput: number;
  promptAuditTotal?: number;
}): number {
  let billable = Math.max(0, opts.stageInput);
  if (opts.promptAuditTotal != null && opts.promptAuditTotal > 0) {
    billable = Math.min(billable, opts.promptAuditTotal);
  }
  return billable;
}

/** Single-provider token totals for one chat turn (never sums cross-provider stages). */
export function computeTurnBilling(opts: {
  provider?: BillingProvider;
  selectedAI?: SelectedAI;
  openRouterModelId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  userContextChars?: number;
  /** @deprecated userContextChars 사용 */
  userContextTokens?: number;
  upstreamCostUsd?: number;
  apiPromptTokens?: number;
  apiCompletionTokens?: number;
  /** OpenRouter Opus — 1자당 0.142P / DeepSeek·Qwen·Gemini — 출력토큰 단가만 (마진·노트 할증 없음) */
  savedTextChars?: number;
  /** pricing-debug — 완료 턴 수 (messageCount = completedTurnsBeforeRequest + 1) */
  completedTurnsBeforeRequest?: number;
  /** pricing-debug — 영수증 모델명 */
  modelLabel?: string;
}): {
  modelId: string;
  baseCost: number;
  contextSurcharge: number;
  multiplier: number;
  total: number;
} {
  if (opts.provider === "openrouter") {
    return computeOpenRouterTurnBilling({
      modelId: opts.openRouterModelId ?? "openrouter",
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      cacheReadTokens: opts.cacheReadTokens,
      cacheWriteTokens: opts.cacheWriteTokens,
      outputChars: opts.savedTextChars,
      userContextChars: opts.userContextChars ?? opts.userContextTokens,
      modelLabel: opts.modelLabel,
      messageCount: (opts.completedTurnsBeforeRequest ?? 0) + 1,
      upstreamCostUsd: opts.upstreamCostUsd,
      apiPromptTokens: opts.apiPromptTokens,
      apiCompletionTokens: opts.apiCompletionTokens,
    });
  }

  const selectedAI = resolveSelectedAI(opts.selectedAI);
  const modelId = billingModelId(selectedAI);
  const contextChars = opts.userContextChars ?? opts.userContextTokens ?? 0;

  const baseCost = computeGeminiStageCost(
    modelId,
    opts.inputTokens,
    opts.outputTokens,
    opts.cacheReadTokens ?? 0
  );
  const { contextSurcharge, multiplier, total } = applyUserNoteSurcharge(baseCost, contextChars);

  return { modelId, baseCost, contextSurcharge, multiplier, total };
}

export function memoryLimit(user: User): number {
  if (isSubscribed(user) && user.sub_plan && user.sub_plan in PLANS) {
    return PLANS[user.sub_plan as PlanId].memoryLimit;
  }
  return FREE_MEMORY_LIMIT;
}

/** 표준 1턴 — Flash 배경 작업 기준 (입 5k/출 2.5k 토큰) */
export function billingTierBenchmark() {
  const input = 5000;
  const output = 2500;
  return {
    flash: computeGeminiStageCost("gemini-2.5-flash", input, output),
  };
}

/** @deprecated HTML 전용 턴은 computeHtmlFlashOnlyTurnBilling (V3 + 55% 마진) 사용 */
export const FLASH_HTML_ONLY_OUTPUT_TOKENS_PER_TIER = 1000;
/** @deprecated */
export const FLASH_HTML_ONLY_WON_PER_TIER = 10;

/** @deprecated HTML 전용 턴은 computeHtmlFlashOnlyTurnBilling 사용 */
export function computeFlashHtmlOnlyOutputCharge(outputTokens: number): number {
  const tokens = Math.max(0, outputTokens);
  if (tokens <= 0) return 0;
  return chargePoints((tokens / FLASH_HTML_ONLY_OUTPUT_TOKENS_PER_TIER) * FLASH_HTML_ONLY_WON_PER_TIER);
}

/** @deprecated 출력 토큰 기준 — computeFlashHtmlOnlyOutputCharge 사용 */
export function computeFlashHtmlOnlyCharCharge(outputChars: number): number {
  return computeFlashHtmlOnlyOutputCharge(Math.max(400, Math.ceil(outputChars * 0.55)));
}

/** HTML 전용 턴 — DeepSeek V3 단독, API 원가 + 55% 마진 */
export function computeHtmlFlashOnlyTurnBilling(opts: {
  savedTextChars: number;
  userContextChars?: number;
  inputTokens?: number;
  outputTokens?: number;
  promptEstimateTokens?: number;
  upstreamCostUsd?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): {
  modelId: string;
  modelLabel: string;
  baseCost: number;
  contextSurcharge: number;
  multiplier: number;
  total: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  tokensEstimated: boolean;
  rawCostKrw: number;
} {
  const htmlChars = Math.max(0, opts.savedTextChars);
  const estimatedOutputTokens =
    opts.outputTokens != null && opts.outputTokens > 0
      ? opts.outputTokens
      : Math.min(
          HTML_ONLY_TURN_MAX_OUTPUT_TOKENS,
          Math.max(400, Math.ceil(htmlChars * 0.55))
        );
  const contextChars = opts.userContextChars ?? 0;
  const estimatedInputTokens =
    opts.inputTokens != null && opts.inputTokens > 0
      ? opts.inputTokens
      : opts.promptEstimateTokens != null && opts.promptEstimateTokens > 0
        ? Math.min(HTML_ONLY_TURN_MAX_INPUT_TOKENS, opts.promptEstimateTokens)
        : Math.min(
            HTML_ONLY_TURN_MAX_INPUT_TOKENS,
            Math.max(2000, Math.ceil(contextChars / 2.5) + 1500)
          );
  const tokensEstimated = !(opts.inputTokens != null && opts.inputTokens > 0);
  const cache = {
    cacheReadTokens: opts.cacheReadTokens,
    cacheWriteTokens: opts.cacheWriteTokens,
  };
  const billingBasis =
    opts.upstreamCostUsd != null && opts.upstreamCostUsd > 0
      ? {
          upstreamCostUsd: opts.upstreamCostUsd,
          apiPromptTokens: estimatedInputTokens,
          apiCompletionTokens: estimatedOutputTokens,
        }
      : undefined;
  const rawCostKrw = resolveOpenRouterTurnRawCostKrw(
    estimatedInputTokens,
    estimatedOutputTokens,
    OPENROUTER_DEEPSEEK_V3_MODEL,
    cache,
    billingBasis
  );
  const costPlusMarginKrw = openRouterDeepSeekMarginChargeKrw(rawCostKrw);
  const inputSurchargeKrw = openRouterInputTokenSurchargeKrw(estimatedInputTokens);
  const total = Math.max(
    OPENROUTER_MIN_TURN_COST,
    chargePoints(costPlusMarginKrw + inputSurchargeKrw)
  );
  return {
    modelId: OPENROUTER_DEEPSEEK_V3_MODEL,
    modelLabel: HTML_ONLY_MODEL_LABEL,
    baseCost: costPlusMarginKrw,
    contextSurcharge: inputSurchargeKrw,
    multiplier: 1,
    total,
    estimatedInputTokens,
    estimatedOutputTokens,
    tokensEstimated,
    rawCostKrw,
  };
}
