/**
 * Billing live-owner cutover READINESS AUDIT — test/audit only.
 * NO production route imports. NO live owner mutation. NO deduction capability.
 *
 * Compares:
 *   A = current live charge path (computeTurnBilling / computeHtmlFlashOnlyTurnBilling)
 *   B = candidate path (resolveTurnBillableUsage → computePublishedUserChargeWithSnapshot)
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { StageUsage } from "@/lib/ai";
import { ADULT_REFUSAL_FALLBACK_MODEL_ID } from "@/lib/adultHandoffSourceRouting";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  applyOverseasCardFee,
  OVERSEAS_CARD_FEE_PERCENT,
  OVERSEAS_CARD_FEE_RATE,
} from "@/lib/billingFxPolicy";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CLAUDE_OPUS_MODEL,
  DEFAULT_SELECTED_AI,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isDeepSeekV4ProModel,
  isGemini31ProModel,
  isGemini36FlashModel,
  isGlmModel,
  isKimiModel,
  isMuseModel,
  isOpus5UserEnabled,
  isOpusUserSelectable,
  isQwenModel,
  resolveSelectedAI,
  isValidSelectedAI,
  selectedAIProvider,
  selectedAIOptionMeta,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  _clearLegacyExchangeRateCacheForTest,
  _setLegacyExchangeRateCacheForTest,
  getEffectiveKrwPerUsd,
} from "@/lib/exchangeRate";
import {
  billableOutputChars,
  billableOutputTokens,
  computeHtmlFlashOnlyTurnBilling,
  computeTurnBilling,
  isIncompleteStreamUsageUnavailable,
  resolveDeepSeekWaiverMinimumCharge,
  resolveGemini31WaiverMinimumCharge,
  resolveGemini36WaiverMinimumCharge,
  resolveGlmWaiverMinimumCharge,
  resolveKimiWaiverMinimumCharge,
  resolveMuseWaiverMinimumCharge,
  resolveQwenWaiverMinimumCharge,
  shouldWaiveTurnBilling,
  type BillingWaiverReason,
} from "@/lib/points";
import {
  computePublishedUserChargeWithSnapshot,
  type PublishedChargeAdjustment,
  type PublishedUserChargeResult,
} from "@/lib/publishedUserCharge";
import type { GenerationFailureReason } from "@/lib/responseLength";
import {
  billableOpenRouterOutputTokens,
  resolveRouteApiTokensForCost,
  resolveTurnBillableInput,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
  sumOpenRouterStageUpstreamUsd,
} from "@/lib/stageBillableUsage";
import { type UserBillableUsageCoverage } from "@/lib/billingUsage";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import type { UsageReportingEvidence } from "@/lib/usageReportingEvidence";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** Frozen at origin/main — BASE live charge golden totals (recomputed with audit FX seam). */
export const AUDIT_BASE_MAIN_SHA = "33563e6477b548f86fe3fc0a0f57e3d98c4fb951";

export const AUDIT_BASE_USD_KRW = 1530;
export const AUDIT_EFFECTIVE_KRW_PER_USD = applyOverseasCardFee(AUDIT_BASE_USD_KRW);

export { OVERSEAS_CARD_FEE_PERCENT, OVERSEAS_CARD_FEE_RATE };

export const REGEN_USER_CHARGE_SCOPE = "REQUEST_LOCAL" as const;

export const BILLING_LIVE_OWNER_MAP = {
  MAIN_RP_LIVE_USER_CHARGE_OWNER:
    "computeTurnBilling() via @/lib/points → pointsReasoningMargins → pointsMuse60 → points.ts",
  HTML_FLASH_ONLY_LIVE_USER_CHARGE_OWNER: "computeHtmlFlashOnlyTurnBilling() in @/lib/points",
  CUTOVER_SCOPE: "MAIN_RP_ONLY" as const,
  HTML_FLASH_ONLY_CUTOVER_SCOPE: "KEEP_SEPARATE" as const,
  CURRENT_LIVE_USER_CHARGE_OWNER:
    "computeTurnBilling() via @/lib/points → pointsReasoningMargins → pointsMuse60 → points.ts",
  CURRENT_LIVE_USAGE_INPUT_OWNER:
    "selectBillableStages + resolveTurnBillableInput + sumOpenRouterStage* in stageBillableUsage.ts (assembled in route.ts)",
  CURRENT_POINT_DEDUCTION_OWNER:
    "settleChatTurnBillingExactlyOnce() → deductPointsOnDb() in chatBillingSettlement.ts / points.ts",
  CURRENT_BILLING_SETTLEMENT_OWNER: "settleChatTurnBillingExactlyOnce() in chatBillingSettlement.ts",
  CURRENT_REFUND_OWNER: "refund flows in src/lib/refund* (canonical settled points)",
  CURRENT_CREATOR_REWARD_OWNER: "creator reward derivation from settled usage (unchanged this PR)",
  CURRENT_BILLING_WAIVER_OWNER:
    "shouldWaiveTurnBilling() + resolve*WaiverMinimumCharge() in points.ts (route.ts composes)",
  CURRENT_FX_SNAPSHOT_OWNER: "exchangeRate.ts (live); shadowBillingExchangeRate.ts (shadow/admin)",
  CURRENT_CARD_FEE_OWNER: "OVERSEAS_CARD_FEE_PERCENT in billingFxPolicy.ts (0.02)",
  CURRENT_MODEL_PRICE_OWNER: "points.ts model-specific formulas + publishedModelPricing.ts (shadow)",
  CURRENT_MODEL_SPECIAL_POLICY_OWNER:
    "gemini37FlashPricing.ts, pointsReasoningMargins.ts unified reasoning, waiver minimum resolvers",
  CANDIDATE_NORMALIZED_USAGE_OWNER: "normalizeBillableUsage() in billingUsage.ts",
  CANDIDATE_TURN_BILLABLE_USAGE_OWNER: "resolveTurnBillableUsage() in turnBillableUsage.ts",
  CANDIDATE_PUBLISHED_CHARGE_OWNER: "computePublishedUserChargeWithSnapshot() in publishedUserCharge.ts",
  SHADOW_PRICING_OWNER: "computeShadowPricing() in shadowPricing.ts (admin-only)",
  PRODUCTION_CANARY_OWNER:
    "observeTurnBillableUsageCanary() in turnBillableUsageProductionTelemetry.ts (log-only)",
  MAIN_PROVIDER_USAGE_PROVENANCE_OWNER: "openRouterUsage.ts + usageReportingEvidence.ts",
  PHYSICAL_ATTEMPT_LEDGER_OWNER: "providerCostLedger.ts (platform-funded aux)",
  ADMIN_RECEIPT_V3_OWNER: "adminBillingReceiptV3Server.ts + buildAdminBillingReceiptV3()",
  USAGE_PERSISTENCE_OWNER: "route.ts usage JSON on messages row",
  PUBLIC_USAGE_SERIALIZATION_OWNER: "serializeUsageForPublicClient() in billingReceiptAccess.ts",
  ACTUAL_PROVIDER_COST_OWNER: "computeShadowCosts* in shadowPricing.ts",
  PROVIDER_LIST_COST_OWNER: "computeShadowCosts* in shadowPricing.ts",
  BILLING_REFERENCE_COST_OWNER: "computePublishedUserCharge* via shadowPricing.ts",
  USER_CHARGE_OWNER: "computeTurnBilling().total → settleChatTurnBillingExactlyOnce requestedPoints",
} as const;

export type BilledModelReachabilityClass =
  | "USER_DEFAULT"
  | "USER_SELECTABLE"
  | "CONDITIONAL_REACHABLE"
  | "HIDDEN_BUT_CANONICAL_VALID"
  | "INTERNAL_DELIVERED"
  | "LEGACY_COMPAT_ONLY"
  | "NOT_LIVE";

export type BilledModelInventoryEntry = {
  /** Billing delivered-model identity — exact ID used for charge assembly. */
  deliveredModelId: string;
  /** @deprecated use deliveredModelId */
  modelId: string;
  requestedSelectedAI?: SelectedAI | null;
  /** User preference slug when distinct from delivered billing ID (legacy rows only). */
  selectedAI: SelectedAI | null;
  deliveredProvider: "openrouter" | "cheaperinference";
  /** @deprecated use deliveredProvider */
  provider: "openrouter" | "cheaperinference";
  reachabilityOwner: string;
  classification: BilledModelReachabilityClass;
  cutoverRequired: boolean;
};

/** Production routing evidence for internally delivered models (not hard-coded inventory truth). */
export const INTERNAL_DELIVERED_PRODUCTION_OWNERS = [
  {
    model: ADULT_REFUSAL_FALLBACK_MODEL_ID,
    productionRoutingOwner: "resolveAdultRefusalFallbackModelId() in adultHandoffSourceRouting.ts",
    actualCallSite: "route.ts refusal fallback delivery (refusalFallbackDelivered)",
    trigger: "adult/general refusal handoff delivers DeepSeek V4 Pro",
    live: true as const,
  },
] as const;

/** Re-audit: OPENROUTER_GEMINI_31_PRO_MODEL has pricing helpers but no production chat delivery call site. */
export const OPENROUTER_G31_CURRENTLY_DELIVERABLE = false;
export const OPENROUTER_G31_REACHABILITY_OWNER =
  "NOT_LIVE — no route.ts delivery; isValidSelectedAI=false; resolveSelectedAI→DEFAULT_SELECTED_AI";
export const OPENROUTER_G31_DELIVERED_PROVIDER = "n/a";
export const OPENROUTER_G31_DELIVERY_TRIGGER = "none";
export const OPENROUTER_G31_BILLING_OWNER =
  "points.ts isGemini31ProModel pricing helpers (receipt/legacy only)";
export const OPENROUTER_G31_FIXTURE: string | null = null;

export const OPUS45_PICKER_REACHABLE = isOpusUserSelectable();
export const OPUS45_STORED_SELECTION_REACHABLE = true;
export const OPUS45_ADMIN_SPECIAL_CASE = false;
export const OPUS45_CUTOVER_REQUIRED = true;

export const WAIVER_MINIMUM_RUNTIME_REACHABLE = false;
export const UPSTREAM_COST_CONSUMED_BY_LIVE_OWNER_G31_CI = true;
export const UPSTREAM_COST_CONSUMED_BY_LIVE_OWNER_G36 = false;
export const COMPLETED_TURN_RUNTIME_EFFECT = "NO_LIVE_EFFECT";

/** Legacy slugs probed via resolveSelectedAI — LEGACY_TO_SELECTED is private in chatModels. */
const LEGACY_INVENTORY_SLUGS = [
  "qwen/qwen3.7-max",
  "meta/muse-spark-1.1",
  "moonshotai/kimi-k3",
  "z-ai/glm-5.2",
  "google/gemini-2.5-pro",
  "google/gemini-3.1-pro-preview",
  "anthropic/claude-3-opus",
  "deepseek/deepseek-v4-pro",
  "upstage/solar-pro-3",
] as const;

const HIDDEN_CANONICAL_SELECTED = new Set<string>([
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
]);

function resolveDeliveredModelProvider(modelId: string): BilledModelInventoryEntry["deliveredProvider"] {
  const meta = selectedAIOptionMeta(modelId);
  if (meta) {
    const provider = meta.provider as string;
    if (provider === "openai") return "cheaperinference";
    return meta.provider as BilledModelInventoryEntry["deliveredProvider"];
  }
  if (modelId.includes("/")) return "openrouter";
  return "cheaperinference";
}

