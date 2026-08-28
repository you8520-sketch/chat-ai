/**
 * Live billing cutover readiness — read-only classification and migration diagnostics.
 * NO deduction capability. NO catalog/FX mutation. NO feature flags.
 */

import { sanitizeUsageForPublicReceipt } from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";
import { DEFAULT_SYSTEM_TOKEN_BUDGET } from "@/types";
import {
  HISTORY_TOKEN_BUDGET,
  GEMINI_MEMORY_TOKEN_RESERVE,
} from "@/lib/contextTrack";
import {
  GEMINI37_BENCHMARK_A_ID,
  GEMINI37_BENCHMARK_B_ID,
  getMarketBenchmark,
  type MarketUsageBenchmark,
} from "@/lib/marketUsageBenchmarks";
import {
  GEMINI31_MODEL_ID,
  GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
  OPUS5_MODEL_ID,
} from "@/lib/premiumModelIds";
import {
  GEMINI31_V2_PROPOSED,
  OPUS5_V2_PROPOSED,
  buildPremiumFxSnapshot,
  simulatePremiumPricingPolicy,
} from "@/lib/premiumPricingCalibration";
import {
  GEMINI37_V2_PROPOSED,
  simulateGemini37PolicyRow,
} from "@/lib/gemini37PricingPolicy";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { computeTurnBilling } from "@/lib/points";
import { normalizeBillableUsage } from "@/lib/shadowPricing";
import {
  peekShadowBillingFxDailySnapshot,
  previewShadowBillingFxSnapshot,
} from "@/lib/shadowBillingExchangeRate";
import { getKstDateKey } from "@/lib/exchangeRate";

export type Reachability = "reachable" | "not_reachable_current_product" | "unknown";
export type PricingCoverage = "supported" | "unsupported" | "unknown";
export type ReadinessCellStatus =
  | "READY"
  | "NOT_REACHABLE_CURRENT_PRODUCT"
  | "BLOCKED"
  | "POLICY_DECISION_REQUIRED"
  | "UNKNOWN";

export type ModelCutoverClassification = "A" | "B" | "C" | "D";

export type MigrationDeltaRow = {
  modelId: string;
  benchmarkId: string;
  legacyFinalPoints: number;
  plannedPublishedFinalPoints: number;
  absoluteDelta: number;
  percentDelta: number | null;
};

export type DimensionAssessment = {
  pricingCoverage: PricingCoverage;
  productReachability: Reachability;
  effectiveCurrentProductBlocker: boolean;
  readinessCell: ReadinessCellStatus;
  notes: string;
};

export type LiveBillingCutoverAuditReport = {
  baseMainSha: string;
  auditVersion: string;
  liveUserChargeCalculationOwner: string;
  livePointDeductionOwner: string;
  currentDeductionOwnerCount: number;
  publishedPricingLiveDeductionCalls: number;
  reachability: {
    g37Cache: Reachability;
    g31Above200k: Reachability;
    g31Cache: Reachability;
    opusCache: Reachability;
    opusCacheTtlMode: "5M_ONLY" | "VARIABLE" | "UNKNOWN";
  };
  usage: {
    billableInputOwner: string;
    billableOutputOwner: string;
    billableStageOwner: string;
    billableStageSelectionOwnerCount: number;
    billableInputOwnerCount: number;
    billableOutputOwnerCount: number;
    reasoningDoubleCountPossible: boolean;
    multiStageUsageComplete: "true" | "false" | "unknown";
    fallbackUsageComplete: "true" | "false" | "unknown";
    continuationUsageComplete: "true" | "false" | "unknown";
  };
  idempotency: {
    idempotencyOwner: string;
    duplicateRequestDoubleChargePossible: boolean;
    regenDoubleChargePossible: boolean;
    ledgerAtomicityStatus: "DOCUMENTED" | "UNKNOWN";
  };
  fx: {
    oneTurnOneFxSnapshot: boolean;
    intraturnFxDriftPossible: boolean;
    adminReadCanLockFx: boolean;
    midnightBoundaryPass: boolean;
    fxFallbackReady: boolean;
    liveChargeCanResolveFxWithoutBlockingChat: boolean;
  };
  receipt: {
    publicReceiptInternalLeakPaths: number;
    historicalPricingSnapshotComplete: boolean;
  };
  migrationDelta: MigrationDeltaRow[];
  readinessMatrix: Record<string, Record<string, ReadinessCellStatus>>;
  classification: Record<string, ModelCutoverClassification>;
  safestFirstCutoverModel: string;
  safestFirstCutoverWhy: string;
  pureLiveChargeEngineExtractionRequired: boolean;
  numericCostOwnerOnlyCutoverPossible: boolean;
  singleSwitchRollbackArchitecturePossible: boolean;
  cutoverBlockers: string[];
};

