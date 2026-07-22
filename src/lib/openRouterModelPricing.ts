/**
 * OpenRouter 모델별 list price + prompt cache 요율.
 * @see https://openrouter.ai/docs/guides/best-practices/prompt-caching
 * @see https://api-docs.deepseek.com/quick_start/pricing (DeepSeek V4 Pro cache hit)
 */

export type OpenRouterCacheFamily = "anthropic" | "deepseek" | "google" | "unknown";

export type OpenRouterModelRates = {
  family: OpenRouterCacheFamily;
  label: string;
  inputUsdPerM: number;
  outputUsdPerM: number;
  /** cache read — 절대 $/1M (DeepSeek) */
  cacheReadUsdPerM?: number;
  /** cache read — 입력 대비 배율 (Claude 0.1 = 90% 할인) */
  cacheReadMultiplier?: number;
  /** cache write — 입력 대비 배율 (Claude 5분 TTL 1.25) */
  cacheWriteMultiplier: number;
  /** 우리가 cache_control을 주입·지원하는 모델 */
  explicitCacheInjection: boolean;
};

/** Anthropic Claude Opus 4.x — OpenRouter list */
const ANTHROPIC_OPUS_RATES: OpenRouterModelRates = {
  family: "anthropic",
  label: "Anthropic prompt cache",
  inputUsdPerM: 5,
  outputUsdPerM: 25,
  cacheReadMultiplier: 0.1,
  cacheWriteMultiplier: 1.25,
  explicitCacheInjection: true,
};

/**
 * DeepSeek V3 0324 — OpenRouter headline estimate (fallback only).
 * Checked 2026-07-17: ~$0.24/M in, ~$0.90/M out; provider prices vary.
 * Prefer usage.upstreamCostUsd / OpenRouter reported cost when present.
 */