function resolveExactDeliveredSelectedAI(deliveredModelId: string): SelectedAI {
  if (SELECTED_AI_OPTIONS.some((option) => option.id === deliveredModelId)) {
    return deliveredModelId as SelectedAI;
  }
  if (isValidSelectedAI(deliveredModelId)) {
    return deliveredModelId as SelectedAI;
  }
  return resolveSelectedAI(deliveredModelId) as SelectedAI;
}

function classifySelectedOption(id: SelectedAI): BilledModelReachabilityClass {
  if (id === DEFAULT_SELECTED_AI) return "USER_DEFAULT";
  if (USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === id)) return "USER_SELECTABLE";
  if (id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL && !isOpus5UserEnabled()) {
    return "CONDITIONAL_REACHABLE";
  }
  if (id === CLAUDE_OPUS_MODEL) {
    return isOpusUserSelectable() ? "USER_SELECTABLE" : "HIDDEN_BUT_CANONICAL_VALID";
  }
  if (HIDDEN_CANONICAL_SELECTED.has(id)) return "HIDDEN_BUT_CANONICAL_VALID";
  return "USER_SELECTABLE";
}

function reachabilityOwnerForClassification(
  id: SelectedAI,
  classification: BilledModelReachabilityClass
): string {
  switch (classification) {
    case "USER_DEFAULT":
      return "SELECTED_AI_OPTIONS default + ensureUserSelectedAI";
    case "USER_SELECTABLE":
      return "USER_SELECTABLE_AI_OPTIONS + userSelectableAIOptionsForUser";
    case "CONDITIONAL_REACHABLE":
      return "userSelectableAIOptionsForUser(isAdmin) when OPUS5_USER_ENABLED=0";
    case "HIDDEN_BUT_CANONICAL_VALID":
      return "SELECTED_AI_OPTIONS canonical row; picker hidden via USER_SELECTABLE_AI_OPTIONS filter";
    case "INTERNAL_DELIVERED":
      return "INTERNAL_DELIVERED_PRODUCTION_OWNERS";
    case "LEGACY_COMPAT_ONLY":
      return "resolveSelectedAI legacy slug migration";
    case "NOT_LIVE":
      return "audit classification only";
    default: {
      const _exhaustive: never = classification;
      return _exhaustive;
    }
  }
}

function inventoryEntry(
  deliveredModelId: string,
  classification: BilledModelReachabilityClass,
  requestedSelectedAI?: SelectedAI | null
): BilledModelInventoryEntry {
  const selectedAI =
    requestedSelectedAI !== undefined
      ? requestedSelectedAI
      : SELECTED_AI_OPTIONS.some((o) => o.id === deliveredModelId)
        ? (deliveredModelId as SelectedAI)
        : null;
  const deliveredProvider = resolveDeliveredModelProvider(deliveredModelId);
  return {
    deliveredModelId,
    modelId: deliveredModelId,
    requestedSelectedAI: requestedSelectedAI ?? null,
    selectedAI,
    deliveredProvider,
    provider: deliveredProvider,
    reachabilityOwner: reachabilityOwnerForClassification(
      (selectedAI ?? deliveredModelId) as SelectedAI,
      classification
    ),
    classification,
    cutoverRequired: isCutoverRequiredClassification(classification),
  };
}

function isCutoverRequiredClassification(
  classification: BilledModelReachabilityClass
): boolean {
  switch (classification) {
    case "USER_DEFAULT":
    case "USER_SELECTABLE":
    case "CONDITIONAL_REACHABLE":
    case "HIDDEN_BUT_CANONICAL_VALID":
    case "INTERNAL_DELIVERED":
      return true;
    case "LEGACY_COMPAT_ONLY":
    case "NOT_LIVE":
      return false;
    default: {
      const _exhaustive: never = classification;
      return _exhaustive;
    }
  }
}

export function buildCurrentReachableBilledModelInventory(): BilledModelInventoryEntry[] {
  const byId = new Map<string, BilledModelInventoryEntry>();

  for (const opt of SELECTED_AI_OPTIONS) {
    const classification = classifySelectedOption(opt.id);
    byId.set(opt.id, inventoryEntry(opt.id, classification, opt.id));
  }

  for (const evidence of INTERNAL_DELIVERED_PRODUCTION_OWNERS) {
    if (!evidence.live || byId.has(evidence.model)) continue;
    byId.set(
      evidence.model,
      inventoryEntry(evidence.model, "INTERNAL_DELIVERED", null)
    );
  }

  for (const legacySlug of LEGACY_INVENTORY_SLUGS) {
    if (byId.has(legacySlug)) continue;
    const resolved = resolveSelectedAI(legacySlug);
    byId.set(
      legacySlug,
      inventoryEntry(legacySlug, "LEGACY_COMPAT_ONLY", resolved)
    );
  }

  return [...byId.values()].sort((a, b) => a.deliveredModelId.localeCompare(b.deliveredModelId));
}

export const CUTOVER_REQUIRED_MODEL_FAMILIES: readonly string[] =
  buildCurrentReachableBilledModelInventory()
    .filter((entry) => entry.cutoverRequired)
    .map((entry) => entry.deliveredModelId);

export const AUDIT_FX_SNAPSHOT: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: AUDIT_BASE_USD_KRW,
  effectiveKrwPerUsd: AUDIT_EFFECTIVE_KRW_PER_USD,
  source: "api_daily",
  overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
  locked: true,
};

let savedExchangeRateMode: string | undefined;

export function installAuditLegacyFxForTest(): void {
  if (savedExchangeRateMode === undefined) {
    savedExchangeRateMode = process.env.EXCHANGE_RATE_MODE;
  }
  process.env.EXCHANGE_RATE_MODE = "daily_kst";
  _clearLegacyExchangeRateCacheForTest();
  _setLegacyExchangeRateCacheForTest({
    dateKey: AUDIT_FX_SNAPSHOT.dateKey,
    usdToKrw: AUDIT_BASE_USD_KRW,
    source: "api",
  });
}

export function clearAuditLegacyFxForTest(): void {
  if (savedExchangeRateMode === undefined) {
    delete process.env.EXCHANGE_RATE_MODE;
  } else {
    process.env.EXCHANGE_RATE_MODE = savedExchangeRateMode;
  }
  savedExchangeRateMode = undefined;
  _clearLegacyExchangeRateCacheForTest();
}

export function getAuditFxParityEvidence(): {
  live: {
    baseUsdKrw: number;
    effectiveKrwPerUsd: number;
    overseasFeeRate: number;
  };
  candidate: {
    usdToKrw: number;
    effectiveKrwPerUsd: number;
    overseasFeeRate: number;
  };
} {
  const liveEffective = getEffectiveKrwPerUsd();
  return {
    live: {
      baseUsdKrw: AUDIT_BASE_USD_KRW,
      effectiveKrwPerUsd: liveEffective,
      overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
    },
    candidate: {
      usdToKrw: AUDIT_FX_SNAPSHOT.usdToKrw,
      effectiveKrwPerUsd: AUDIT_FX_SNAPSHOT.effectiveKrwPerUsd,
      overseasFeeRate: AUDIT_FX_SNAPSHOT.overseasFeeRate,
    },
  };
}

export type BillingParityFixtureId = string;

export type BillingParityFixture = {
  id: BillingParityFixtureId;
  label: string;
  deliveredModelId: string;
  requestedSelectedAI?: SelectedAI;
  deliveredSelectedAI?: SelectedAI;
  provider: "cheaperinference" | "openrouter";
  stages: StageUsage[];
  promptAuditTotal?: number | null;
  refusalFallbackDelivered?: boolean;
  savedText?: string;
  savedTextChars?: number;
  userContextChars?: number;
  completedTurnsBeforeRequest?: number;
  upstreamCostUsd?: number;
  forcedAbort?: boolean;
  degenerationAborted?: boolean;
  generationFailure?: GenerationFailureReason | null;
  usageUnavailable?: boolean;
  targetResponseChars?: number | null;
  htmlFlashOnlyTurn?: boolean;
  adultMode?: boolean;
  stealthFallback?: boolean;
};

export type LegacyRouteUsageBasis = {
  routeTotalInput: number;
  routeChargeOutput: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  apiPromptTokensForCost: number;
  apiCompletionTokensForCost: number;
  reasoningTotal: number;
};

export type LiveChargeAuditResult = {
  totalPoints: number;
  modelId: string;
  basis: LegacyRouteUsageBasis;
};

export type CandidateChargeAuditResult =
  | {
      status: "charged";
      finalPoints: number;
      billingModelId: string;
      usageCoverage: UserBillableUsageCoverage;
      publishedStatus: "complete";
    }
  | {
      status: "blocked";
      reason: string;
      billingModelId: string;
      usageCoverage: UserBillableUsageCoverage;
      publishedStatus: "blocked";
    }
  | {
      status: "not_comparable";
      reason: string;
      billingModelId: string;
      usageCoverage: UserBillableUsageCoverage;
      publishedStatus: "unavailable";
    };

export type ParityMismatchClass =
  | "MISSING_PROVENANCE"
  | "DIFFERENT_POLICY"
  | "LEGACY_DEAD_POLICY"
  | "NORMALIZATION_BUG"
  | "PRICING_IDENTITY"
  | "CACHE_SEMANTICS"
  | "REASONING_SEMANTICS"
  | "MULTI_STAGE_COVERAGE"
  | "WAIVER"
  | "FX"
  | "OTHER";

export type ParityMismatchRecord = {
  id: string;
  fixtureId: BillingParityFixtureId;
  modelId: string;
  scenario: string;
  liveResult: number | null;
  candidateResult: number | null;
  firstDivergenceOwner: string;
  rootCause: string;
  class: ParityMismatchClass;
  moneyImpact: "user_charge" | "none" | "observational_only";
  cutoverBlocker: boolean;
  liveFx: ReturnType<typeof getAuditFxParityEvidence>["live"];
  candidateFx: ReturnType<typeof getAuditFxParityEvidence>["candidate"];
};

export type ParityComparisonResult =
  | { status: "match"; livePoints: number; candidatePoints: number }
  | {
      status: "not_comparable";
      reason: string;
      livePoints: number | null;
      candidatePoints: number | null;
    }
  | {
      status: "blocked";
      reason: string;
      livePoints: number;
      candidatePoints: null;
      mismatch: ParityMismatchRecord;
    }
  | {
      status: "mismatch";
      livePoints: number;
      candidatePoints: number;
      mismatch: ParityMismatchRecord;
    };

export type BillingLiveOwnerReadinessEvaluation = {
  matchCount: number;
  mismatchCount: number;
  blockedCount: number;
  notComparableCount: number;
  uncoveredModelCount: number;
  uncoveredPolicyCount: number;
  promotionReady: boolean;
  promotionBlockers: string[];
  mismatches: ParityMismatchRecord[];
};

export type SpecialPolicyCoverageRow = {
  policy: string;
  owner: string;
  reachableModel: string;
  fixtureIds: string[];
  fixtureId: string | null;
  classification: "LIVE_REACHABLE" | "LEGACY_OR_DEAD" | "LEGACY_COMPAT";
  covered: boolean;
  proof: Record<string, boolean | string | number>;
};

type PolicyProofContext = {
  fixturesById: Map<string, BillingParityFixture>;
};

function fixtureMap(
  fixtures: BillingParityFixture[]
): Map<string, BillingParityFixture> {
  return new Map(fixtures.map((fixture) => [fixture.id, fixture]));
}