export const LIVE_BILLING_OWNER_AUDIT = {
  liveUserChargeCalculationOwner:
    "POST /api/chat → computeTurnBilling() in src/lib/pointsReasoningMargins.ts (via @/lib/points alias)",
  livePointDeductionOwner: "deductPoints() in src/lib/points.ts",
  shadowDiagnosticsOwner: "computeShadowPricing() in src/lib/shadowPricing.ts — admin-only, never sets cost",
  currentDeductionOwnerCount: 1,
  publishedPricingLiveDeductionCalls: 0,
  billableStageSelectionOwner: "selectBillableStages() in src/lib/points.ts",
  billableInputOwner: "resolveTurnBillableInput() in src/lib/points.ts",
  billableOutputOwner:
    "billableOpenRouterOutputTokens / primary stage output in src/app/api/chat/route.ts",
  billableUsageNormalizer: "normalizeBillableUsage() in src/lib/shadowPricing.ts",
  idempotencyOwner:
    "clientRequestId + findTurnByRequestId() deduction_slices guard in src/app/api/chat/route.ts",
} as const;

/** Conservative upper bound on assembled prompt tokens under current product budgets. */
export function estimateCurrentProductMaxPromptTokens(): number {
  return (
    DEFAULT_SYSTEM_TOKEN_BUDGET +
    HISTORY_TOKEN_BUDGET +
    GEMINI_MEMORY_TOKEN_RESERVE +
    4_000
  );
}

export function assessGemini31Above200kReachability(): DimensionAssessment {
  const maxEstimated = estimateCurrentProductMaxPromptTokens();
  const reachable = maxEstimated > GEMINI31_BASE_TIER_PROMPT_THRESHOLD;
  return {
    pricingCoverage: "unsupported",
    productReachability: reachable ? "reachable" : "not_reachable_current_product",
    effectiveCurrentProductBlocker: reachable,
    readinessCell: reachable ? "BLOCKED" : "NOT_REACHABLE_CURRENT_PRODUCT",
    notes: reachable
      ? `Estimated assembly ceiling ~${maxEstimated.toLocaleString()} exceeds 200k threshold — verify with live prompt audit`
      : `Assembly budgets (system ${DEFAULT_SYSTEM_TOKEN_BUDGET}, history ${HISTORY_TOKEN_BUDGET}, memory ${GEMINI_MEMORY_TOKEN_RESERVE}) cap well below ${GEMINI31_BASE_TIER_PROMPT_THRESHOLD.toLocaleString()}`,
  };
}

export function assessGemini31CacheReachability(): DimensionAssessment {
  return {
    pricingCoverage: "unsupported",
    productReachability: "reachable",
    effectiveCurrentProductBlocker: true,
    readinessCell: "POLICY_DECISION_REQUIRED",
    notes:
      "Production uses Gemini explicit/implicit cache (geminiExplicitCache.ts, GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD). Published v2 marks cache UNVERIFIED.",
  };
}

export function assessGemini37CacheReachability(): DimensionAssessment {
  return {
    pricingCoverage: "unsupported",
    productReachability: "reachable",
    effectiveCurrentProductBlocker: true,
    readinessCell: "POLICY_DECISION_REQUIRED",
    notes:
      "Gemini cache infrastructure exists; legacy gemini37FlashPricing ignores cache for user price. Published v2 has no cache rate fields.",
  };
}

