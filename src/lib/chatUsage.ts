import type { BillingWaiverReason } from "@/lib/points";
import type { Gemini37FlashPricingBreakdown } from "@/lib/gemini37FlashPricing";

/** Admin-only — canonical billing contract dispatch metadata (never public receipt). */
export type UsageBillingContractAdmin = {
  billingContract: "published_phase1" | "legacy";
  billingContractReason: string;
  deliveredModelId: string;
  publishedCandidateStatus: string;
  publishedBlockReason: string | null;
  pricingVersion: number | null;
  publishedFinalPoints: number | null;
  legacyFinalPoints: number;
  settledDeductedPoints: number;
};

export type Usage = {
  input: number;
  output: number;
  model: string;
  provider?: "gemini" | "openrouter" | "openai" | "cheaperinference";
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
  cacheFamily?: "anthropic" | "deepseek" | "google" | "openai" | "unknown";
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
  /** Next-turn picker — promptAudit.totalAssembledTokens at generation time */
  assembledInputTokens?: number;
  /** Admin/debug — proportional section allocation metadata */
  breakdownAllocation?: "estimated_section_allocation";
  /** Admin/debug — RAW window health for memory policy verification */
  rawHistoryHealth?: {
    rawCompleteExchanges: number;
    rawMessages: number;
    rawChars: number;
    rawInternalEstimate: number;
    summaryInterval: number;
    summarizedThroughTurn: number;
    unsummarizedCompletedTurns: number;
    policyViolation?: boolean;
    realRawCompleteExchanges?: number;
    realRawMessages?: number;
    realRawChars?: number;
    openingPreludePresent?: boolean;
    openingPreludeChars?: number;
    generalRouteBridgePresent?: boolean;
    generalRouteBridgeChars?: number;
  };
  /** Admin/debug — assembled prompt character counts (not provider tokens). */
  assembledPromptChars?: {
    system: number;
    systemRules: number;
    characterSettings: number;
    dynamic: number;
    history: number;
    currentUser: number;
    total: number;
  };
  /** Gemini 3.7 Flash — admin receipt breakdown (user price ignores cache/upstream). */
  gemini37FlashPricing?: Gemini37FlashPricingBreakdown;
  /** OpenRouter API 원가 (KRW, 마진 전) */
  apiRawCostKrw?: number;
  /** 공급자 실비 또는 해당 턴의 카탈로그 요율 추정 구분 */
  apiRawCostSource?: "provider_reported" | "live_catalog" | "fallback_catalog";
  /** Opus — cache-hit-normalized API 원가 (KRW, 마진 floor 입력) */
  normalizedRawCostKrw?: number;
  /** 과금 시점 USD→KRW (×2% 포함) */
  exchangeRateKrwPerUsd?: number;
  exchangeRateDateKey?: string;
  exchangeRateMode?: "daily_kst" | "realtime";
  exchangeRateSource?: "api" | "fallback" | "api_daily" | "previous_daily_snapshot" | "emergency_fallback";
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
  /** HTML 전용 턴 — 백그라운드 단독 (라우팅: GPT-5.6 Luna), 메인 RP 모델 미사용 */
  htmlFlashOnly?: boolean;
  /** 메인 RP OpenRouter 원가 (KRW) — 상태창 추출 분리 표시용 */
  mainApiRawCostKrw?: number;
  /** 상태창 추출 — 관리자·데모 영수증 (platform-funded; no user surcharge) */
  statusWidgetExtract?: {
    model: string;
    modelLabel: string;
    input: number;
    output: number;
    apiRawCostKrw: number;
    /** background extract API calls this turn (1–4); absent on legacy stored receipts */
    callCount?: number;
    /** Admin provenance — one Luna call served widget + suggested replies initial. */
    postTurnSharedInitial?: boolean;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    upstreamCostUsd?: number;
    estimated?: boolean;
    /** CheaperInference aggregate settled USD — admin receipt v2 only. */
    actualProviderCostUsd?: number;
    actualProviderCostKrw?: number;
    actualCostSource?: string;
    actualCostCoverage?: "complete" | "partial" | "unavailable";
  };
  /** 관리자 전용 — 위젯 추출 실패/폴백 진단. 일반 사용자 영수증에서는 제거됨. */
  statusWidgetExtractDiagnostics?: {
    exhausted: boolean;
    usedFallback: boolean;
    attempts: Array<{
      stage: "initial" | "repair" | "fallback" | "volatile_echo_repair";
      modelId: string;
      httpStatus: number | null;
      finishReason: string | null;
      errorCode: string | null;
      reasonCode?: string;
      succeeded?: boolean;
    }>;
  };
  /**
   * Provider/stream finish reason from the primary billable stage
   * (e.g. stop / length). Safe telemetry — not stripped for public receipts.
   */
  finishReason?: string;
  /** Smoke-only: requested max_tokens override (admin+env gated). */
  requestedMaxTokens?: number;
  /** Smoke-only: effective max_tokens sent upstream when override applied. */
  effectiveMaxTokens?: number;
  /** Target response chars for the turn (smoke observability). */
  targetResponseChars?: number;
  /**
   * Muse-only local acceptance telemetry (1-pass). Stored in DB messages.usage
   * and message_generations.context_json. Never sent on SSE/variants/message APIs
   * (including full billing receipt admins). Not used for billing or auto-continuation.
   */
  museAcceptance?: Record<string, unknown>;
  /**
   * Admin/debug — which character prompt layer was assembled this turn.
   * Public receipt sanitization strips these fields.
   */
  usedEnglishCharacterPrompt?: boolean;
  characterPromptLanguage?: "english" | "korean_fallback";
  /**
   * Adult scene routing telemetry. Public receipts never include this object.
   * Admin/debug and server metadata keep the full record, including actualModel.
   */
  adultRouting?: {
    activeRoute: "general" | "adult";
    sceneModeBefore?: string;
    sceneModeAfter?: string;
    routeTriggerReason?: string;
    requestedModel?: string;
    actualModel: string;
    actualProvider: string;
    userSelectedModel: string;
    userSelectedModelLabel: string;
    userSelectedProvider?: "gemini" | "openrouter" | "openai" | "cheaperinference";
    rawTurnsIncluded?: number;
    rawTokensIncluded?: number;
    fallbackAttempted?: boolean;
    fallbackSucceeded?: boolean;
    glmHardFailureFallbackAttempted?: boolean;
    glmHardFailureFallbackSucceeded?: boolean;
    glmHardFailureReason?: string;
    hiddenFallbackOverheadCostUsd?: number;
    finalDeliveredModelCostUsd?: number;
    totalUpstreamCostUsd?: number;
    userChargedPoints?: number;
    latencyMs?: number;
  };
  /**
   * Internal generation semantics. Public receipts never include these fields.
   * ooc_scene_render + canonical=false means the turn is visible but not RP canon.
   */
  generationKind?: "ooc_scene_render" | "canonical";
  canonical?: boolean;
  canonAdopted?: boolean;
  canonAdoptedAt?: string;
  /** Admin-only billing contract dispatch metadata — stripped from public receipts. */
  billingContractDispatch?: UsageBillingContractAdmin;
  /** Phase 2 shadow pricing — admin-only, never billed. Stored for diagnostics/aggregate. */
  shadowPricing?: {
    pricingVersion: number;
    billingReferenceInputUsdPerMillion: number;
    billingReferenceOutputUsdPerMillion: number;
    billingReferenceCostKrw: number;
    billingReferenceCostUsd: number;
    fxSnapshot: {
      dateKey: string;
      source: "api_daily" | "previous_daily_snapshot" | "emergency_fallback";
      baseUsdKrw: number;
      overseasFeeRate: number;
      effectiveKrwPerUsd: number;
    };
    providerListCostStatus: string;
    reserveStatus: string;
    actualTurnCostCoverage?: "complete" | "partial";
    actualProviderCostKrw: number;
    actualCostUsd?: number;
    actualCostSource: string;
    /** Delivered billing model used for shadow cost calculation. Admin-only. */
    modelId?: string;
    /** Delivered provider used for shadow cost calculation. Admin-only. */
    provider?: string;
    providerListCostKrw: number;
    inputCostKrw: number;
    outputCostKrw: number;
    reasoningCostKrw: number;
    cacheReadCostKrw: number;
    cacheWriteCostKrw: number;
    targetMargin: number;
    minimumMarginFloor: number;
    standardUserChargeKrw: number;
    promoPercent: number;
    finalShadowChargeKrw: number;
    finalShadowPoints: number;
    providerSavingsKrw: number | null;
    providerOverrunKrw: number | null;
    promoGivebackKrw: number;
    netPricingBufferDeltaKrw: number | null;
    actualGrossProfitKrw: number;
    actualRealizedMargin: number | null;
    worstCasePromoMargin: number | null;
    marginFloorViolated: boolean | null;
  };
};