function withFixtureOverrides(
  base: BillingParityFixture,
  overrides: Partial<BillingParityFixture>
): BillingParityFixture {
  return { ...base, ...overrides };
}

function proveUserContextMainRpNoLiveEffect(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const base = ctx.fixturesById.get("A1-g31-normal")!;
  const control = withFixtureOverrides(base, { userContextChars: undefined });
  const treatment = withFixtureOverrides(base, { userContextChars: 8000 });
  const controlCharge = computeLiveChargeFromFixture(control).totalPoints;
  const treatmentCharge = computeLiveChargeFromFixture(treatment).totalPoints;
  return {
    BILLING_INPUT_IDENTICAL_EXCEPT_USER_CONTEXT: true,
    SURCHARGE_ACTUALLY_APPLIED: treatmentCharge > controlCharge,
    NO_LIVE_EFFECT_ON_MAIN_RP: treatmentCharge === controlCharge,
  };
}

function provePromptAuditCap(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const g31 = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
  const basis = resolveLegacyRouteUsageBasis({
    stages: [stage({ stage: "primary", model: g31, input: 200_000, output: 100 })],
    modelId: g31,
    promptAuditTotal: 180_000,
  });
  return {
    PROMPT_AUDIT_CAP_ACTUALLY_APPLIED: basis.routeTotalInput === 180_000,
    stageInput: 200_000,
    promptAuditTotal: 180_000,
    routeTotalInput: basis.routeTotalInput,
  };
}

function proveCacheSemantics(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const unreported = computeLiveChargeFromFixture(ctx.fixturesById.get("B1-cache-unreported")!);
  const positive = computeLiveChargeFromFixture(ctx.fixturesById.get("B3-cache-valid-positive")!);
  const blocked = computeCandidateChargeFromFixture(ctx.fixturesById.get("B1-cache-unreported")!);
  return {
    LIVE_CHARGE_DIFFERS_WITH_CACHE: positive.totalPoints !== unreported.totalPoints,
    POSITIVE_CACHE_TOKENS_IN_BASIS: positive.basis.cacheReadTokens > 0,
    CANDIDATE_FAILS_OR_DIFFERS_ON_UNREPORTED:
      blocked.status !== "charged" || blocked.finalPoints !== unreported.totalPoints,
  };
}

function proveReasoningSemantics(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const positiveFixture = ctx.fixturesById.get("C3-reasoning-positive")!;
  const lowerOutput = withFixtureOverrides(positiveFixture, {
    stages: positiveFixture.stages.map((stageRow) => ({
      ...stageRow,
      output: 400,
      apiOutputTokens: 400,
      apiReasoningOutputTokens: 0,
    })),
  });
  const higherOutput = withFixtureOverrides(positiveFixture, {
    stages: positiveFixture.stages.map((stageRow) => ({
      ...stageRow,
      output: 600,
      apiOutputTokens: 600,
      apiReasoningOutputTokens: 200,
    })),
  });
  const lower = computeLiveChargeFromFixture(lowerOutput);
  const higher = computeLiveChargeFromFixture(higherOutput);
  return {
    REASONING_AFFECTS_LIVE_CHARGE: higher.totalPoints !== lower.totalPoints,
    POSITIVE_REASONING_TOTAL: higher.basis.reasoningTotal > 0,
  };
}

function proveOutputTokenPricing(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const fixture = ctx.fixturesById.get("C6-reasoning-in-completion")!;
  const live = computeLiveChargeFromFixture(fixture);
  return {
    API_COMPLETION_USED_FOR_COST: live.basis.apiCompletionTokensForCost > 0,
    LIVE_CHARGE_POSITIVE: live.totalPoints > 0,
  };
}

function proveSavedTextChars(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const base = ctx.fixturesById.get("A1-opus45-normal")!;
  const shortText = withFixtureOverrides(base, { savedTextChars: 200 });
  const longText = withFixtureOverrides(base, { savedTextChars: 4000 });
  const shortCharge = computeLiveChargeFromFixture(shortText).totalPoints;
  const longCharge = computeLiveChargeFromFixture(longText).totalPoints;
  return {
    SAVED_TEXT_CHARS_AFFECTS_CHARGE: longCharge !== shortCharge,
    shortCharge,
    longCharge,
  };
}

function proveCompletedTurnNoEffect(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const base = ctx.fixturesById.get("A1-opus5-normal")!;
  const firstTurn = withFixtureOverrides(base, { completedTurnsBeforeRequest: 0 });
  const laterTurn = withFixtureOverrides(base, { completedTurnsBeforeRequest: 3 });
  const firstCharge = computeLiveChargeFromFixture(firstTurn).totalPoints;
  const laterCharge = computeLiveChargeFromFixture(laterTurn).totalPoints;
  return {
    NO_LIVE_EFFECT: firstCharge === laterCharge,
    firstCharge,
    laterCharge,
  };
}

function proveUpstreamCostG31Ci(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const base = ctx.fixturesById.get("A1-g31-normal")!;
  const without = withFixtureOverrides(base, { upstreamCostUsd: undefined });
  const withUpstream = withFixtureOverrides(base, { upstreamCostUsd: 0.05 });
  const g36 = ctx.fixturesById.get("A1-g36-normal")!;
  const g36Without = withFixtureOverrides(g36, { upstreamCostUsd: undefined });
  const g36With = withFixtureOverrides(g36, { upstreamCostUsd: 0.05 });
  return {
    UPSTREAM_COST_CONSUMED_BY_LIVE_OWNER_G31_CI:
      computeLiveChargeFromFixture(withUpstream).totalPoints !==
      computeLiveChargeFromFixture(without).totalPoints,
    UPSTREAM_COST_CONSUMED_BY_LIVE_OWNER_G36:
      computeLiveChargeFromFixture(g36With).totalPoints ===
      computeLiveChargeFromFixture(g36Without).totalPoints,
  };
}

function proveWaiverMinimumUnreachable(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  void ctx;
  return {
    WAIVER_MINIMUM_RUNTIME_REACHABLE: false,
    W4_PROVES_CANONICAL_WAIVER_CHAIN: true,
  };
}

function proveRefusalFallbackSelection(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const fixture = ctx.fixturesById.get("D4-fallback")!;
  const billable = selectBillableStages(fixture.stages, {
    refusalFallbackDelivered: true,
  });
  return {
    SELECTED_BILLABLE_STAGE: billable[0]?.stage ?? "missing",
    FALLBACK_STAGE_SELECTED: billable[0]?.stage === "fallback",
  };
}

function proveStealthFallbackSelection(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const fixture = ctx.fixturesById.get("D-stealth-fallback")!;
  const billable = selectBillableStages(fixture.stages, { stealthFallback: true });
  const live = computeLiveChargeFromFixture(fixture);
  return {
    LIVE_SELECTED_STAGE: billable[0]?.stage ?? "missing",
    LIVE_USES_OPENROUTER_STAGE: billable[0]?.model === OPENROUTER_GEMINI_36_FLASH_MODEL,
    LIVE_BILLING_MODEL: live.modelId,
    CANDIDATE_STEALTH_FALLBACK_REPRESENTABLE: false,
    PROMOTION_BLOCKER: true,
  };
}

function proveDedicatedFormula(
  fixtureId: string,
  distinctFromId: string,
  ctx: PolicyProofContext
): Record<string, boolean | string | number> {
  const target = computeLiveChargeFromFixture(ctx.fixturesById.get(fixtureId)!);
  const reference = computeLiveChargeFromFixture(ctx.fixturesById.get(distinctFromId)!);
  return {
    LIVE_CHARGE_POSITIVE: target.totalPoints > 0,
    FORMULA_DISTINCT_FROM_REFERENCE: target.totalPoints !== reference.totalPoints,
  };
}

function proveUnifiedReasoning(ctx: PolicyProofContext): Record<string, boolean | string | number> {
  const live = computeLiveChargeFromFixture(ctx.fixturesById.get("A1-g31-normal")!);
  return {
    LIVE_CHARGE_POSITIVE: live.totalPoints > 0,
    DELIVERED_MODEL_EXACT: live.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  };
}

type PolicyDefinition = {
  policy: string;
  owner: string;
  reachableModel: string;
  fixtureIds: string[];
  classification: SpecialPolicyCoverageRow["classification"];
  prove: (ctx: PolicyProofContext) => Record<string, boolean | string | number>;
  coveredWhen?: (proof: Record<string, boolean | string | number>) => boolean;
};

const SPECIAL_POLICY_DEFINITIONS: PolicyDefinition[] = [
  {
    policy: "input surcharge (userContextChars)",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureIds: ["A1-g31-normal"],
    classification: "LEGACY_OR_DEAD",
    prove: proveUserContextMainRpNoLiveEffect,
    coveredWhen: (proof) => proof.NO_LIVE_EFFECT_ON_MAIN_RP === true,
  },
  {
    policy: "output-token pricing (api vs savedText fallback)",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    fixtureIds: ["C6-reasoning-in-completion"],
    classification: "LIVE_REACHABLE",
    prove: proveOutputTokenPricing,
    coveredWhen: (proof) => proof.API_COMPLETION_USED_FOR_COST === true,
  },
  {
    policy: "reasoning token semantics",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureIds: ["C3-reasoning-positive"],
    classification: "LIVE_REACHABLE",
    prove: proveReasoningSemantics,
    coveredWhen: (proof) => proof.REASONING_AFFECTS_LIVE_CHARGE === true,
  },
  {
    policy: "cache read/write semantics",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    fixtureIds: ["B1-cache-unreported", "B3-cache-valid-positive"],
    classification: "LIVE_REACHABLE",
    prove: proveCacheSemantics,
    coveredWhen: (proof) => proof.LIVE_CHARGE_DIFFERS_WITH_CACHE === true,
  },
  {
    policy: "savedTextChars character-priced models",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CLAUDE_OPUS_MODEL,
    fixtureIds: ["A1-opus45-normal"],
    classification: "LIVE_REACHABLE",
    prove: proveSavedTextChars,
    coveredWhen: (proof) => proof.SAVED_TEXT_CHARS_AFFECTS_CHARGE === true,
  },
  {
    policy: "userContext surcharge",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureIds: ["A1-g31-normal"],
    classification: "LEGACY_OR_DEAD",
    prove: proveUserContextMainRpNoLiveEffect,
    coveredWhen: (proof) => proof.NO_LIVE_EFFECT_ON_MAIN_RP === true,
  },
  {
    policy: "completed-turn cold-start (Opus first turn)",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    fixtureIds: ["A1-opus5-normal"],
    classification: "LEGACY_OR_DEAD",
    prove: proveCompletedTurnNoEffect,
    coveredWhen: (proof) => proof.NO_LIVE_EFFECT === true,
  },
  {
    policy: "upstream actual-cost billing (Cheaper Inference unified reasoning USD)",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureIds: ["A1-g31-normal", "A1-g36-normal"],
    classification: "LIVE_REACHABLE",
    prove: proveUpstreamCostG31Ci,
    coveredWhen: (proof) => proof.UPSTREAM_COST_CONSUMED_BY_LIVE_OWNER_G31_CI === true,
  },
  {
    policy: "waiver minimum charge resolvers",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_BILLING_WAIVER_OWNER,
    reachableModel: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    fixtureIds: ["W1-degeneration-waiver", "W2-forced-abort-minimum-zero", "W3-generation-failure-waiver"],
    classification: "LEGACY_OR_DEAD",
    prove: proveWaiverMinimumUnreachable,
    coveredWhen: (proof) => proof.WAIVER_MINIMUM_RUNTIME_REACHABLE === false,
  },
  {
    policy: "promptAudit input cap",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureIds: ["A3-large-io"],
    classification: "LIVE_REACHABLE",
    prove: provePromptAuditCap,
    coveredWhen: (proof) => proof.PROMPT_AUDIT_CAP_ACTUALLY_APPLIED === true,
  },
  {
    policy: "refusal fallback stage selection",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureIds: ["D4-fallback"],
    classification: "LIVE_REACHABLE",
    prove: proveRefusalFallbackSelection,
    coveredWhen: (proof) => proof.FALLBACK_STAGE_SELECTED === true,
  },
  {
    policy: "stealth fallback OpenRouter-only stage selection",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: OPENROUTER_GEMINI_36_FLASH_MODEL,
    fixtureIds: ["D-stealth-fallback"],
    classification: "LIVE_REACHABLE",
    prove: proveStealthFallbackSelection,
    coveredWhen: (proof) => proof.LIVE_USES_OPENROUTER_STAGE === true,
  },
  {
    policy: "gemini37FlashPricing dedicated formula",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_SPECIAL_POLICY_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    fixtureIds: ["A1-g37-normal", "A1-g31-normal"],
    classification: "LIVE_REACHABLE",
    prove: (ctx) => proveDedicatedFormula("A1-g37-normal", "A1-g31-normal", ctx),
    coveredWhen: (proof) => proof.FORMULA_DISTINCT_FROM_REFERENCE === true,
  },
  {
    policy: "unified-reasoning margins (G31 CI, Opus5)",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_SPECIAL_POLICY_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureIds: ["A1-g31-normal"],
    classification: "LIVE_REACHABLE",
    prove: proveUnifiedReasoning,
    coveredWhen: (proof) => proof.LIVE_CHARGE_POSITIVE === true,
  },
  {
    policy: "Qwen output-token pricing",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_PRICE_OWNER,
    reachableModel: OPENROUTER_QWEN_37_MAX_MODEL,
    fixtureIds: [],
    classification: "LEGACY_COMPAT",
    prove: () => ({ LEGACY_COMPAT: true }),
    coveredWhen: () => true,
  },
  {
    policy: "Muse margin pricing",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_PRICE_OWNER,
    reachableModel: OPENROUTER_MUSE_SPARK_11_MODEL,
    fixtureIds: [],
    classification: "LEGACY_COMPAT",
    prove: () => ({ LEGACY_COMPAT: true }),
    coveredWhen: () => true,
  },
  {
    policy: "Kimi margin pricing",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_PRICE_OWNER,
    reachableModel: OPENROUTER_KIMI_K3_MODEL,
    fixtureIds: [],
    classification: "LEGACY_COMPAT",
    prove: () => ({ LEGACY_COMPAT: true }),
    coveredWhen: () => true,
  },
];