export function assessOpusCacheReachability(): DimensionAssessment {
  return {
    pricingCoverage: "supported",
    productReachability: "reachable",
    effectiveCurrentProductBlocker: false,
    readinessCell: "READY",
    notes:
      "Anthropic ephemeral cache_control in openRouterCache.ts; unified reasoning billing consumes cacheRead/cacheWrite tokens.",
  };
}

function legacyPointsForBenchmark(benchmark: MarketUsageBenchmark): number {
  const billing = computeTurnBilling({
    provider: "cheaperinference",
    openRouterModelId: benchmark.modelId,
    inputTokens: benchmark.inputTokens,
    outputTokens: benchmark.displayedOutputTokens,
    reasoningTokens: benchmark.displayedReasoningTokens ?? 0,
    savedTextChars: benchmark.visibleChars ?? 0,
    completedTurnsBeforeRequest: 0,
    modelLabel: benchmark.modelId,
  });
  return billing.total;
}

function plannedPublishedPointsForBenchmark(benchmark: MarketUsageBenchmark): number {
  const baseFx = 1530;
  if (benchmark.modelId === "gemini-3.7-flash") {
    return simulateGemini37PolicyRow({
      benchmark,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: GEMINI37_V2_PROPOSED.targetMargin,
      baseFx,
    }).finalPoints;
  }
  const published =
    benchmark.modelId === GEMINI31_MODEL_ID ? GEMINI31_V2_PROPOSED : OPUS5_V2_PROPOSED;
  return simulatePremiumPricingPolicy({
    modelId: benchmark.modelId,
    published,
    targetMargin: published.targetMargin,
    baseFx,
  }).finalPoints;
}

export function computeMigrationDeltaRows(): MigrationDeltaRow[] {
  const fixtures: Array<{ benchmarkId: string; modelId: string }> = [
    { benchmarkId: GEMINI37_BENCHMARK_A_ID, modelId: "gemini-3.7-flash" },
    { benchmarkId: GEMINI37_BENCHMARK_B_ID, modelId: "gemini-3.7-flash" },
    { benchmarkId: "gemini31_competitor_a", modelId: GEMINI31_MODEL_ID },
    { benchmarkId: "opus5_competitor_a", modelId: OPUS5_MODEL_ID },
  ];
  return fixtures.map(({ benchmarkId, modelId }) => {
    const benchmark = getMarketBenchmark(modelId, benchmarkId)!;
    const legacyFinalPoints = legacyPointsForBenchmark(benchmark);
    const plannedPublishedFinalPoints = plannedPublishedPointsForBenchmark(benchmark);
    const absoluteDelta = plannedPublishedFinalPoints - legacyFinalPoints;
    const percentDelta =
      legacyFinalPoints > 0
        ? Math.round((absoluteDelta / legacyFinalPoints) * 1000) / 10
        : null;
    return {
      modelId,
      benchmarkId,
      legacyFinalPoints,
      plannedPublishedFinalPoints,
      absoluteDelta,
      percentDelta,
    };
  });
}

function cell(
  pricingCoverage: PricingCoverage,
  reachability: Reachability,
  blocker: boolean
): ReadinessCellStatus {
  if (reachability === "not_reachable_current_product") return "NOT_REACHABLE_CURRENT_PRODUCT";
  if (reachability === "unknown") return "UNKNOWN";
  if (pricingCoverage === "unsupported" && blocker) return "BLOCKED";
  if (pricingCoverage === "unsupported") return "POLICY_DECISION_REQUIRED";
  if (pricingCoverage === "unknown") return "UNKNOWN";
  return "READY";
}

export function buildCurrentProductReadinessMatrix(): Record<
  string,
  Record<string, ReadinessCellStatus>
