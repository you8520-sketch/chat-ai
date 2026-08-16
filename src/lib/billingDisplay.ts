import { type AdultHandoffReceiptLines } from "@/lib/adultHandoffDisplay";
import {
  billingModelId,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  resolveSelectedAI,
  selectedAILabel,
  type SelectedAI,
} from "./chatModels";
import { openRouterRawCostKrw } from "@/lib/billingRawCost";
import {
  buildOpenRouterCacheReceiptInfo,
  openRouterUsdCostFromRates,
  resolveOpenRouterModelRates,
} from "@/lib/openRouterModelPricing";
import {
  convertUsdToKrw,
  formatExchangeRateLabel,
  OVERSEAS_CARD_FEE_RATE,
  resolveBillingExchangeRateSnapshot,
} from "@/lib/exchangeRate";
import type { Usage } from "@/lib/chatUsage";
import {
  formatGemini37FlashAdminMarginLines,
  formatGemini37FlashAdminPricingLines,
  type Gemini37FlashPricingBreakdown,
} from "@/lib/gemini37FlashPricing";

function roundReceiptKrw(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Token-metered receipt / raw-cost providers. */
export function isMeteredReceiptProvider(provider?: string | null): boolean {
  return (
    provider === "openrouter" ||
    provider === "openai" ||
    provider === "cheaperinference"
  );
}

export type MainRpApiCostPartsKrw = {
  /** 입력(캐시 반영) 원가 */
  inputKrw: number;
  /** content 출력 원가 (thinking 제외) */
  outputKrw: number;
  /** thinking/reasoning 원가 (출력 단가) */
  thinkingKrw: number;
  inputTokens: number;
  outputContentTokens: number;
  thinkingTokens: number;
};

/**
 * 관리자 영수증용 — 메인 RP API 원가를 입력 / content 출력 / thinking으로 분리.
 * 모델 list 요율 기준. thinking은 OpenRouter와 같이 출력 단가로 산정.
 * 저장된 메인 합계(mainApiRawCostKrw)가 있으면 비율 스케일해 합이 맞도록 맞춤.
 */
export function resolveMainRpApiCostPartsKrw(usage: Usage): MainRpApiCostPartsKrw | null {
  if (!isMeteredReceiptProvider(usage.provider)) return null;

  const inputTokens = Math.max(0, usage.apiInputTokens ?? usage.input ?? 0);
  const thinkingTokens = Math.max(0, usage.apiReasoningOutputTokens ?? 0);
  const apiOut = Math.max(0, usage.apiOutputTokens ?? usage.output ?? 0);
  const outputContentTokens = Math.max(
    0,
    usage.apiContentOutputTokens ?? Math.max(0, apiOut - thinkingTokens)
  );

  if (inputTokens <= 0 && outputContentTokens <= 0 && thinkingTokens <= 0) {
    return null;
  }

  const rates = resolveOpenRouterModelRates(usage.model);
  const inputUsd = openRouterUsdCostFromRates({
    promptTokens: inputTokens,
    outputTokens: 0,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    modelId: usage.model,
  }).usdCost;
  const outputUsd = (outputContentTokens / 1_000_000) * rates.outputUsdPerM;
  const thinkingUsd = (thinkingTokens / 1_000_000) * rates.outputUsdPerM;
  const rateTotalUsd = inputUsd + outputUsd + thinkingUsd;
  if (rateTotalUsd <= 0) return null;

  const effectiveRate =
    usage.exchangeRateKrwPerUsd != null && usage.exchangeRateKrwPerUsd > 0
      ? usage.exchangeRateKrwPerUsd
      : resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;

  let inputKrw = convertUsdToKrw(inputUsd, effectiveRate);
  let outputKrw = convertUsdToKrw(outputUsd, effectiveRate);
  let thinkingKrw = convertUsdToKrw(thinkingUsd, effectiveRate);

  const mainTotal =
    usage.mainApiRawCostKrw != null && usage.mainApiRawCostKrw > 0
      ? usage.mainApiRawCostKrw
      : usage.statusWidgetExtract
        ? null
        : usage.apiRawCostKrw != null && usage.apiRawCostKrw > 0
          ? usage.apiRawCostKrw
          : null;

  if (mainTotal != null && mainTotal > 0) {
    const partsSum = inputKrw + outputKrw + thinkingKrw;
    if (partsSum > 0) {
      const scale = mainTotal / partsSum;
      inputKrw *= scale;
      outputKrw *= scale;
      thinkingKrw *= scale;
    }
  }

  return {
    inputKrw: roundReceiptKrw(inputKrw),
    outputKrw: roundReceiptKrw(outputKrw),
    thinkingKrw: roundReceiptKrw(thinkingKrw),
    inputTokens,
    outputContentTokens,
    thinkingTokens,
  };
}

export function billingModelDisplayName(selectedAI: string): string {
  return selectedAILabel(selectedAI);
}

/** 19+·스텔스 OpenRouter — 영수증에 Gemini 모델명만 노출 */
export function stealthReceiptModelFields(selectedAI: string): {
  model: string;
  modelLabel: string;
  selectedAI: SelectedAI;
} {
  const resolved = resolveSelectedAI(selectedAI);
  return {
    model: billingModelId(resolved),
    modelLabel: billingModelDisplayName(resolved),
    selectedAI: resolved,
  };
}

export function formatPoints(n: number): string {
  // Keep SSR/CSR formatting deterministic to avoid hydration mismatches.
  return Number.isInteger(n)
    ? n.toLocaleString("ko-KR")
    : n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

/** Display-only: valid stored widget extract call counts; omit invalid/legacy missing. */
export function resolveStoredWidgetExtractCallCount(
  value: unknown
): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return null;
}

/**
 * 영수증 API 원가 (KRW).
 * 우선순위:
 * 1) 과금 시점 저장 스냅샷 (apiRawCostKrw) — 당시 upstream 또는 카탈로그×환율
 * 2) 공급자 실시간 차감 USD (upstreamCostUsd) × 저장/현재 환율
 * 3) 이용 사이트 게시 요율(실시간 카탈로그 → 하드코드 스냅샷) × 토큰 × 환율
 */
export function resolveApiRawCostKrw(usage: Usage): number | null {
  if (!isMeteredReceiptProvider(usage.provider)) return null;
  if (usage.apiRawCostKrw != null && usage.apiRawCostKrw > 0) {
    return usage.apiRawCostKrw;
  }
  const input = usage.apiInputTokens ?? usage.input ?? 0;
  const output = usage.apiOutputTokens ?? usage.output ?? 0;
  if (input <= 0 && output <= 0 && !(usage.upstreamCostUsd != null && usage.upstreamCostUsd > 0)) {
    return null;
  }

  return openRouterRawCostKrw({
    promptTokens: input,
    outputTokens: output,
    modelId: usage.model,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    upstreamCostUsd: usage.upstreamCostUsd,
    exchangeRate:
      usage.exchangeRateKrwPerUsd != null
        ? {
            effectiveKrwPerUsd: usage.exchangeRateKrwPerUsd,
            dateKey: usage.exchangeRateDateKey ?? "",
            mode: usage.exchangeRateMode ?? "daily_kst",
            source: usage.exchangeRateSource ?? "fallback",
          }
        : undefined,
  });
}

/**
 * 실현 마진율(%) = 1 - (API 원가 KRW / 실제 차감 P). 1P=1원.
 * 원가는 resolveApiRawCostKrw 우선순위(실시간 차감 → 게시 요율)를 따른다.
 */
export function resolveRealizedMarginRatePercent(
  usage: Usage,
  deductedPoints: number
): number | null {
  if (!(deductedPoints > 0)) return null;
  const apiRawCostKrw = resolveApiRawCostKrw(usage);
  if (apiRawCostKrw == null || !(apiRawCostKrw > 0)) return null;
  return Math.round((1 - apiRawCostKrw / deductedPoints) * 100);
}

/** 영수증 환율 라벨 — 저장값 없으면 현재 고정 환율 */
export function resolveExchangeRateReceiptLabel(usage: Usage): string {
  if (usage.exchangeRateKrwPerUsd != null && usage.exchangeRateDateKey) {
    return formatExchangeRateLabel({
      mode: usage.exchangeRateMode ?? "daily_kst",
      dateKey: usage.exchangeRateDateKey,
      usdToKrw: usage.exchangeRateKrwPerUsd / OVERSEAS_CARD_FEE_RATE,
      effectiveKrwPerUsd: usage.exchangeRateKrwPerUsd,
      source: usage.exchangeRateSource ?? "fallback",
    });
  }
  return formatExchangeRateLabel(resolveBillingExchangeRateSnapshot());
}

/** OpenRouter 캐시 영수증 줄 — usage에 없으면 modelId로 생성 */
export function resolveOpenRouterCacheReceipt(usage: Usage) {
  if (usage.cacheReadLine || usage.cacheWriteLine) {
    return {
      cacheReadLine: usage.cacheReadLine ?? null,
      cacheWriteLine: usage.cacheWriteLine ?? null,
      rateSummary: usage.cacheRateSummary,
      standardInputTokens: usage.standardInputTokens,
    };
  }
  const info = buildOpenRouterCacheReceiptInfo({
    modelId: usage.model,
    promptTokens: usage.input,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    standardInputTokens: usage.standardInputTokens,
  });
  if (!info) return null;
  return {
    cacheReadLine: info.cacheReadLine,
    cacheWriteLine: info.cacheWriteLine,
    rateSummary: info.rateSummary,
    standardInputTokens: info.standardInputTokens,
  };
}

export type BillingReceipt = {
  modelLabel: string;
  inputTokens: number;
  outputTokens: number;
  baseCost: number;
  surchargeAmount: number;
  totalCost: number;
  hasSurcharge: boolean;
  estimated?: boolean;
  /** 0P 면제 턴 */
  waived?: boolean;
  waiverReason?: string;
};

const BILLING_WAIVER_LABELS: Record<string, string> = {
  forced_abort: "반복·조기 중단으로 출력이 극단적으로 짧아 포인트가 차감되지 않았습니다.",
  degeneration: "출력 오류로 포인트가 차감되지 않았습니다.",
  generation_failure: "목표 분량 미달·생성 실패로 포인트가 차감되지 않았습니다.",
  garbage_output: "비정상 출력으로 포인트가 차감되지 않았습니다.",
};

export function billingWaiverLabel(reason?: string | null): string {
  if (!reason) return "이번 턴은 포인트가 차감되지 않았습니다.";
  return BILLING_WAIVER_LABELS[reason] ?? "이번 턴은 포인트가 차감되지 않았습니다.";
}

function resolveReceiptModelLabel(usage: {
  modelLabel?: string;
  selectedAI?: string;
  model?: string;
  provider?: string;
}): string {
  return (
    usage.modelLabel ??
    (usage.selectedAI
      ? billingModelDisplayName(usage.selectedAI)
      : isMeteredReceiptProvider(usage.provider) && usage.model
        ? usage.model
        : usage.model ?? "")
  );
}

export function buildBillingReceipt(usage: {
  cost: number;
  input?: number;
  output?: number;
  apiInputTokens?: number;
  apiOutputTokens?: number;
  apiContentOutputTokens?: number;
  baseCost?: number;
  surchargeAmount?: number;
  noteSurcharge?: number;
  modelLabel?: string;
  selectedAI?: string;
  model?: string;
  provider?: string;
  estimated?: boolean;
  stages?: { cost: number }[];
  billingWaived?: boolean;
  billingWaiverReason?: string;
}): BillingReceipt | null {
  const modelLabel = resolveReceiptModelLabel(usage);
  if (!modelLabel) return null;

  const inputTokens = usage.apiInputTokens ?? usage.input ?? 0;
  const outputTokens =
    usage.apiContentOutputTokens != null
      ? usage.apiContentOutputTokens
      : usage.apiOutputTokens ?? usage.output ?? 0;

  if (usage.billingWaived) {
    return {
      modelLabel,
      inputTokens,
      outputTokens,
      baseCost: 0,
      surchargeAmount: 0,
      totalCost: 0,
      hasSurcharge: false,
      estimated: usage.estimated,
      waived: true,
      waiverReason: usage.billingWaiverReason,
    };
  }

  if (!usage.cost || usage.cost <= 0) return null;

  return {
    modelLabel,
    inputTokens,
    outputTokens,
    baseCost: usage.cost,
    surchargeAmount: 0,
    totalCost: usage.cost,
    hasSurcharge: false,
    estimated: usage.estimated,
  };
}

/** 클립보드 복사용 평문 영수증 */
export function formatBillingReceiptText(
  receipt: BillingReceipt,
  extra?: {
    route?: "safe" | "nsfw";
    breakdown?: { label: string; tokens: number; pct: number }[];
    apiRawCostKrw?: number | null;
    coldStartShieldApplied?: boolean;
    uncappedChargePoints?: number | null;
    coldStartCostFloorPoints?: number | null;
    cacheReadLine?: string | null;
    cacheWriteLine?: string | null;
    cacheRateSummary?: string;
    standardInputTokens?: number;
    exchangeRateLabel?: string;
    apiReasoningOutputTokens?: number;
    apiContentOutputTokens?: number;
    statusWidgetExtract?: Usage["statusWidgetExtract"];
    statusWidgetExtractDiagnostics?: Usage["statusWidgetExtractDiagnostics"];
    mainApiRawCostKrw?: number;
    apiRawCostSource?: Usage["apiRawCostSource"];
    mainRpCostParts?: MainRpApiCostPartsKrw | null;
    gemini37FlashPricing?: Gemini37FlashPricingBreakdown;
    catalogApiRawCostKrw?: number | null;
    adultHandoff?: AdultHandoffReceiptLines | null;
  }
): string {
  const lines: string[] = [];
  if (extra?.route) {
    lines.push(`모드: ${extra.route === "nsfw" ? "성인" : "일반"}`);
  }
  if (extra?.adultHandoff) {
    lines.push(
      `선택 모델: ${extra.adultHandoff.selectedModelLabel}`,
      `실제 처리: ${extra.adultHandoff.actualModelLabel}`,
      `사유: ${extra.adultHandoff.reason}`
    );
  } else {
    lines.push(`모델: ${receipt.modelLabel}`);
  }
  lines.push(
    `입력/출력 토큰: ${receipt.inputTokens.toLocaleString()} / ${receipt.outputTokens.toLocaleString()}${receipt.estimated ? " (추정)" : ""}`
  );
  if (extra?.gemini37FlashPricing) {
    lines.push(...formatGemini37FlashAdminPricingLines(extra.gemini37FlashPricing));
    const catalogUsd = openRouterUsdCostFromRates({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: extra.gemini37FlashPricing.inputTokens,
      outputTokens: extra.gemini37FlashPricing.billedOutputTokens,
    }).usdCost;
    const catalogKrw = extra.catalogApiRawCostKrw ?? convertUsdToKrw(catalogUsd);
    lines.push(
      ...formatGemini37FlashAdminMarginLines({
        userPoints: extra.gemini37FlashPricing.totalPoints,
        actualApiRawCostKrw: extra.mainApiRawCostKrw ?? extra.apiRawCostKrw ?? null,
        catalogApiRawCostKrw: catalogKrw,
      })
    );
  }
  if (extra?.apiReasoningOutputTokens != null && extra.apiReasoningOutputTokens > 0) {
    lines.push(`thinking: ${extra.apiReasoningOutputTokens.toLocaleString()} tokens`);
    lines.push(
      `content (표시 RP): ${(extra.apiContentOutputTokens ?? 0).toLocaleString()} tokens`
    );
    const outputPlusThinking =
      (extra.apiContentOutputTokens ?? 0) + extra.apiReasoningOutputTokens;
    lines.push(`output + thinking: ${outputPlusThinking.toLocaleString()} tokens`);
  }
  if (extra?.apiRawCostKrw != null && extra.apiRawCostKrw > 0) {
    if (extra.statusWidgetExtract) {
      const widgetLabel = extra.statusWidgetExtract.modelLabel.replace(
        / \(상태창 추출\)$/,
        ""
      );
      const callCount = resolveStoredWidgetExtractCallCount(
        extra.statusWidgetExtract.callCount
      );
      const callCountSuffix = callCount != null ? ` · ${callCount}회` : "";
      lines.push(
        `메인 RP API 원가: ~${formatPoints(extra.mainApiRawCostKrw ?? extra.apiRawCostKrw)}원`
      );
      if (extra.mainRpCostParts) {
        const p = extra.mainRpCostParts;
        lines.push(
          `  입력 토큰 원가: ~${formatPoints(p.inputKrw)}원 (${p.inputTokens.toLocaleString()} tok)`,
          `  출력 토큰 원가: ~${formatPoints(p.outputKrw)}원 (${p.outputContentTokens.toLocaleString()} tok)`,
          `  thinking 토큰 원가: ~${formatPoints(p.thinkingKrw)}원 (${p.thinkingTokens.toLocaleString()} tok)`
        );
      }
      lines.push(
        `위젯 API 원가 (${widgetLabel}${callCountSuffix}): ${extra.statusWidgetExtract.input.toLocaleString()} / ${extra.statusWidgetExtract.output.toLocaleString()} tokens · ~${formatPoints(extra.statusWidgetExtract.apiRawCostKrw)}원`,
        `API 원가 합계 (메인+위젯): ~${formatPoints(extra.apiRawCostKrw)}원`
      );
    } else {
      const rawCostLabel =
        extra.apiRawCostSource === "provider_reported"
          ? "공급자 보고 API 원가"
          : extra.apiRawCostSource === "live_catalog"
            ? "API 원가 (실시간 카탈로그 추정)"
            : "API 원가 (저장 요율 추정)";
      lines.push(`${rawCostLabel}: ~${formatPoints(extra.apiRawCostKrw)}원`);
      if (extra.mainRpCostParts) {
        const p = extra.mainRpCostParts;
        lines.push(
          `  입력 토큰 원가: ~${formatPoints(p.inputKrw)}원 (${p.inputTokens.toLocaleString()} tok)`,
          `  출력 토큰 원가: ~${formatPoints(p.outputKrw)}원 (${p.outputContentTokens.toLocaleString()} tok)`,
          `  thinking 토큰 원가: ~${formatPoints(p.thinkingKrw)}원 (${p.thinkingTokens.toLocaleString()} tok)`
        );
      }
    }
  }
  if (extra?.statusWidgetExtractDiagnostics) {
    lines.push(
      `위젯 진단: ${
        extra.statusWidgetExtractDiagnostics.usedFallback
          ? "V3 폴백 사용"
          : extra.statusWidgetExtractDiagnostics.exhausted
            ? "추출 실패"
            : "정상"
      }`
    );
    for (const attempt of extra.statusWidgetExtractDiagnostics.attempts) {
      lines.push(
        `- ${attempt.stage} · ${attempt.modelId}: HTTP ${attempt.httpStatus ?? "없음"} · finish ${attempt.finishReason ?? "없음"}${attempt.errorCode ? ` · ${attempt.errorCode}` : ""}`
      );
    }
  }
  if (extra?.coldStartShieldApplied) {
    if (extra.coldStartCostFloorPoints != null && extra.coldStartCostFloorPoints > 0) {
      lines.push(`원가·글자 블렌드 (0.135P/자): ${formatPoints(extra.coldStartCostFloorPoints)} P`);
    }
    if (extra.uncappedChargePoints != null && extra.uncappedChargePoints > 0) {
      lines.push(`방어선 적용 전 청구: ${formatPoints(extra.uncappedChargePoints)} P`);
    }
  }
  if (extra?.cacheReadLine) {
    lines.push(`캐시 히트: ${extra.cacheReadLine}`);
  }
  if (extra?.cacheWriteLine) {
    lines.push(`캐시 저장: ${extra.cacheWriteLine}`);
  }
  if (extra?.standardInputTokens != null && extra.standardInputTokens > 0 && extra.cacheReadLine) {
    lines.push(`신규 입력: ${extra.standardInputTokens.toLocaleString()}`);
  }
  if (extra?.cacheRateSummary) {
    lines.push(`캐시 요율: ${extra.cacheRateSummary}`);
  }
  if (extra?.exchangeRateLabel) {
    lines.push(`적용 환율: ${extra.exchangeRateLabel}`);
  }
  lines.push(`포인트 차감: ${formatPoints(receipt.totalCost)} P`);
  if (extra?.breakdown?.length) {
    lines.push("", "컨텍스트 분해 (추정):");
    for (const row of extra.breakdown) {
      if (row.tokens > 0) {
        lines.push(`- ${row.label}: ${row.tokens.toLocaleString()} 토큰 (${row.pct}%)`);
      }
    }
  }
  return lines.join("\n");
}