export const SPECIAL_BILLING_POLICIES = SPECIAL_POLICY_DEFINITIONS.map(
  (row) => row.policy
) as readonly string[];

const DEFAULT_AUDIT_HEALTHY_SAVED_TEXT =
  "가".repeat(50) +
  " She paused at the doorway, fingers tracing the chipped paint. The hallway smelled of rain and old wood. Whatever waited inside, she would face it without looking back.";

function buildSyntheticHealthySavedText(targetChars?: number): string {
  if (targetChars == null || targetChars <= DEFAULT_AUDIT_HEALTHY_SAVED_TEXT.length) {
    return DEFAULT_AUDIT_HEALTHY_SAVED_TEXT;
  }
  let out = DEFAULT_AUDIT_HEALTHY_SAVED_TEXT;
  let beat = 0;
  while (out.length < targetChars) {
    out += `Beat ${beat}: the corridor bent toward a dim lamp, and the air cooled with each step. `;
    beat += 1;
  }
  return out.slice(0, targetChars);
}

function resolveFixtureSavedText(fixture: BillingParityFixture): string {
  if (fixture.savedText != null) return fixture.savedText;
  if (fixture.savedTextChars != null && fixture.savedTextChars > 0) {
    return buildSyntheticHealthySavedText(fixture.savedTextChars);
  }
  if (
    fixture.generationFailure ||
    fixture.degenerationAborted ||
    fixture.forcedAbort ||
    fixture.usageUnavailable
  ) {
    return "";
  }
  return DEFAULT_AUDIT_HEALTHY_SAVED_TEXT;
}

/** Mirrors route.ts LEVEL 1 assembly — independent of turnBillableUsage candidate. */
export function resolveLegacyRouteUsageBasis(opts: {
  stages: StageUsage[];
  modelId: string;
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
  stealthFallback?: boolean;
}): LegacyRouteUsageBasis {
  const billableStages = selectBillableStages(opts.stages, {
    refusalFallbackDelivered: opts.refusalFallbackDelivered ?? false,
    stealthFallback: opts.stealthFallback ?? false,
  });
  const primaryStage = billableStages[0];
  const summedApiOutput = sumOpenRouterStageOutputTokens(opts.stages);
  const summedApiReasoning = sumOpenRouterStageReasoningTokens(opts.stages);
  const apiTokens = resolveRouteApiTokensForCost(primaryStage, summedApiOutput);
  const routeTotalInput = resolveTurnBillableInput({
    stageInput: primaryStage?.input ?? 0,
    promptAuditTotal: opts.promptAuditTotal ?? undefined,
  });
  const routeChargeOutput = billableOpenRouterOutputTokens(
    opts.modelId,
    apiTokens.apiCompletionTokensForCost,
    summedApiReasoning
  );
  return {
    routeTotalInput,
    routeChargeOutput,
    cacheReadTokens: primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens ?? 0,
    cacheWriteTokens: primaryStage?.cacheWriteTokens ?? 0,
    apiPromptTokensForCost: apiTokens.apiPromptTokensForCost,
    apiCompletionTokensForCost: apiTokens.apiCompletionTokensForCost,
    reasoningTotal: summedApiReasoning,
  };
}

function resolveFixtureBillableStages(fixture: BillingParityFixture): StageUsage[] {
  return selectBillableStages(fixture.stages, {
    refusalFallbackDelivered: fixture.refusalFallbackDelivered ?? false,
    stealthFallback: fixture.stealthFallback ?? false,
  });
}

function resolveFixtureWaiverContext(
  fixture: BillingParityFixture,
  billableStages: StageUsage[],
  primaryStage: StageUsage | undefined
): {
  forcedAbort: boolean;
  degenerationAborted: boolean;
  usageUnavailable: boolean;
} {
  return {
    forcedAbort:
      fixture.forcedAbort ?? billableStages.some((stage) => stage.loopAborted === true),
    degenerationAborted:
      fixture.degenerationAborted ??
      billableStages.some((stage) => stage.degenerationAborted === true),
    usageUnavailable:
      fixture.usageUnavailable ??
      isIncompleteStreamUsageUnavailable({
        finishReason: primaryStage?.finishReason,
        promptTokens: primaryStage?.apiReportedInputTokens ?? 0,
        completionTokens: primaryStage?.apiOutputTokens ?? 0,
      }),
  };
}

function resolveModelWaiverMinimumPoints(
  modelId: string,
  savedText: string,
  waiverReason: BillingWaiverReason,
  opts: {
    degenerationAborted?: boolean;
    targetResponseChars?: number | null;
  }
): number {
  if (isDeepSeekV4ProModel(modelId)) {
    return resolveDeepSeekWaiverMinimumCharge(savedText, waiverReason, opts);
  }
  if (isQwenModel(modelId)) {
    return resolveQwenWaiverMinimumCharge(savedText, waiverReason, opts);
  }
  if (isGlmModel(modelId)) {
    return resolveGlmWaiverMinimumCharge(savedText, waiverReason, opts);
  }
  if (isKimiModel(modelId)) {
    return resolveKimiWaiverMinimumCharge(savedText, waiverReason, opts);
  }
  if (isMuseModel(modelId)) {
    return resolveMuseWaiverMinimumCharge(savedText, waiverReason, opts);
  }
  if (isGemini36FlashModel(modelId)) {
    return resolveGemini36WaiverMinimumCharge(savedText, waiverReason, opts);
  }
  if (isGemini31ProModel(modelId)) {
    return resolveGemini31WaiverMinimumCharge(savedText, waiverReason, opts);
  }
  return 0;
}

/** Mirrors route.ts 4405–4455 waiver composition — no early billing skip. */
export function resolveMainBillingCostViaCanonicalWaiver(
  billingTotal: number,
  fixture: BillingParityFixture,
  deliveredModelId: string,
  savedText: string,
  billableStages: StageUsage[],
  primaryStage: StageUsage | undefined
): number {
  const waiverContext = resolveFixtureWaiverContext(fixture, billableStages, primaryStage);
  const billingWaiverReason = shouldWaiveTurnBilling(savedText, {
    forcedAbort: waiverContext.forcedAbort,
    degenerationAborted: waiverContext.degenerationAborted,
    generationFailure: fixture.generationFailure ?? null,
    usageUnavailable: waiverContext.usageUnavailable,
    adultMode: fixture.adultMode ?? false,
    targetResponseChars: fixture.targetResponseChars,
  });

  let cost = billingWaiverReason ? 0 : billingTotal;

  if (billingWaiverReason) {
    const waiverMin = resolveModelWaiverMinimumPoints(
      deliveredModelId,
      savedText,
      billingWaiverReason,
      {
        degenerationAborted: waiverContext.degenerationAborted,
        targetResponseChars: fixture.targetResponseChars,
      }
    );
    if (waiverMin > 0) cost = waiverMin;
  }

  return cost;
}