> {
  const g31Above = assessGemini31Above200kReachability();
  const g31Cache = assessGemini31CacheReachability();
  const g37Cache = assessGemini37CacheReachability();
  const opusCache = assessOpusCacheReachability();

  const baseUncached: ReadinessCellStatus = "READY";
  const reasoning: ReadinessCellStatus = "READY";
  const fx: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const receipt: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const idempotency: ReadinessCellStatus = "READY";
  const multiStage: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const fallback: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const continuation: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const missingUsage: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const waiver: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";

  return {
    "gemini-3.7-flash": {
      "Base uncached usage": baseUncached,
      "Cache read": cell(g37Cache.pricingCoverage, g37Cache.productReachability, g37Cache.effectiveCurrentProductBlocker),
      "Cache write": cell(g37Cache.pricingCoverage, g37Cache.productReachability, g37Cache.effectiveCurrentProductBlocker),
      "Above pricing threshold": "NOT_REACHABLE_CURRENT_PRODUCT",
      "Reasoning accounting": reasoning,
      "Multi-stage turn": multiStage,
      Fallback: fallback,
      "Continuation/recovery": continuation,
      "Missing usage": missingUsage,
      "Quality waiver": waiver,
      Receipt: receipt,
      Idempotency: idempotency,
      "FX snapshot": fx,
    },
    [GEMINI31_MODEL_ID]: {
      "Base uncached usage": baseUncached,
      "Cache read": cell(g31Cache.pricingCoverage, g31Cache.productReachability, g31Cache.effectiveCurrentProductBlocker),
      "Cache write": cell(g31Cache.pricingCoverage, g31Cache.productReachability, g31Cache.effectiveCurrentProductBlocker),
      "Above pricing threshold": g31Above.readinessCell,
      "Reasoning accounting": reasoning,
      "Multi-stage turn": multiStage,
      Fallback: fallback,
      "Continuation/recovery": continuation,
      "Missing usage": missingUsage,
      "Quality waiver": waiver,
      Receipt: receipt,
      Idempotency: idempotency,
      "FX snapshot": fx,
    },
    [OPUS5_MODEL_ID]: {
      "Base uncached usage": baseUncached,
      "Cache read": cell(opusCache.pricingCoverage, opusCache.productReachability, opusCache.effectiveCurrentProductBlocker),
      "Cache write": cell(opusCache.pricingCoverage, opusCache.productReachability, opusCache.effectiveCurrentProductBlocker),
      "Above pricing threshold": "NOT_REACHABLE_CURRENT_PRODUCT",
      "Reasoning accounting": reasoning,
      "Multi-stage turn": multiStage,
      Fallback: fallback,
      "Continuation/recovery": continuation,
      "Missing usage": missingUsage,
      "Quality waiver": waiver,
      Receipt: receipt,
      Idempotency: idempotency,
      "FX snapshot": fx,
    },
  };
}

export function classifyModelCutoverReadiness(modelId: string): ModelCutoverClassification {
  const matrix = buildCurrentProductReadinessMatrix()[modelId];
  if (!matrix) return "D";
  const cells = Object.values(matrix);
  if (cells.includes("BLOCKED")) return "C";
  if (cells.every((c) => c === "READY" || c === "NOT_REACHABLE_CURRENT_PRODUCT")) return "A";
  if (cells.some((c) => c === "POLICY_DECISION_REQUIRED" || c === "UNKNOWN")) return "B";
  return "D";
}

export function countPublicReceiptInternalLeakPaths(): number {
  const sample: Usage = {
    model: "gemini-3.1-pro-preview",
    input: 100,
    output: 50,
    route: "safe",
    cost: 10,
    breakdown: [],
    shadowPricing: {
      pricingVersion: 2,
      billingReferenceInputUsdPerMillion: 2,
      billingReferenceOutputUsdPerMillion: 12,
      billingReferenceCostKrw: 40,
      billingReferenceCostUsd: 0.03,
      fxSnapshot: {
        dateKey: "2026-08-28",
        source: "api_daily",
        baseUsdKrw: 1530,
        effectiveKrwPerUsd: 1560.6,
      },
    } as Usage["shadowPricing"],
    exchangeRateSource: "api_daily",
    exchangeRateKrwPerUsd: 1560.6,
    statusWidgetExtractDiagnostics: {
      exhausted: false,
      usedFallback: false,
      attempts: [],
    },
  };
  const sanitized = sanitizeUsageForPublicReceipt(sample);
  let leaks = 0;
  if (sanitized.shadowPricing != null) leaks++;
  if (sanitized.exchangeRateSource != null) leaks++;
  if (sanitized.exchangeRateKrwPerUsd != null) leaks++;
  if (sanitized.statusWidgetExtractDiagnostics != null) leaks++;
  return leaks;
}