const DEEPSEEK_V3_0324_RATES: OpenRouterModelRates = {
  family: "deepseek",
  label: "DeepSeek V3 0324 (fallback estimate)",
  inputUsdPerM: 0.24,
  outputUsdPerM: 0.9,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** DeepSeek V4 Pro — OpenRouter / DeepSeek official (2026) */
const DEEPSEEK_V4_PRO_RATES: OpenRouterModelRates = {
  family: "deepseek",
  label: "DeepSeek 자동 prefix 캐시",
  inputUsdPerM: 0.435,
  outputUsdPerM: 0.87,
  cacheReadUsdPerM: 0.003625,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/**
 * Google Gemini 2.5 Flash — OpenRouter list (fallback estimate).
 * Checked 2026-07-17: $0.30/M in, $2.50/M out, cache read $0.03/M.
 * Prefer usage.upstreamCostUsd when present.
 */
const GEMINI_25_FLASH_RATES: OpenRouterModelRates = {
  family: "google",
  label: "Google Gemini 2.5 Flash (fallback estimate)",
  inputUsdPerM: 0.3,
  outputUsdPerM: 2.5,
  cacheReadUsdPerM: 0.03,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** Google Gemini 2.5 Pro — OpenRouter list */
const GEMINI_25_PRO_RATES: OpenRouterModelRates = {
  family: "google",
  label: "Google Gemini prompt cache",
  inputUsdPerM: 1.25,
  outputUsdPerM: 10,
  cacheReadMultiplier: 0.25,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** Google Gemini 3.1 Pro Preview — OpenRouter list */
const GEMINI_31_PRO_RATES: OpenRouterModelRates = {
  family: "google",
  label: "Google Gemini prompt cache",
  inputUsdPerM: 2,
  outputUsdPerM: 12,
  cacheReadMultiplier: 0.25,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** Qwen3.7 Max — OpenRouter list (prompt cache supported) */
const QWEN_37_MAX_RATES: OpenRouterModelRates = {
  family: "unknown",
  label: "Qwen prompt cache",
  inputUsdPerM: 1.25,
  outputUsdPerM: 3.75,
  cacheReadUsdPerM: 0.25,
  cacheWriteMultiplier: 1.25,
  explicitCacheInjection: true,
};

/** Z.ai GLM 5.2 — OpenRouter list ($0.532/M in, $1.672/M out) */
const GLM_52_RATES: OpenRouterModelRates = {
  family: "unknown",
  label: "Z.ai GLM prompt cache",
  inputUsdPerM: 0.532,
  outputUsdPerM: 1.672,
  cacheReadUsdPerM: 0.0988,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** MoonshotAI Kimi K3 — OpenRouter list ($3/M in, $15/M out, cache read $0.30/M) */
const KIMI_K3_RATES: OpenRouterModelRates = {
  family: "unknown",
  label: "MoonshotAI Kimi prompt cache",
  inputUsdPerM: 3,
  outputUsdPerM: 15,
  cacheReadUsdPerM: 0.3,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** Meta Muse Spark 1.1 — OpenRouter list ($1.25/M in, $4.25/M out, cache read $0.15/M) */
const MUSE_SPARK_11_RATES: OpenRouterModelRates = {
  family: "unknown",
  label: "Meta Muse Spark prompt cache",
  inputUsdPerM: 1.25,
  outputUsdPerM: 4.25,
  cacheReadUsdPerM: 0.15,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** Tencent Hy3 — OpenRouter list ($0.14/M in, $0.58/M out, cache read $0.035/M) */
const TENCENT_HY3_RATES: OpenRouterModelRates = {
  family: "unknown",
  label: "Tencent Hy3 자동 캐시",
  inputUsdPerM: 0.14,
  outputUsdPerM: 0.58,
  cacheReadUsdPerM: 0.035,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

const GENERIC_OPENROUTER_RATES: OpenRouterModelRates = {
  family: "unknown",
  label: "제공자 자동 캐시",
  inputUsdPerM: 0.4,
  outputUsdPerM: 0.4,
  cacheReadMultiplier: 1,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

export function resolveOpenRouterModelRates(modelId?: string | null): OpenRouterModelRates {
  const id = (modelId ?? "").trim().toLowerCase();
  // Exact / specific model ids before broad family matches.
  if (id.includes("gemini-2.5-flash")) return GEMINI_25_FLASH_RATES;
  if (id.includes("deepseek-chat-v3-0324")) return DEEPSEEK_V3_0324_RATES;
  if (id.includes("deepseek")) return DEEPSEEK_V4_PRO_RATES;
  if (id.includes("gemini-3.1-pro")) return GEMINI_31_PRO_RATES;
  if (id.includes("gemini-2.5-pro")) return GEMINI_25_PRO_RATES;
  if (id.includes("claude") || id.includes("anthropic/")) return ANTHROPIC_OPUS_RATES;
  if (id.includes("qwen")) return QWEN_37_MAX_RATES;
  if (id.startsWith("z-ai/glm") || id.includes("/glm-")) return GLM_52_RATES;
  if (id.startsWith("moonshotai/kimi") || id.includes("/kimi-k3") || /(^|\/)kimi[-.]?k3\b/.test(id)) {
    return KIMI_K3_RATES;
  }
  if (id.includes("muse-spark") || /(^|\/)muse[-.]?spark\b/.test(id)) {
    return MUSE_SPARK_11_RATES;
  }
  if (id.includes("/hy3") || /(^|\/)hy3\b/i.test(id)) {
    return TENCENT_HY3_RATES;
  }
  return GENERIC_OPENROUTER_RATES;
}

export function resolveCacheReadUsdPerM(rates: OpenRouterModelRates): number {
  if (rates.cacheReadUsdPerM != null) return rates.cacheReadUsdPerM;
  const mult = rates.cacheReadMultiplier ?? 1;
  return rates.inputUsdPerM * mult;
}

export function resolveCacheWriteUsdPerM(rates: OpenRouterModelRates): number {
  return rates.inputUsdPerM * rates.cacheWriteMultiplier;
}

/** UI용 — cache read 할인율 (0~100) */
export function cacheReadDiscountPercent(rates: OpenRouterModelRates): number | null {
  if (rates.family === "unknown") return null;
  const read = resolveCacheReadUsdPerM(rates);
  if (rates.inputUsdPerM <= 0) return null;
  const pct = (1 - read / rates.inputUsdPerM) * 100;
  return Math.round(pct * 10) / 10;
}

export type OpenRouterCacheReceiptInfo = {
  family: OpenRouterCacheFamily;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  cacheReadLine: string | null;
  cacheWriteLine: string | null;
  /** 추정 원가 계산에 사용한 요율 요약 */
  rateSummary: string;
};

export function buildOpenRouterCacheReceiptInfo(opts: {
  modelId?: string | null;
  promptTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  standardInputTokens?: number;
}): OpenRouterCacheReceiptInfo | null {
  const cacheRead = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, opts.cacheWriteTokens ?? 0);
  if (cacheRead <= 0 && cacheWrite <= 0) return null;

  const rates = resolveOpenRouterModelRates(opts.modelId);
  const prompt = Math.max(0, opts.promptTokens ?? 0);
  const standard =
    opts.standardInputTokens ??
    Math.max(0, prompt - cacheRead - cacheWrite);

  const discountPct = cacheReadDiscountPercent(rates);

  let cacheReadLine: string | null = null;
  if (cacheRead > 0) {
    if (rates.family === "anthropic") {
      cacheReadLine = `${cacheRead.toLocaleString()} (Anthropic prompt cache · 입력 90% 할인)`;
    } else if (rates.family === "deepseek" && discountPct != null) {
      cacheReadLine = `${cacheRead.toLocaleString()} (DeepSeek 자동 prefix 캐시 · 입력 ~${discountPct}% 할인)`;
    } else if (rates.family === "google" && discountPct != null) {
      cacheReadLine = `${cacheRead.toLocaleString()} (Google Gemini 자동 캐시 · 입력 ~${discountPct}% 할인)`;
    } else {
      cacheReadLine = `${cacheRead.toLocaleString()} (${rates.label} · 할인율 미등록)`;
    }
  }

  let cacheWriteLine: string | null = null;
  if (cacheWrite > 0) {
    if (rates.family === "anthropic") {
      cacheWriteLine = `${cacheWrite.toLocaleString()} (캐시 저장 · 5분 TTL · 입력 125% 단가)`;
    } else if (rates.family === "deepseek") {
      cacheWriteLine = `${cacheWrite.toLocaleString()} (캐시 저장 · 입력과 동일 단가)`;
    } else if (rates.family === "google") {
      cacheWriteLine = `${cacheWrite.toLocaleString()} (캐시 저장 · 입력과 동일 단가)`;
    } else {
      cacheWriteLine = `${cacheWrite.toLocaleString()} (캐시 저장)`;
    }
  }

  const rateSummary =
    rates.family === "deepseek"
      ? `입력 $${rates.inputUsdPerM}/M · 캐시히트 $${rates.cacheReadUsdPerM}/M · 출력 $${rates.outputUsdPerM}/M`
      : rates.family === "anthropic"
        ? `입력 $${rates.inputUsdPerM}/M · 캐시히트 10% · 캐시쓰기 125% · 출력 $${rates.outputUsdPerM}/M`
        : rates.family === "google"
          ? `입력 $${rates.inputUsdPerM}/M · 캐시히트 25% · 출력 $${rates.outputUsdPerM}/M`
          : `입력 $${rates.inputUsdPerM}/M · 출력 $${rates.outputUsdPerM}/M`;

  return {
    family: rates.family,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    standardInputTokens: standard,
    cacheReadLine,
    cacheWriteLine,
    rateSummary,
  };
}

export type OpenRouterBillingBreakdown = {
  standardInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usdCost: number;
  rates: OpenRouterModelRates;
};

export type OpenRouterNormalizedBillingBreakdown = {
  /** standard + cache_write + cache_read (= prompt total) */
  virtualInputTokens: number;
  /** $/1M — model-specific cache read rate */
  cacheHitRateUsdPerM: number;
  outputRateUsdPerM: number;
  usdCost: number;
  rates: OpenRouterModelRates;
};

/**
 * Normalized API cost — bill input as if 100% cache hit (platform standard).
 * virtual_input = standard + cache_write + cache_read; no cache-write surcharge.
 */
export function openRouterNormalizedUsdCostFromRates(opts: {
  promptTokens: number;
  outputTokens: number;
  modelId?: string | null;
}): OpenRouterNormalizedBillingBreakdown {
  const rates = resolveOpenRouterModelRates(opts.modelId);
  const virtualInputTokens = Math.max(0, opts.promptTokens);
  const cacheHitRateUsdPerM = resolveCacheReadUsdPerM(rates);
  const outputRateUsdPerM = rates.outputUsdPerM;
  const usdCost =
    (virtualInputTokens / 1_000_000) * cacheHitRateUsdPerM +
    (Math.max(0, opts.outputTokens) / 1_000_000) * outputRateUsdPerM;
  return {
    virtualInputTokens,
    cacheHitRateUsdPerM,
    outputRateUsdPerM,
    usdCost,
    rates,
  };
}

/** OpenRouter USD API 원가 — 모델별 cache read/write 단가 분리 */
export function openRouterUsdCostFromRates(opts: {
  promptTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  modelId?: string | null;
}): OpenRouterBillingBreakdown {
  const rates = resolveOpenRouterModelRates(opts.modelId);
  const promptTokens = Math.max(0, opts.promptTokens);
  const cacheRead = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, opts.cacheWriteTokens ?? 0);
  const cappedRead = Math.min(cacheRead, promptTokens);
  const cappedWrite = Math.min(cacheWrite, Math.max(0, promptTokens - cappedRead));
  const standardInput = Math.max(0, promptTokens - cappedRead - cappedWrite);

  const readRate = resolveCacheReadUsdPerM(rates);
  const writeRate = resolveCacheWriteUsdPerM(rates);

  const usdCost =
    (standardInput / 1_000_000) * rates.inputUsdPerM +
    (cappedRead / 1_000_000) * readRate +
    (cappedWrite / 1_000_000) * writeRate +
    (Math.max(0, opts.outputTokens) / 1_000_000) * rates.outputUsdPerM;

  return {
    standardInputTokens: standardInput,
    cacheReadTokens: cappedRead,
    cacheWriteTokens: cappedWrite,
    usdCost,
    rates,
  };
}