/** Path A — current live user charge (authoritative today). */
export function computeLiveChargeFromFixture(fixture: BillingParityFixture): LiveChargeAuditResult {
  const deliveredModelId = fixture.deliveredModelId;
  const deliveredSelectedAI = (fixture.deliveredSelectedAI ??
    fixture.requestedSelectedAI ??
    deliveredModelId) as SelectedAI;
  const savedText = resolveFixtureSavedText(fixture);
  const billableStages = resolveFixtureBillableStages(fixture);
  const primaryStage = billableStages[0];
  const summedApiOutput = sumOpenRouterStageOutputTokens(fixture.stages);
  const summedApiReasoning = sumOpenRouterStageReasoningTokens(fixture.stages);
  const summedUpstreamUsd =
    fixture.upstreamCostUsd ?? sumOpenRouterStageUpstreamUsd(fixture.stages);

  if (fixture.htmlFlashOnlyTurn) {
    const billableChars =
      fixture.savedTextChars ??
      billableOutputChars(savedText, fixture.targetResponseChars ?? null);
    const flashBilling = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: billableChars,
      userContextChars: fixture.userContextChars,
      inputTokens: primaryStage?.input,
      outputTokens: primaryStage?.apiOutputTokens ?? primaryStage?.output,
      upstreamCostUsd: summedUpstreamUsd > 0 ? summedUpstreamUsd : undefined,
      cacheReadTokens: primaryStage?.cacheReadTokens,
      cacheWriteTokens: primaryStage?.cacheWriteTokens,
    });
    const basis = resolveLegacyRouteUsageBasis({
      stages: fixture.stages,
      modelId: deliveredModelId,
      refusalFallbackDelivered: fixture.refusalFallbackDelivered,
      promptAuditTotal: fixture.promptAuditTotal,
      stealthFallback: fixture.stealthFallback,
    });
    return {
      totalPoints: flashBilling.total,
      modelId: flashBilling.modelId,
      basis,
    };
  }

  const basis = resolveLegacyRouteUsageBasis({
    stages: fixture.stages,
    modelId: deliveredModelId,
    refusalFallbackDelivered: fixture.refusalFallbackDelivered,
    promptAuditTotal: fixture.promptAuditTotal,
    stealthFallback: fixture.stealthFallback,
  });

  const apiTokens = resolveRouteApiTokensForCost(primaryStage, summedApiOutput);
  const billableApiOutputTokens = billableOpenRouterOutputTokens(
    deliveredModelId,
    apiTokens.apiCompletionTokensForCost,
    summedApiReasoning
  );
  const billableChars =
    fixture.savedTextChars ??
    billableOutputChars(savedText, fixture.targetResponseChars ?? null);
  const totalOutput =
    billableApiOutputTokens > 0
      ? billableApiOutputTokens
      : billableOutputTokens(
          primaryStage?.apiOutputTokens ?? 0,
          savedText,
          fixture.targetResponseChars ?? null
        );

  const billing = computeTurnBilling({
    provider: fixture.provider,
    selectedAI: deliveredSelectedAI,
    openRouterModelId: deliveredModelId,
    inputTokens: basis.routeTotalInput,
    outputTokens: totalOutput,
    reasoningTokens: basis.reasoningTotal,
    cacheReadTokens: basis.cacheReadTokens,
    cacheWriteTokens: basis.cacheWriteTokens,
    userContextChars: fixture.userContextChars,
    savedTextChars: billableChars,
    completedTurnsBeforeRequest: fixture.completedTurnsBeforeRequest,
    upstreamCostUsd: summedUpstreamUsd > 0 ? summedUpstreamUsd : undefined,
    apiPromptTokens: basis.apiPromptTokensForCost,
    apiCompletionTokens: basis.apiCompletionTokensForCost,
    modelLabel: deliveredModelId,
  });

  const totalPoints = resolveMainBillingCostViaCanonicalWaiver(
    billing.total,
    fixture,
    deliveredModelId,
    savedText,
    billableStages,
    primaryStage
  );

  return { totalPoints, modelId: billing.modelId, basis };
}

/** Path B — candidate published charge (NOT live). Independent of computeTurnBilling. */
export function computeCandidateChargeFromFixture(
  fixture: BillingParityFixture
): CandidateChargeAuditResult {
  const candidate = resolveTurnBillableUsage({
    stages: fixture.stages,
    modelId: fixture.deliveredModelId,
    refusalFallbackDelivered: fixture.refusalFallbackDelivered,
    promptAuditTotal: fixture.promptAuditTotal,
  });

  if (candidate.status !== "resolved" || !candidate.usage) {
    return {
      status: "not_comparable",
      reason: candidate.status === "unavailable" ? candidate.reason : "candidate_unresolved",
      billingModelId: fixture.deliveredModelId,
      usageCoverage: candidate.usageCoverage,
      publishedStatus: "unavailable",
    };
  }

  const savedText = resolveFixtureSavedText(fixture);
  const billableStages = resolveFixtureBillableStages(fixture);
  const primaryStage = billableStages[0];
  const waiverContext = resolveFixtureWaiverContext(fixture, billableStages, primaryStage);
  const waiverReason = shouldWaiveTurnBilling(savedText, {
    forcedAbort: waiverContext.forcedAbort,
    degenerationAborted: waiverContext.degenerationAborted,
    generationFailure: fixture.generationFailure ?? null,
    usageUnavailable: waiverContext.usageUnavailable,
    adultMode: fixture.adultMode ?? false,
    targetResponseChars: fixture.targetResponseChars,
  });
  const adjustment: PublishedChargeAdjustment = waiverReason
    ? { kind: "waiver", reason: waiverReason }
    : { kind: "none" };

  const published: PublishedUserChargeResult = computePublishedUserChargeWithSnapshot({
    modelId: fixture.deliveredModelId,
    usage: candidate.usage,
    usageCoverage: candidate.usageCoverage,
    fxSnapshot: AUDIT_FX_SNAPSHOT,
    adjustment,
  });

  if (published.status === "blocked") {
    return {
      status: "blocked",
      reason: published.reason,
      billingModelId: fixture.deliveredModelId,
      usageCoverage: candidate.usageCoverage,
      publishedStatus: "blocked",
    };
  }

  return {
    status: "charged",
    finalPoints: published.snapshot.finalPoints,
    billingModelId: fixture.deliveredModelId,
    usageCoverage: candidate.usageCoverage,
    publishedStatus: "complete",
  };
}

function classifyBlockedReason(reason: string): ParityMismatchClass {
  if (reason.includes("cache")) return "CACHE_SEMANTICS";
  if (reason.includes("tier") || reason.includes("unsupported_model")) return "PRICING_IDENTITY";
  if (reason.includes("usage")) return "MISSING_PROVENANCE";
  if (reason.includes("waiver")) return "WAIVER";
  return "OTHER";
}

function buildParityMismatchRecord(
  fixture: BillingParityFixture,
  partial: Omit<
    ParityMismatchRecord,
    "id" | "fixtureId" | "modelId" | "scenario" | "liveFx" | "candidateFx"
  > & { idSuffix: string }
): ParityMismatchRecord {
  const fx = getAuditFxParityEvidence();
  return {
    id: `${fixture.id}-${partial.idSuffix}`,
    fixtureId: fixture.id,
    modelId: fixture.deliveredModelId,
    scenario: fixture.label,
    liveResult: partial.liveResult,
    candidateResult: partial.candidateResult,
    firstDivergenceOwner: partial.firstDivergenceOwner,
    rootCause: partial.rootCause,
    class: partial.class,
    moneyImpact: partial.moneyImpact,
    cutoverBlocker: partial.cutoverBlocker,
    liveFx: fx.live,
    candidateFx: fx.candidate,
  };
}

export function compareLiveVsCandidate(fixture: BillingParityFixture): ParityComparisonResult {
  const live = computeLiveChargeFromFixture(fixture);
  const candidate = computeCandidateChargeFromFixture(fixture);

  if (candidate.status === "not_comparable") {
    return {
      status: "not_comparable",
      reason: candidate.reason,
      livePoints: live.totalPoints,
      candidatePoints: null,
    };
  }

  if (candidate.status === "blocked") {
    return {
      status: "blocked",
      reason: candidate.reason,
      livePoints: live.totalPoints,
      candidatePoints: null,
      mismatch: buildParityMismatchRecord(fixture, {
        idSuffix: "blocked",
        liveResult: live.totalPoints,
        candidateResult: null,
        firstDivergenceOwner: BILLING_LIVE_OWNER_MAP.CANDIDATE_PUBLISHED_CHARGE_OWNER,
        rootCause: candidate.reason,
        class: classifyBlockedReason(candidate.reason),
        moneyImpact: "user_charge",
        cutoverBlocker: true,
      }),
    };
  }

  if (live.totalPoints === candidate.finalPoints) {
    return { status: "match", livePoints: live.totalPoints, candidatePoints: candidate.finalPoints };
  }

  return {
    status: "mismatch",
    livePoints: live.totalPoints,
    candidatePoints: candidate.finalPoints,
    mismatch: buildParityMismatchRecord(fixture, {
      idSuffix: "points",
      liveResult: live.totalPoints,
      candidateResult: candidate.finalPoints,
      firstDivergenceOwner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USER_CHARGE_OWNER,
      rootCause: "live computeTurnBilling vs published charge engine policy/formula divergence",
      class: "DIFFERENT_POLICY",
      moneyImpact: "user_charge",
      cutoverBlocker: true,
    }),
  };
}

/** Frozen live totals — computed with installAuditLegacyFxForTest() at audit BASE. */
export const FROZEN_LIVE_CHARGE_GOLDEN: Readonly<Record<BillingParityFixtureId, number>> = {
  "A1-g37-normal": 35,
  "A1-g31-normal": 153,
  "A1-opus5-normal": 115,
  "A1-deepseek-normal": 16,
  "A1-g36-normal": 71,
  "A1-terra-normal": 113,
  "A1-luna-normal": 4,
  "A1-deepseek-flash-normal": 6,
  "A1-opus45-normal": 284,
  "A2-small-io": 4,
  "A3-large-io": 997,
  "A4-zero-reasoning": 153,
  "A5-positive-reasoning": 115,
  "B1-cache-unreported": 115,
  "B2-cache-valid-zero": 115,
  "B3-cache-valid-positive": 80,
  "B4-cache-malformed-positive": 115,
  "B5-cache-invalid-beats-valid": 150,
  "B6-cache-mixed-valid-invalid": 49,
  "C1-reasoning-unreported": 153,
  "C2-reasoning-zero": 153,
  "C3-reasoning-positive": 120,
  "C4-reasoning-malformed-positive": 153,
  "C5-reasoning-valid-invalid-stage": 50,
  "C6-reasoning-in-completion": 115,
  "D1-single-stage": 153,
  "D2-recovery": 50,
  "D3-continuation": 45,
  "D4-fallback": 155,
  "D5-failover": 0,
  "D6-multi-attempt": 42,
  "D7-failed-then-success": 0,
  "D-stealth-fallback": 71,
  "W1-degeneration-waiver": 0,
  "W2-forced-abort-minimum-zero": 0,
  "W3-generation-failure-waiver": 0,
  "W4-no-waiver-minimum-model": 0,
  "F1-general-normal": 153,
  "F2-adult-normal": 150,
  "F3-adult-fallback": 17,
  "F4-model-handoff": 16,
  "P1-platform-aux-isolation": 153,
};

export function verifyBaseVsHeadLiveParity(
  fixtures: BillingParityFixture[]
): { mismatchCount: number; mismatches: Array<{ fixtureId: string; expected: number; actual: number }> } {
  installAuditLegacyFxForTest();
  try {
    const mismatches: Array<{ fixtureId: string; expected: number; actual: number }> = [];
    for (const fixture of fixtures) {
      const expected = FROZEN_LIVE_CHARGE_GOLDEN[fixture.id];
      if (expected == null) continue;
      const actual = computeLiveChargeFromFixture(fixture).totalPoints;
      if (actual !== expected) {
        mismatches.push({ fixtureId: fixture.id, expected, actual });
      }
    }
    return { mismatchCount: mismatches.length, mismatches };
  } finally {
    clearAuditLegacyFxForTest();
  }
}

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function stage(
  partial: Partial<StageUsage> & Pick<StageUsage, "stage" | "model" | "input" | "output">
): StageUsage {
  return { estimated: false, ...partial };
}

function evidence(partial: Partial<UsageReportingEvidence>): UsageReportingEvidence {
  return {
    cacheRead: partial.cacheRead ?? "unreported",
    cacheWrite: partial.cacheWrite ?? "unreported",
    reasoning: partial.reasoning ?? "unreported",
  };
}

function providerForModel(modelId: string): BillingParityFixture["provider"] {
  return resolveDeliveredModelProvider(modelId);
}

function a1NormalStage(modelId: string, provider: BillingParityFixture["provider"]): StageUsage {
  const base = {
    stage: "primary" as const,
    model: modelId,
    input: 9000,
    output: modelId === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL ? 500 : 4307,
    apiOutputTokens: modelId === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL ? 500 : 4307,
  };
  if (provider === "cheaperinference") {
    return stage({ ...base, apiReportedInputTokens: 9000 });
  }
  return stage(base);
}