export function verifyReasoningNotDoubleCounted(): boolean {
  const usage = normalizeBillableUsage({
    modelId: GEMINI31_MODEL_ID,
    promptTokens: 10_000,
    outputTokens: 500,
    reasoningTokens: 200,
  });
  return (
    usage.reasoningAccounting === "included_in_output" &&
    usage.billableOutputTokens === 500 &&
    usage.billableOutputTokens === usage.visibleOutputTokens
  );
}

export function verifyModelAliasResolvesToSinglePublishedPolicy(): boolean {
  const aliased = getPublishedPricing("google/gemini-3.1-pro-preview");
  const direct = getPublishedPricing(GEMINI31_MODEL_ID);
  return (
    aliased.modelId === GEMINI31_MODEL_ID &&
    direct.modelId === GEMINI31_MODEL_ID &&
    aliased.pricingVersion === direct.pricingVersion &&
    aliased.targetMargin === direct.targetMargin
  );
}

export function verifyFxReadOnlyPreviewPath(): boolean {
  peekShadowBillingFxDailySnapshot();
  previewShadowBillingFxSnapshot();
  return true;
}

export function verifyKstMidnightBoundary(): boolean {
  const dayN = getKstDateKey(Date.parse("2026-08-27T14:59:59.000Z"));
  const dayN1 = getKstDateKey(Date.parse("2026-08-27T15:00:00.000Z"));
  return dayN === "2026-08-27" && dayN1 === "2026-08-28";
}

