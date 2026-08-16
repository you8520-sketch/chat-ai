/**
 * OpenRouter 모델별 list price + prompt cache 요율.
 * @see https://openrouter.ai/docs/guides/best-practices/prompt-caching
 * @see https://api-docs.deepseek.com/quick_start/pricing (DeepSeek V4 Pro cache hit)
 */
import { resolveCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";

export type OpenRouterCacheFamily = "anthropic" | "deepseek" | "google" | "openai" | "unknown";

export type OpenRouterModelRates = {
  family: OpenRouterCacheFamily;
  label: string;
  inputUsdPerM: number;
  outputUsdPerM: number;
  /** cache read — 절대 $/1M (DeepSeek) */
  cacheReadUsdPerM?: number;
  /** cache read — 입력 대비 배율 (Claude 0.1 = 90% 할인) */
  cacheReadMultiplier?: number;
  /** cache write — 절대 $/1M (OpenAI Terra) */
  cacheWriteUsdPerM?: number;
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

/** Cheaper Inference Claude Opus 5 — account catalog snapshot (2026-07-29). */
const CHEAPER_INFERENCE_CLAUDE_OPUS_5_RATES: OpenRouterModelRates = {
  family: "anthropic",
  label: "Cheaper Inference · Anthropic prompt cache",
  inputUsdPerM: 3.5,
  outputUsdPerM: 17.5,
  cacheReadUsdPerM: 0.35,
  cacheWriteUsdPerM: 4.375,
  cacheWriteMultiplier: 1.25,
  explicitCacheInjection: true,
};

/** Cheaper Inference GPT-5.6 Luna — account catalog snapshot (2026-07-29). */
const CHEAPER_INFERENCE_GPT_56_LUNA_RATES: OpenRouterModelRates = {
  family: "openai",
  label: "Cheaper Inference · OpenAI automatic cache",
  inputUsdPerM: 1,
  outputUsdPerM: 6,
  cacheReadUsdPerM: 0.1,
  cacheWriteUsdPerM: 1,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** Cheaper Inference DeepSeek V4 Pro — account catalog snapshot (2026-07-29). */
const CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_RATES: OpenRouterModelRates = {
  family: "deepseek",
  label: "Cheaper Inference · DeepSeek automatic cache",
  inputUsdPerM: 0.3045,
  outputUsdPerM: 0.609,
  cacheReadUsdPerM: 0.231,
  cacheWriteUsdPerM: 0.3045,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** Cheaper Inference Gemini 3.1 Pro Preview — live fallback snapshot (2026-07-29). */
const CHEAPER_INFERENCE_GEMINI_31_PRO_RATES: OpenRouterModelRates = {
  family: "google",
  label: "Cheaper Inference · Google automatic cache",
  inputUsdPerM: 1.4,
  outputUsdPerM: 8.4,
  cacheReadUsdPerM: 0.4375,
  cacheWriteUsdPerM: 1.4,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/**
 * Cheaper Inference Gemini 3.7 Flash — site-stated list (do not retune).
 * Input $0.53 / cached input $0.02625 / output $2.63 per 1M.
 * Cache write was not listed on-site; catalog snapshot write is recorded separately.
 */
const CHEAPER_INFERENCE_GEMINI_37_FLASH_RATES: OpenRouterModelRates = {
  family: "google",
  label: "Cheaper Inference · Google automatic cache",
  inputUsdPerM: 0.53,
  outputUsdPerM: 2.63,
  cacheReadUsdPerM: 0.02625,
  cacheWriteUsdPerM: 0.017708,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
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

/** Cheaper Inference DeepSeek V4 Flash — account catalog snapshot (2026-07-29). */
const CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_RATES: OpenRouterModelRates = {
  family: "deepseek",
  label: "Cheaper Inference · DeepSeek automatic cache",
  inputUsdPerM: 0.098,
  outputUsdPerM: 0.196,
  cacheReadUsdPerM: 0.0196,
  cacheWriteUsdPerM: 0.098,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** OpenRouter DeepSeek V4 Flash — public model price (2026-08). */
const OPENROUTER_DEEPSEEK_V4_FLASH_RATES: OpenRouterModelRates = {
  family: "deepseek",
  label: "OpenRouter · DeepSeek V4 Flash",
  inputUsdPerM: 0.09,
  outputUsdPerM: 0.18,
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

/** Google Gemini 3.6 Flash — OpenRouter list (2026-07-21) */
const GEMINI_36_FLASH_RATES: OpenRouterModelRates = {
  family: "google",
  label: "Google Gemini prompt cache",
  inputUsdPerM: 1.5,
  outputUsdPerM: 7.5,
  cacheReadUsdPerM: 0.15,
  cacheWriteMultiplier: 1 / 18,
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

/** Upstage Solar Pro 3 — OpenRouter list ($0.15/M in, $0.60/M out, cache read $0.015/M) */
const SOLAR_PRO_3_RATES: OpenRouterModelRates = {
  family: "unknown",
  label: "Upstage Solar prompt cache",
  inputUsdPerM: 0.15,
  outputUsdPerM: 0.6,
  cacheReadUsdPerM: 0.015,
  cacheWriteMultiplier: 1,
  explicitCacheInjection: false,
};

/** Cheaper Inference GPT-5.6 Terra — account catalog snapshot (2026-07-29). */
const CHEAPER_INFERENCE_GPT_56_TERRA_RATES: OpenRouterModelRates = {
  family: "openai",
  label: "Cheaper Inference · OpenAI automatic cache",
  inputUsdPerM: 2.5,
  outputUsdPerM: 15,
  cacheReadUsdPerM: 0.25,
  cacheWriteUsdPerM: 2.5,
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

function withLiveCheaperInferenceRates(
  modelId: string,
  fallback: OpenRouterModelRates
): OpenRouterModelRates {
  const live = resolveCheaperInferenceCatalogPricing(modelId);
  if (!live) return fallback;
  return {
    ...fallback,
    inputUsdPerM: live.inputUsdPerMillion,
    outputUsdPerM: live.outputUsdPerMillion,
    cacheReadUsdPerM: live.cacheReadUsdPerMillion,
    cacheWriteUsdPerM: live.cacheWriteUsdPerMillion,
    cacheWriteMultiplier:
      live.inputUsdPerMillion > 0
        ? live.cacheWriteUsdPerMillion / live.inputUsdPerMillion
        : fallback.cacheWriteMultiplier,
  };
}

export function resolveOpenRouterModelRates(modelId?: string | null): OpenRouterModelRates {
  const id = (modelId ?? "").trim().toLowerCase();
  // Exact / specific model ids before broad family matches.
  // Cheaper Inference: prefer live /models catalog rates; else published snapshot fallback.
  if (id === "claude-opus-5") {
    return withLiveCheaperInferenceRates(id, CHEAPER_INFERENCE_CLAUDE_OPUS_5_RATES);
  }
  if (id === "deepseek-v4-pro") {
    return withLiveCheaperInferenceRates(
      id,
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_RATES
    );
  }
  if (id === "gpt-5.6-terra") {
    return withLiveCheaperInferenceRates(
      id,
      CHEAPER_INFERENCE_GPT_56_TERRA_RATES
    );
  }
  if (id === "gpt-5.6-luna") {
    return withLiveCheaperInferenceRates(id, CHEAPER_INFERENCE_GPT_56_LUNA_RATES);
  }
  if (id === "gemini-3.1-pro-preview") {
    return withLiveCheaperInferenceRates(
      id,
      CHEAPER_INFERENCE_GEMINI_31_PRO_RATES
    );
  }
  if (id === "gemini-3.7-flash") {
    return withLiveCheaperInferenceRates(
      id,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_RATES
    );
  }
  if (id === "deepseek-v4-flash") {
    return withLiveCheaperInferenceRates(
      id,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_RATES
    );
  }
  if (id === "deepseek/deepseek-v4-flash") {
    return OPENROUTER_DEEPSEEK_V4_FLASH_RATES;
  }
  if (id.includes("gemini-2.5-flash")) return GEMINI_25_FLASH_RATES;
  if (id.includes("gemini-3.6-flash")) return GEMINI_36_FLASH_RATES;
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
  if (id.includes("/solar-pro-3") || /(^|\/)solar[-.]?pro[-.]?3\b/.test(id)) {
    return SOLAR_PRO_3_RATES;
  }
  return GENERIC_OPENROUTER_RATES;
}

export function resolveCacheReadUsdPerM(rates: OpenRouterModelRates): number {
  if (rates.cacheReadUsdPerM != null) return rates.cacheReadUsdPerM;
  const mult = rates.cacheReadMultiplier ?? 1;
  return rates.inputUsdPerM * mult;
}

export function resolveCacheWriteUsdPerM(rates: OpenRouterModelRates): number {
  if (rates.cacheWriteUsdPerM != null) return rates.cacheWriteUsdPerM;
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
    } else if (rates.family === "openai" && discountPct != null) {
      cacheReadLine = `${cacheRead.toLocaleString()} (OpenAI prompt cache · 입력 ~${discountPct}% 할인)`;
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
    } else if (rates.family === "openai") {
      const cacheWriteRateLabel =
        Math.abs(rates.cacheWriteMultiplier - 1) < 0.0001
          ? "입력과 동일 단가"
          : `입력 ${Math.round(rates.cacheWriteMultiplier * 100)}% 단가`;
      cacheWriteLine = `${cacheWrite.toLocaleString()} (캐시 저장 · ${cacheWriteRateLabel})`;
    } else {
      cacheWriteLine = `${cacheWrite.toLocaleString()} (캐시 저장)`;
    }
  }

  const rateSummary = formatOpenRouterRateSummary(rates);

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

export function formatOpenRouterRateSummary(rates: OpenRouterModelRates): string {
  if (rates.family === "deepseek") {
    return `입력 $${rates.inputUsdPerM}/M · 캐시히트 $${rates.cacheReadUsdPerM}/M · 출력 $${rates.outputUsdPerM}/M`;
  }
  if (rates.family === "anthropic") {
    return `입력 $${rates.inputUsdPerM}/M · 캐시히트 10% · 캐시쓰기 125% · 출력 $${rates.outputUsdPerM}/M`;
  }
  if (rates.family === "google") {
    return `입력 $${rates.inputUsdPerM}/M · 캐시히트 25% · 출력 $${rates.outputUsdPerM}/M`;
  }
  if (rates.family === "openai") {
    const write = resolveCacheWriteUsdPerM(rates);
    const read = resolveCacheReadUsdPerM(rates);
    return `입력 $${rates.inputUsdPerM}/M · 캐시히트 $${read}/M · 캐시쓰기 $${write}/M · 출력 $${rates.outputUsdPerM}/M`;
  }
  return `입력 $${rates.inputUsdPerM}/M · 출력 $${rates.outputUsdPerM}/M`;
}

/** 캐시 토큰이 없어도 영수증에 모델 요율을 붙일 때 사용 */
export function resolveOpenRouterRateSummary(modelId?: string | null): string {
  return formatOpenRouterRateSummary(resolveOpenRouterModelRates(modelId));
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