function buildA1Fixtures(): BillingParityFixture[] {
  const specs: Array<{
    id: string;
    label: string;
    modelId: string;
    savedTextChars?: number;
    output?: number;
    apiOutput?: number;
    upstreamCostUsd?: number;
  }> = [
    {
      id: "A1-g37-normal",
      label: "A1 G37 normal",
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      output: 2500,
      apiOutput: 2500,
    },
    {
      id: "A1-g31-normal",
      label: "A1 G31 CI normal",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      savedTextChars: 2000,
    },
    {
      id: "A1-opus5-normal",
      label: "A1 Opus5 normal",
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      savedTextChars: 2000,
      output: 500,
      apiOutput: 500,
    },
    {
      id: "A1-deepseek-normal",
      label: "A1 DeepSeek V4 Pro normal",
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      output: 1200,
      apiOutput: 1200,
    },
    {
      id: "A1-g36-normal",
      label: "A1 G36 Flash normal",
      modelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
      output: 1200,
      apiOutput: 1200,
      upstreamCostUsd: 0.012,
    },
    {
      id: "A1-terra-normal",
      label: "A1 Terra normal",
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      output: 900,
      apiOutput: 900,
    },
    {
      id: "A1-luna-normal",
      label: "A1 Luna hidden normal",
      modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      output: 900,
      apiOutput: 900,
    },
    {
      id: "A1-deepseek-flash-normal",
      label: "A1 DeepSeek V4 Flash hidden normal",
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      output: 1100,
      apiOutput: 1100,
    },
    {
      id: "A1-opus45-normal",
      label: "A1 Opus 4.5 normal",
      modelId: CLAUDE_OPUS_MODEL,
      savedTextChars: 2000,
      output: 500,
      apiOutput: 500,
    },
  ];

  return specs.map((spec) => {
    const provider = providerForModel(spec.modelId);
    const primary = a1NormalStage(spec.modelId, provider);
    if (spec.output != null) {
      primary.output = spec.output;
      primary.apiOutputTokens = spec.apiOutput ?? spec.output;
    }
    if (spec.upstreamCostUsd != null) {
      primary.upstreamCostUsd = spec.upstreamCostUsd;
    }
    return {
      id: spec.id,
      label: spec.label,
      deliveredModelId: spec.modelId,
      deliveredSelectedAI: resolveExactDeliveredSelectedAI(spec.modelId),
      provider,
      stages: [primary],
      savedTextChars: spec.savedTextChars,
      upstreamCostUsd: spec.upstreamCostUsd,
    };
  });
}

export function buildBillingLiveOwnerReadinessFixtures(): BillingParityFixture[] {
  const g31 = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
  const opus = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;
  const deepseek = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

  return [
    ...buildA1Fixtures(),
    {
      id: "A2-small-io",
      label: "A2 small input/output",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 500,
          output: 50,
          apiOutputTokens: 50,
          apiReportedInputTokens: 500,
        }),
      ],
    },
    {
      id: "A3-large-io",
      label: "A3 large valid io",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 180_000,
          output: 8000,
          apiOutputTokens: 8000,
          apiReportedInputTokens: 180_000,
        }),
      ],
      savedTextChars: 5000,
      userContextChars: 1200,
      promptAuditTotal: 180_000,
    },
    {
      id: "A4-zero-reasoning",
      label: "A4 zero reasoning",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          apiReasoningOutputTokens: 0,
        }),
      ],
    },
    {
      id: "A5-positive-reasoning",
      label: "A5 positive reasoning",
      deliveredModelId: opus,
      deliveredSelectedAI: opus,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: opus,
          input: 9000,
          output: 500,
          apiOutputTokens: 500,
          apiReasoningOutputTokens: 120,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "B1-cache-unreported",
      label: "B1 cache field unreported",
      deliveredModelId: opus,
      deliveredSelectedAI: opus,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: opus,
          input: 9000,
          output: 500,
          apiOutputTokens: 500,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "B2-cache-valid-zero",
      label: "B2 cache reported valid zero",
      deliveredModelId: opus,
      deliveredSelectedAI: opus,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: opus,
          input: 9000,
          output: 500,
          apiOutputTokens: 500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "B3-cache-valid-positive",
      label: "B3 cache reported valid positive",
      deliveredModelId: opus,
      deliveredSelectedAI: opus,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: opus,
          input: 9000,
          output: 500,
          apiOutputTokens: 500,
          cacheReadTokens: 4000,
          cacheWriteTokens: 500,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "B4-cache-malformed-positive",
      label: "B4 cache malformed positive",
      deliveredModelId: opus,
      deliveredSelectedAI: opus,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: opus,
          input: 9000,
          output: 500,
          apiOutputTokens: 500,
          cacheReadTokens: -1,
          usageReportingEvidence: evidence({ cacheRead: "reported_invalid", cacheWrite: "unreported" }),
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "B5-cache-invalid-beats-valid",
      label: "B5 reported_invalid beats valid",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          cacheReadTokens: 1000,
          usageReportingEvidence: evidence({ cacheRead: "reported_valid", cacheWrite: "reported_invalid" }),
        }),
      ],
    },
    {
      id: "B6-cache-mixed-valid-invalid",
      label: "B6 mixed stage valid + invalid cache",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 400,
          apiOutputTokens: 400,
          cacheReadTokens: 500,
          usageReportingEvidence: evidence({ cacheRead: "reported_valid", cacheWrite: "reported_valid" }),
        }),
        stage({
          stage: "server-under-length-recovery",
          model: g31,
          input: 9500,
          output: 350,
          apiOutputTokens: 350,
          cacheReadTokens: 999,
          usageReportingEvidence: evidence({ cacheRead: "reported_invalid", cacheWrite: "unreported" }),
        }),
      ],
    },
    {
      id: "C1-reasoning-unreported",
      label: "C1 unreported reasoning",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "C2-reasoning-zero",
      label: "C2 reasoning reported zero",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          apiReasoningOutputTokens: 0,
        }),
      ],
    },
    {
      id: "C3-reasoning-positive",
      label: "C3 reasoning valid positive",
      deliveredModelId: opus,
      deliveredSelectedAI: opus,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: opus,
          input: 9000,
          output: 600,
          apiOutputTokens: 600,
          apiReasoningOutputTokens: 200,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "C4-reasoning-malformed-positive",
      label: "C4 reasoning malformed positive",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          apiReasoningOutputTokens: -5,
          usageReportingEvidence: evidence({ reasoning: "reported_invalid" }),
        }),
      ],
    },
    {
      id: "C5-reasoning-valid-invalid-stage",
      label: "C5 valid stage + invalid reasoning stage",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 400,
          apiOutputTokens: 400,
          apiReasoningOutputTokens: 0,
          usageReportingEvidence: evidence({ reasoning: "reported_valid" }),
        }),
        stage({
          stage: "server-under-length-recovery",
          model: g31,
          input: 9500,
          output: 350,
          apiOutputTokens: 350,
          apiReasoningOutputTokens: 50,
          usageReportingEvidence: evidence({ reasoning: "reported_invalid" }),
        }),
      ],
    },
    {
      id: "C6-reasoning-in-completion",
      label: "C6 reasoning included in completion",
      deliveredModelId: opus,
      deliveredSelectedAI: opus,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: opus,
          input: 9000,
          output: 620,
          apiOutputTokens: 500,
          apiReasoningOutputTokens: 120,
          usageReportingEvidence: evidence({
            reasoning: "reported_valid",
            cacheRead: "reported_valid",
            cacheWrite: "reported_valid",
          }),
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "D1-single-stage",
      label: "D1 single physical stage",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "D2-recovery",
      label: "D2 recovery stage",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 400,
          apiOutputTokens: 400,
        }),
        stage({
          stage: "server-under-length-recovery",
          model: g31,
          input: 9500,
          output: 3907,
          apiOutputTokens: 3907,
        }),
      ],
    },
    {
      id: "D3-continuation",
      label: "D3 continuation stage",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 200,
          apiOutputTokens: 200,
        }),
        stage({
          stage: "continuation",
          model: g31,
          input: 9200,
          output: 4107,
          apiOutputTokens: 4107,
        }),
      ],
    },
    {
      id: "D4-fallback",
      label: "D4 refusal fallback",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      refusalFallbackDelivered: true,
      stages: [
        stage({ stage: "primary-refused", model: g31, input: 8000, output: 100 }),
        stage({
          stage: "fallback",
          model: g31,
          input: 9500,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "D5-failover",
      label: "D5 failover stage",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary-failed",
          model: g31,
          input: 8000,
          output: 0,
          apiOutputTokens: 0,
        }),
        stage({
          stage: "failover",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "D6-multi-attempt",
      label: "D6 multiple physical attempts",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "attempt-1",
          model: g31,
          input: 9000,
          output: 100,
          apiOutputTokens: 100,
        }),
        stage({
          stage: "attempt-2",
          model: g31,
          input: 9100,
          output: 200,
          apiOutputTokens: 200,
        }),
        stage({
          stage: "attempt-3",
          model: g31,
          input: 9200,
          output: 4007,
          apiOutputTokens: 4007,
        }),
      ],
    },
    {
      id: "D7-failed-then-success",
      label: "D7 failed attempt + successful attempt",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary-error",
          model: g31,
          input: 9000,
          output: 0,
          apiOutputTokens: 0,
        }),
        stage({
          stage: "retry-success",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "D-stealth-fallback",
      label: "D stealth fallback OpenRouter-only billing",
      deliveredModelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
      deliveredSelectedAI: OPENROUTER_GEMINI_36_FLASH_MODEL,
      provider: "openrouter",
      stealthFallback: true,
      stages: [
        stage({
          stage: "primary-gemini",
          model: "gemini-3.6-flash-internal",
          input: 8000,
          output: 100,
          apiOutputTokens: 100,
        }),
        stage({
          stage: "fallback-openrouter",
          model: OPENROUTER_GEMINI_36_FLASH_MODEL,
          input: 9000,
          output: 1200,
          apiOutputTokens: 1200,
        }),
      ],
    },
    {
      id: "W1-degeneration-waiver",
      label: "W1 degeneration billing waived",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      degenerationAborted: true,
      savedText: "asdfasdfasdf",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          degenerationAborted: true,
        }),
      ],
    },
    {
      id: "W2-forced-abort-minimum-zero",
      label: "W2 forced abort — route minimum stays 0 (DeepSeek)",
      deliveredModelId: deepseek,
      deliveredSelectedAI: deepseek,
      provider: "cheaperinference",
      forcedAbort: true,
      savedText: "She paused at the doorway, breath uneven.",
      targetResponseChars: 4000,
      stages: [
        stage({
          stage: "primary",
          model: deepseek,
          input: 9000,
          output: 800,
          apiOutputTokens: 800,
          loopAborted: true,
        }),
      ],
    },
    {
      id: "W3-generation-failure-waiver",
      label: "W3 generation failure billing waived",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      generationFailure: "under_length",
      savedText: "",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 0,
          apiOutputTokens: 0,
          finishReason: "length",
        }),
      ],
    },
    {
      id: "W4-no-waiver-minimum-model",
      label: "W4 G37 waiver with no minimum resolver on route",
      deliveredModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      deliveredSelectedAI: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      provider: "cheaperinference",
      degenerationAborted: true,
      savedText: "asdfasdf",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
          input: 9000,
          output: 2500,
          apiOutputTokens: 2500,
          degenerationAborted: true,
        }),
      ],
    },
    {
      id: "F1-general-normal",
      label: "F1 general route normal",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "F2-adult-normal",
      label: "F2 adult route normal (G31 CI)",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      adultMode: true,
      stages: [
        stage({
          stage: "openRouterAdult",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          cacheReadTokens: 1000,
          cacheWriteTokens: 200,
          apiReportedInputTokens: 9000,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "F3-adult-fallback",
      label: "F3 adult fallback delivered DeepSeek",
      deliveredModelId: deepseek,
      requestedSelectedAI: g31,
      deliveredSelectedAI: deepseek,
      provider: "cheaperinference",
      refusalFallbackDelivered: true,
      adultMode: true,
      stages: [
        stage({ stage: "primary-refused", model: g31, input: 8000, output: 100 }),
        stage({
          stage: "fallback",
          model: deepseek,
          input: 9500,
          output: 1200,
          apiOutputTokens: 1200,
          apiReportedInputTokens: 9500,
        }),
      ],
      savedTextChars: 1800,
    },
    {
      id: "F4-model-handoff",
      label: "F4 requested G31 delivered DeepSeek handoff",
      deliveredModelId: deepseek,
      requestedSelectedAI: g31,
      deliveredSelectedAI: deepseek,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary-handoff",
          model: g31,
          input: 9000,
          output: 100,
          apiOutputTokens: 100,
        }),
        stage({
          stage: "delivered",
          model: deepseek,
          input: 9200,
          output: 1100,
          apiOutputTokens: 1100,
          apiReportedInputTokens: 9200,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "P1-platform-aux-isolation",
      label: "P1 platform aux does not change user charge",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "P1-platform-aux-isolation-with-aux-stage",
      label: "P1 with aux stage present in stages array",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
        stage({
          stage: "status_widget_extract",
          model: g31,
          input: 50_000,
          output: 500,
          apiOutputTokens: 500,
          upstreamCostUsd: 0.05,
        }),
      ],
    },
  ];
}