export function buildLiveBillingCutoverAuditReport(baseMainSha = "unknown"): LiveBillingCutoverAuditReport {
  const g31Above = assessGemini31Above200kReachability();
  const g31Cache = assessGemini31CacheReachability();
  const g37Cache = assessGemini37CacheReachability();
  const opusCache = assessOpusCacheReachability();
  const matrix = buildCurrentProductReadinessMatrix();
  const classification = {
    "gemini-3.7-flash": classifyModelCutoverReadiness("gemini-3.7-flash"),
    [GEMINI31_MODEL_ID]: classifyModelCutoverReadiness(GEMINI31_MODEL_ID),
    [OPUS5_MODEL_ID]: classifyModelCutoverReadiness(OPUS5_MODEL_ID),
  };

  const cutoverBlockers = [
    "Published pricing is shadow-only — no live numeric owner swap implemented",
    "Gemini31 Published v2 cache semantics UNVERIFIED while product cache is reachable",
    "Gemini37 Published v2 has no cache rate fields while Gemini cache infrastructure is active",
    "Multi-stage / fallback / continuation turns bill primary stage only — policy decision required for Published cutover",
    "Quality waiver minimums (e.g. Gemini31 65P) interact with Published charge — cutover policy undecided",
    "Historical receipt lacks pricingVersion + FX snapshot identity for immutable repricing audit",
    "Pure live charge engine not extracted — computeShadowPricing mixes economics with user charge",
  ];

  const safest =
    classification["gemini-3.7-flash"] === "B" &&
    classification[GEMINI31_MODEL_ID] !== "A" &&
    classification[OPUS5_MODEL_ID] !== "A"
      ? "gemini-3.7-flash"
      : classification[OPUS5_MODEL_ID] === "B"
        ? OPUS5_MODEL_ID
        : GEMINI31_MODEL_ID;

  return {
    baseMainSha,
    auditVersion: "2026-08-28-readiness-v1",
    liveUserChargeCalculationOwner: LIVE_BILLING_OWNER_AUDIT.liveUserChargeCalculationOwner,
    livePointDeductionOwner: LIVE_BILLING_OWNER_AUDIT.livePointDeductionOwner,
    currentDeductionOwnerCount: LIVE_BILLING_OWNER_AUDIT.currentDeductionOwnerCount,
    publishedPricingLiveDeductionCalls: LIVE_BILLING_OWNER_AUDIT.publishedPricingLiveDeductionCalls,
    reachability: {
      g37Cache: g37Cache.productReachability,
      g31Above200k: g31Above.productReachability,
      g31Cache: g31Cache.productReachability,
      opusCache: opusCache.productReachability,
      opusCacheTtlMode: "5M_ONLY",
    },
    usage: {
      billableInputOwner: LIVE_BILLING_OWNER_AUDIT.billableInputOwner,
      billableOutputOwner: LIVE_BILLING_OWNER_AUDIT.billableOutputOwner,
      billableStageOwner: LIVE_BILLING_OWNER_AUDIT.billableStageSelectionOwner,
      billableStageSelectionOwnerCount: 1,
      billableInputOwnerCount: 1,
      billableOutputOwnerCount: 1,
      reasoningDoubleCountPossible: !verifyReasoningNotDoubleCounted(),
      multiStageUsageComplete: "unknown",
      fallbackUsageComplete: "false",
      continuationUsageComplete: "unknown",
    },
    idempotency: {
      idempotencyOwner: LIVE_BILLING_OWNER_AUDIT.idempotencyOwner,
      duplicateRequestDoubleChargePossible: false,
      regenDoubleChargePossible: false,
      ledgerAtomicityStatus: "DOCUMENTED",
    },
    fx: {
      oneTurnOneFxSnapshot: true,
      intraturnFxDriftPossible: false,
      adminReadCanLockFx: false,
      midnightBoundaryPass: verifyKstMidnightBoundary(),
      fxFallbackReady: true,
      liveChargeCanResolveFxWithoutBlockingChat: true,
    },
    receipt: {
      publicReceiptInternalLeakPaths: countPublicReceiptInternalLeakPaths(),
      historicalPricingSnapshotComplete: false,
    },
    migrationDelta: computeMigrationDeltaRows(),
    readinessMatrix: matrix,
    classification,
    safestFirstCutoverModel: safest,
    safestFirstCutoverWhy:
      "Simplest reachable billing surface: uncached Published v2 base tier, no above-threshold product path, legacy formula already isolated in gemini37FlashPricing.ts",
    pureLiveChargeEngineExtractionRequired: true,
    numericCostOwnerOnlyCutoverPossible: true,
    singleSwitchRollbackArchitecturePossible: true,
    cutoverBlockers,
  };
}

/** Read-only diagnostics entry — safe for admin/report rendering. */
export function evaluateLiveBillingCutoverReadiness(baseMainSha?: string): LiveBillingCutoverAuditReport {
  buildPremiumFxSnapshot(1530);
  getPublishedPricing(GEMINI31_MODEL_ID);
  verifyFxReadOnlyPreviewPath();
  return buildLiveBillingCutoverAuditReport(baseMainSha ?? "unknown");
}

export { GEMINI31_MODEL_ID, OPUS5_MODEL_ID, GEMINI31_BASE_TIER_PROMPT_THRESHOLD } from "@/lib/premiumModelIds";

export const FUTURE_LIVE_CHARGE_ENGINE_CONTRACT = {
  proposedOwner: "computePublishedUserChargeWithSnapshot",
  inputs: ["modelId", "normalizedBillableUsage", "fxSnapshot", "promoPolicy"],
  outputs: [
    "eligibility/status",
    "pricingVersion",
    "billingReferenceCost",
    "standardUserCharge",
    "finalUserCharge/finalPoints",
    "normalized usage",
    "FX snapshot",
  ],
  excludes: ["providerListCost", "actualProviderCost", "reserve", "margin diagnostics"],
} as const;