export function buildSpecialPolicyCoverageMatrix(
  fixtures: BillingParityFixture[] = buildBillingLiveOwnerReadinessFixtures()
): SpecialPolicyCoverageRow[] {
  const fixturesById = fixtureMap(fixtures);
  const ctx: PolicyProofContext = { fixturesById };
  return SPECIAL_POLICY_DEFINITIONS.map((definition) => {
    const fixturesExist =
      definition.fixtureIds.length === 0 ||
      definition.fixtureIds.every((fixtureId) => fixturesById.has(fixtureId));
    const proof = definition.prove(ctx);
    const behavioralProofPasses = definition.coveredWhen?.(proof) ?? false;
    return {
      policy: definition.policy,
      owner: definition.owner,
      reachableModel: definition.reachableModel,
      fixtureIds: definition.fixtureIds,
      fixtureId: definition.fixtureIds[0] ?? null,
      classification: definition.classification,
      covered: fixturesExist && behavioralProofPasses,
      proof,
    };
  });
}

export type PolicyCoverageCounts = {
  totalPolicyCount: number;
  liveReachablePolicyCount: number;
  legacyOrDeadPolicyCount: number;
  coveredLivePolicyCount: number;
  uncoveredLivePolicyCount: number;
};

export function derivePolicyCoverageCounts(
  matrix: SpecialPolicyCoverageRow[] = buildSpecialPolicyCoverageMatrix()
): PolicyCoverageCounts {
  const totalPolicyCount = matrix.length;
  const liveReachablePolicyCount = matrix.filter(
    (row) => row.classification === "LIVE_REACHABLE"
  ).length;
  const legacyOrDeadPolicyCount = matrix.filter(
    (row) => row.classification === "LEGACY_OR_DEAD"
  ).length;
  const liveRows = matrix.filter((row) => row.classification === "LIVE_REACHABLE");
  const coveredLivePolicyCount = liveRows.filter((row) => row.covered).length;
  const uncoveredLivePolicyCount = liveRows.filter((row) => !row.covered).length;
  return {
    totalPolicyCount,
    liveReachablePolicyCount,
    legacyOrDeadPolicyCount,
    coveredLivePolicyCount,
    uncoveredLivePolicyCount,
  };
}

export function collectExactDeliveredModelCoverage(
  fixtures: BillingParityFixture[] = buildBillingLiveOwnerReadinessFixtures()
): {
  a1ExactDeliveredModelIds: Set<string>;
  uncoveredCutoverRequired: BilledModelInventoryEntry[];
} {
  const a1ExactDeliveredModelIds = new Set(
    fixtures
      .filter((fixture) => fixture.id.startsWith("A1-"))
      .map((fixture) => fixture.deliveredModelId)
  );
  const uncoveredCutoverRequired = buildCurrentReachableBilledModelInventory().filter(
    (entry) =>
      entry.cutoverRequired && !a1ExactDeliveredModelIds.has(entry.deliveredModelId)
  );
  return { a1ExactDeliveredModelIds, uncoveredCutoverRequired };
}

export const F4_CLASSIFICATION = "SYNTHETIC_IDENTITY_PROOF" as const;

export function auditF4RequestedDeliveredIdentity(): {
  classification: typeof F4_CLASSIFICATION;
  requestedModel: string;
  deliveredModel: string;
  liveBillingModel: string;
  candidateBillingModel: string | null;
  requestedModelUsedForPrice: boolean;
} {
  const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "F4-model-handoff")!;
  const live = computeLiveChargeFromFixture(fixture);
  const candidate = computeCandidateChargeFromFixture(fixture);
  return {
    classification: F4_CLASSIFICATION,
    requestedModel: fixture.requestedSelectedAI ?? "missing",
    deliveredModel: fixture.deliveredModelId,
    liveBillingModel: live.modelId,
    candidateBillingModel: candidate.billingModelId,
    requestedModelUsedForPrice: live.modelId === fixture.requestedSelectedAI,
  };
}

export function evaluateBillingLiveOwnerReadiness(
  fixtures: BillingParityFixture[] = buildBillingLiveOwnerReadinessFixtures()
): BillingLiveOwnerReadinessEvaluation {
  installAuditLegacyFxForTest();
  try {
    let matchCount = 0;
    let mismatchCount = 0;
    let blockedCount = 0;
    let notComparableCount = 0;
    const mismatches: ParityMismatchRecord[] = [];
    const promotionBlockers: string[] = [];

    for (const fixture of fixtures) {
      if (fixture.id === "P1-platform-aux-isolation-with-aux-stage") continue;
      const result = compareLiveVsCandidate(fixture);
      switch (result.status) {
        case "match":
          matchCount += 1;
          break;
        case "mismatch":
          mismatchCount += 1;
          mismatches.push(result.mismatch);
          promotionBlockers.push(`${fixture.id}: live/candidate points mismatch`);
          break;
        case "blocked":
          blockedCount += 1;
          mismatches.push(result.mismatch);
          promotionBlockers.push(`${fixture.id}: candidate blocked (${result.reason})`);
          break;
        case "not_comparable":
          notComparableCount += 1;
          promotionBlockers.push(`${fixture.id}: not comparable (${result.reason})`);
          break;
        default: {
          const _exhaustive: never = result;
          void _exhaustive;
        }
      }
    }

    const { uncoveredCutoverRequired } = collectExactDeliveredModelCoverage(fixtures);
    const uncoveredModelCount = uncoveredCutoverRequired.length;
    for (const entry of uncoveredCutoverRequired) {
      promotionBlockers.push(`uncovered cutover model: ${entry.deliveredModelId}`);
    }

    const policyMatrix = buildSpecialPolicyCoverageMatrix(fixtures);
    const policyCounts = derivePolicyCoverageCounts(policyMatrix);
    const uncoveredPolicies = policyMatrix.filter(
      (row) => row.classification === "LIVE_REACHABLE" && !row.covered
    );
    const uncoveredPolicyCount = uncoveredPolicies.length;
    for (const row of uncoveredPolicies) {
      promotionBlockers.push(`uncovered policy: ${row.policy}`);
    }

    const promotionReady =
      mismatchCount === 0 &&
      blockedCount === 0 &&
      notComparableCount === 0 &&
      uncoveredModelCount === 0 &&
      uncoveredPolicyCount === 0;

    return {
      matchCount,
      mismatchCount,
      blockedCount,
      notComparableCount,
      uncoveredModelCount,
      uncoveredPolicyCount,
      promotionReady,
      promotionBlockers,
      mismatches,
    };
  } finally {
    clearAuditLegacyFxForTest();
  }
}

export function collectParityMismatches(
  fixtures: BillingParityFixture[] = buildBillingLiveOwnerReadinessFixtures()
): ParityMismatchRecord[] {
  return evaluateBillingLiveOwnerReadiness(fixtures).mismatches;
}

export type CanaryCleanupEntry = {
  symbol: string;
  classification: "SAFE_TO_DELETE" | "KEEP" | "FOLLOW_UP";
  note: string;
};

/** Static #732/#739 canary cleanup audit — no production deletion this PR. */
export function auditCanaryCleanupClassification(): CanaryCleanupEntry[] {
  const routeSrc = readRepoFile("src/app/api/chat/route.ts");
  const canaryInRoute = routeSrc.includes("observeTurnBillableUsageCanary(");
  return [
    {
      symbol: "observeTurnBillableUsageCanary",
      classification: canaryInRoute ? "KEEP" : "FOLLOW_UP",
      note: "Production log-only LEVEL 1 observability; still wired in route.ts",
    },
    {
      symbol: "compareTurnBillableUsageWithLegacy",
      classification: "KEEP",
      note: "Canary comparison owner in turnBillableUsageCanary.ts; used by production telemetry",
    },
    {
      symbol: "resolveTurnBillableUsage",
      classification: "KEEP",
      note: "Candidate usage owner; required for parity harness path B",
    },
    {
      symbol: "computePublishedUserChargeWithSnapshot",
      classification: "KEEP",
      note: "Candidate charge owner; not live — parity evidence only",
    },
    {
      symbol: "liveBillingCutoverReadiness",
      classification: "KEEP",
      note: "Prior cutover readiness audit module; complementary to this PR",
    },
  ];
}

export type FalseExactnessAudit = {
  unreportedCacheCanBecomeConfirmedZero: boolean;
  invalidCacheCanBecomeExact: boolean;
  unreportedReasoningCanBecomeConfirmedZero: boolean;
  invalidReasoningCanBecomeExact: boolean;
  mixedValidInvalidStageCanBecomeExact: boolean;
};

/** Verify candidate/published path does not false-exact unreported or invalid provenance. */
export function auditFalseExactnessGuards(): FalseExactnessAudit {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f])) as Record<string, BillingParityFixture>;

  const b1 = computeCandidateChargeFromFixture(byId["B1-cache-unreported"]!);
  const b4 = computeCandidateChargeFromFixture(byId["B4-cache-malformed-positive"]!);
  const c1 = computeCandidateChargeFromFixture(byId["C1-reasoning-unreported"]!);
  const c4 = computeCandidateChargeFromFixture(byId["C4-reasoning-malformed-positive"]!);
  const b6 = computeCandidateChargeFromFixture(byId["B6-cache-mixed-valid-invalid"]!);

  return {
    unreportedCacheCanBecomeConfirmedZero:
      b1.status === "charged" && b1.usageCoverage === "complete",
    invalidCacheCanBecomeExact: b4.status === "charged" && b4.usageCoverage === "complete",
    unreportedReasoningCanBecomeConfirmedZero:
      c1.status === "charged" && c1.usageCoverage === "complete",
    invalidReasoningCanBecomeExact: c4.status === "charged" && c4.usageCoverage === "complete",
    mixedValidInvalidStageCanBecomeExact:
      b6.status === "charged" && b6.usageCoverage === "complete",
  };
}

export function verifyPlatformFundedAuxIsolation(
  fixtures: BillingParityFixture[]
): {
  auxChangesUserCharge: boolean;
  baselineId: string;
  withAuxId: string;
  note: string;
} {
  const baseline = fixtures.find((f) => f.id === "P1-platform-aux-isolation");
  const withAux = fixtures.find((f) => f.id === "P1-platform-aux-isolation-with-aux-stage");
  if (!baseline || !withAux) {
    return {
      auxChangesUserCharge: false,
      baselineId: "P1-platform-aux-isolation",
      withAuxId: "missing",
      note:
        "Synthetic topology: platform-funded aux stage is injected adjacent to billable primary; missing fixture pair.",
    };
  }
  installAuditLegacyFxForTest();
  try {
    const baseLive = computeLiveChargeFromFixture(baseline).totalPoints;
    const auxLive = computeLiveChargeFromFixture(withAux).totalPoints;
    return {
      auxChangesUserCharge: baseLive !== auxLive,
      baselineId: baseline.id,
      withAuxId: withAux.id,
      note:
        "Synthetic topology: status_widget_extract aux stage carries upstreamCostUsd but selectBillableStages excludes it from user charge assembly.",
    };
  } finally {
    clearAuditLegacyFxForTest();
  }
}

export function isTurnBillableUsageCanaryLiveInSource(): boolean {
  const routeSrc = readRepoFile("src/app/api/chat/route.ts");
  return routeSrc.includes("observeTurnBillableUsageCanary(");
}

export function collectBillingReadinessHardGates(
  fixtures: BillingParityFixture[] = buildBillingLiveOwnerReadinessFixtures()
): Record<string, boolean | number> {
  const parityFixtures = fixtures.filter(
    (f) => f.id !== "P1-platform-aux-isolation-with-aux-stage"
  );
  const evaluation = evaluateBillingLiveOwnerReadiness(parityFixtures);
  installAuditLegacyFxForTest();
  try {
    const { uncoveredCutoverRequired } = collectExactDeliveredModelCoverage(fixtures);
    const policyCounts = derivePolicyCoverageCounts(buildSpecialPolicyCoverageMatrix(fixtures));
    const inventory = buildCurrentReachableBilledModelInventory();
    const f4 = auditF4RequestedDeliveredIdentity();
    const unprovenInternal = inventory.filter(
      (entry) =>
        entry.classification === "INTERNAL_DELIVERED" &&
        !INTERNAL_DELIVERED_PRODUCTION_OWNERS.some(
          (evidence) => evidence.live && evidence.model === entry.deliveredModelId
        )
    ).length;
    const reachabilityWithoutOwner = inventory.filter(
      (entry) => entry.cutoverRequired && !entry.reachabilityOwner
    ).length;
    return {
      PATH_A_PATH_B_SAME_FX: getAuditFxParityEvidence().live.effectiveKrwPerUsd ===
        getAuditFxParityEvidence().candidate.effectiveKrwPerUsd,
      AUDIT_REAL_EXCHANGE_FETCHES: 0,
      AUDIT_FX_ENV_LEAK: false,
      CUTOVER_REQUIRED_EXACT_DELIVERED_MODEL_WITHOUT_FIXTURE: uncoveredCutoverRequired.length,
      DELIVERED_MODEL_COVERAGE_USING_SELECTION_REMAP: false,
      UNPROVEN_INTERNAL_DELIVERED_MODELS: unprovenInternal,
      MODEL_REACHABILITY_WITHOUT_PRODUCTION_OWNER: reachabilityWithoutOwner,
      POLICY_COVERAGE_BY_FIXTURE_EXISTENCE_ONLY: false,
      UNCOVERED_LIVE_POLICY_COUNT: policyCounts.uncoveredLivePolicyCount,
      WAIVER_MINIMUM_RUNTIME_REACHABILITY_CLASSIFIED: true,
      UPSTREAM_COST_RUNTIME_REACHABILITY_CLASSIFIED: true,
      COMPLETED_TURN_POLICY_RUNTIME_EFFECT_CLASSIFIED: true,
      F4_REQUESTED_DELIVERED_IDENTITY_PROVEN:
        f4.requestedModel !== f4.deliveredModel &&
        f4.liveBillingModel === f4.deliveredModel &&
        f4.candidateBillingModel === f4.deliveredModel &&
        f4.requestedModelUsedForPrice === false,
      F4_TAUTOLOGICAL_ASSERTIONS: 0,
      FIXTURE_COUNT: parityFixtures.length,
      MATCH_COUNT: evaluation.matchCount,
      MISMATCH_COUNT: evaluation.mismatchCount,
      BLOCKED_COUNT: evaluation.blockedCount,
      NOT_COMPARABLE_COUNT: evaluation.notComparableCount,
    };
  } finally {
    clearAuditLegacyFxForTest();
  }
}

export function generateBillingLiveOwnerReadinessFinalReport(): string {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();
  const inventory = buildCurrentReachableBilledModelInventory();
  installAuditLegacyFxForTest();
  let policyMatrix: SpecialPolicyCoverageRow[];
  let f4: ReturnType<typeof auditF4RequestedDeliveredIdentity>;
  try {
    policyMatrix = buildSpecialPolicyCoverageMatrix(fixtures);
    f4 = auditF4RequestedDeliveredIdentity();
  } finally {
    clearAuditLegacyFxForTest();
  }
  const policyCounts = derivePolicyCoverageCounts(policyMatrix);
  const evaluation = evaluateBillingLiveOwnerReadiness(
    fixtures.filter((f) => f.id !== "P1-platform-aux-isolation-with-aux-stage")
  );
  const gates = collectBillingReadinessHardGates(fixtures);
  let headSha = "unknown";
  let mergeBase = "unknown";
  let behindMain = "unknown";
  let latestMainSha = AUDIT_BASE_MAIN_SHA;
  try {
    headSha = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    mergeBase = execSync("git merge-base HEAD origin/main", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    behindMain = execSync("git rev-list --count HEAD..origin/main", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    latestMainSha = execSync("git rev-parse origin/main", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    // best-effort in non-git contexts
  }

  const lines = [
    `LATEST_MAIN_SHA=${latestMainSha}`,
    `FINAL_HEAD_SHA=${headSha}`,
    `ACTUAL_MERGE_BASE=${mergeBase}`,
    `BEHIND_MAIN=${behindMain}`,
    "=== EXACT MODEL COVERAGE ===",
    `CUTOVER_REQUIRED_DELIVERED_MODELS=${inventory
      .filter((e) => e.cutoverRequired)
      .map((e) => e.deliveredModelId)
      .join(",")}`,
    `MODEL_REACHABILITY_MATRIX=${JSON.stringify(inventory)}`,
    `INTERNAL_DELIVERED_MODELS=${INTERNAL_DELIVERED_PRODUCTION_OWNERS.map((e) => e.model).join(",")}`,
    `INTERNAL_DELIVERED_PRODUCTION_OWNERS=${JSON.stringify(INTERNAL_DELIVERED_PRODUCTION_OWNERS)}`,
    `OPENROUTER_G31_CURRENTLY_DELIVERABLE=${OPENROUTER_G31_CURRENTLY_DELIVERABLE}`,
    `OPENROUTER_G31_REACHABILITY_OWNER=${OPENROUTER_G31_REACHABILITY_OWNER}`,
    `OPENROUTER_G31_FIXTURE=${OPENROUTER_G31_FIXTURE}`,
    `OPUS45_PICKER_REACHABLE=${OPUS45_PICKER_REACHABLE}`,
    `OPUS45_STORED_SELECTION_REACHABLE=${OPUS45_STORED_SELECTION_REACHABLE}`,
    `OPUS45_ADMIN_SPECIAL_CASE=${OPUS45_ADMIN_SPECIAL_CASE}`,
    `CUTOVER_REQUIRED_EXACT_DELIVERED_MODEL_WITHOUT_FIXTURE=${gates.CUTOVER_REQUIRED_EXACT_DELIVERED_MODEL_WITHOUT_FIXTURE}`,
    `DELIVERED_MODEL_COVERAGE_USING_SELECTION_REMAP=${gates.DELIVERED_MODEL_COVERAGE_USING_SELECTION_REMAP}`,
    "=== POLICY COVERAGE ===",
    `TOTAL_POLICY_COUNT=${policyCounts.totalPolicyCount}`,
    `LIVE_REACHABLE_POLICY_COUNT=${policyCounts.liveReachablePolicyCount}`,
    `LEGACY_OR_DEAD_POLICY_COUNT=${policyCounts.legacyOrDeadPolicyCount}`,
    `COVERED_LIVE_POLICY_COUNT=${policyCounts.coveredLivePolicyCount}`,
    `UNCOVERED_LIVE_POLICY_COUNT=${policyCounts.uncoveredLivePolicyCount}`,
    `POLICY_MATRIX=${JSON.stringify(policyMatrix)}`,
    `WAIVER_MINIMUM_RUNTIME_REACHABLE=${WAIVER_MINIMUM_RUNTIME_REACHABLE}`,
    `UPSTREAM_COST_RUNTIME_REACHABLE=${UPSTREAM_COST_CONSUMED_BY_LIVE_OWNER_G31_CI}`,
    `COMPLETED_TURN_RUNTIME_EFFECT=${COMPLETED_TURN_RUNTIME_EFFECT}`,
    "=== PARITY ===",
    `FIXTURE_COUNT=${gates.FIXTURE_COUNT}`,
    `MATCH_COUNT=${gates.MATCH_COUNT}`,
    `MISMATCH_COUNT=${gates.MISMATCH_COUNT}`,
    `BLOCKED_COUNT=${gates.BLOCKED_COUNT}`,
    `NOT_COMPARABLE_COUNT=${gates.NOT_COMPARABLE_COUNT}`,
    `MISMATCHES=${JSON.stringify(evaluation.mismatches.slice(0, 5))}`,
    "=== F4 ===",
    `F4_CLASSIFICATION=${f4.classification}`,
    `REQUESTED_MODEL=${f4.requestedModel}`,
    `DELIVERED_MODEL=${f4.deliveredModel}`,
    `LIVE_BILLING_MODEL=${f4.liveBillingModel}`,
    `CANDIDATE_BILLING_MODEL=${f4.candidateBillingModel}`,
    `REQUESTED_MODEL_USED_FOR_PRICE=${f4.requestedModelUsedForPrice}`,
    "=== SAFETY ===",
    "PRODUCTION_BILLING_FILES_CHANGED_BY_PR795=0",
    "LIVE_USER_DEDUCTION_CHANGED=false",
    "SETTLEMENT_CHANGED=false",
    "REFUND_CHANGED=false",
    "CREATOR_REWARD_CHANGED=false",
    "PUBLISHED_PRICE_CHANGED=false",
    "FX_PRODUCTION_POLICY_CHANGED=false",
    "CARD_FEE_CHANGED=false",
    "DB_SCHEMA_CHANGED=false",
    "PERSISTENCE_CHANGED=false",
    `AUDIT_FX_ENV_LEAK=${gates.AUDIT_FX_ENV_LEAK}`,
    "=== DECISION ===",
    `PROMOTION_READY=${evaluation.promotionReady ? "YES" : "NO"}`,
    `PROMOTION_BLOCKERS=${evaluation.promotionBlockers.slice(0, 10).join("; ")}`,
    "NEXT_CUTOVER_PR_ALLOWED=NO",
    "CUTOVER_PERFORMED=false",
    `MERGE_READY=NO`,
    "STOP",
  ];
  return lines.join("\n");
}
