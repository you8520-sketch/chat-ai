/**
 * Billing live-owner cutover READINESS AUDIT — test/audit only.
 * NO production route imports. NO live owner mutation. NO deduction capability.
 *
 * Compares:
 *   A = current live charge path (computeTurnBilling / computeHtmlFlashOnlyTurnBilling)
 *   B = candidate path (resolveTurnBillableUsage → computePublishedUserChargeWithSnapshot)
 */

import { readFileSync } from "node:fs";
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
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  coerceUserSelectableAI,
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
  resolveUserChatSelectedAI,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  _clearLegacyExchangeRateCacheForTest,
  _setLegacyExchangeRateCacheForTest,
  getKstDateKey,
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

/** Frozen at origin/main cc5c88f41d6abdc3f923430161189dfaa2b87532 — BASE live charge golden totals. */
export const AUDIT_BASE_MAIN_SHA = "cc5c88f41d6abdc3f923430161189dfaa2b87532";

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
  | "ADMIN_REACHABLE"
  | "HIDDEN_BUT_CANONICAL_VALID"
  | "INTERNAL_DELIVERED"
  | "LEGACY_COMPAT_ONLY"
  | "NOT_LIVE";

export type BilledModelInventoryEntry = {
  modelId: string;
  selectedAI: SelectedAI | null;
  provider: ReturnType<typeof selectedAIProvider> | "openrouter";
  classification: BilledModelReachabilityClass;
  cutoverRequired: boolean;
};

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

const INTERNAL_DELIVERED_MODELS = new Set<string>([
  ADULT_REFUSAL_FALLBACK_MODEL_ID,
  OPENROUTER_GEMINI_31_PRO_MODEL,
]);

function classifySelectedOption(id: SelectedAI): BilledModelReachabilityClass {
  if (id === DEFAULT_SELECTED_AI) return "USER_DEFAULT";
  if (USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === id)) return "USER_SELECTABLE";
  if (id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL && !isOpus5UserEnabled()) {
    return "ADMIN_REACHABLE";
  }
  if (id === CLAUDE_OPUS_MODEL) {
    return isOpusUserSelectable() ? "USER_SELECTABLE" : "ADMIN_REACHABLE";
  }
  if (HIDDEN_CANONICAL_SELECTED.has(id)) return "HIDDEN_BUT_CANONICAL_VALID";
  return "USER_SELECTABLE";
}

function isCutoverRequiredClassification(
  classification: BilledModelReachabilityClass
): boolean {
  switch (classification) {
    case "USER_DEFAULT":
    case "USER_SELECTABLE":
    case "ADMIN_REACHABLE":
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
    byId.set(opt.id, {
      modelId: opt.id,
      selectedAI: opt.id,
      provider: selectedAIProvider(opt.id),
      classification,
      cutoverRequired: isCutoverRequiredClassification(classification),
    });
  }

  if (!isOpus5UserEnabled() && byId.has(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL)) {
    byId.set(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, {
      ...byId.get(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL)!,
      classification: "ADMIN_REACHABLE",
      cutoverRequired: true,
    });
  }

  for (const modelId of INTERNAL_DELIVERED_MODELS) {
    if (byId.has(modelId)) continue;
    const selectedAI = coerceUserSelectableAI(resolveSelectedAI(modelId));
    byId.set(modelId, {
      modelId,
      selectedAI,
      provider: selectedAIProvider(selectedAI),
      classification: "INTERNAL_DELIVERED",
      cutoverRequired: true,
    });
  }

  for (const legacySlug of LEGACY_INVENTORY_SLUGS) {
    if (byId.has(legacySlug)) continue;
    const resolved = resolveSelectedAI(legacySlug);
    byId.set(legacySlug, {
      modelId: legacySlug,
      selectedAI: resolved,
      provider: selectedAIProvider(resolved),
      classification: "LEGACY_COMPAT_ONLY",
      cutoverRequired: false,
    });
  }

  return [...byId.values()].sort((a, b) => a.modelId.localeCompare(b.modelId));
}

export const CUTOVER_REQUIRED_MODEL_FAMILIES: readonly string[] =
  buildCurrentReachableBilledModelInventory()
    .filter((entry) => entry.cutoverRequired)
    .map((entry) => entry.modelId);

export const AUDIT_FX_SNAPSHOT: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: AUDIT_BASE_USD_KRW,
  effectiveKrwPerUsd: AUDIT_EFFECTIVE_KRW_PER_USD,
  source: "api_daily",
  overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
  locked: true,
};

export function installAuditLegacyFxForTest(): void {
  _setLegacyExchangeRateCacheForTest({
    dateKey: getKstDateKey(),
    usdToKrw: AUDIT_BASE_USD_KRW,
    source: "api",
  });
}

export function clearAuditLegacyFxForTest(): void {
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
  return {
    live: {
      baseUsdKrw: AUDIT_BASE_USD_KRW,
      effectiveKrwPerUsd: AUDIT_EFFECTIVE_KRW_PER_USD,
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
      usageCoverage: UserBillableUsageCoverage;
      publishedStatus: "complete";
    }
  | {
      status: "blocked";
      reason: string;
      usageCoverage: UserBillableUsageCoverage;
      publishedStatus: "blocked";
    }
  | {
      status: "not_comparable";
      reason: string;
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
  fixtureId: string | null;
  covered: boolean;
  classification?: "LIVE" | "LEGACY_COMPAT" | "CANDIDATE_ONLY";
};

const SPECIAL_POLICY_DEFINITIONS: Array<{
  policy: string;
  owner: string;
  reachableModel: string;
  fixtureId: string | null;
  classification?: SpecialPolicyCoverageRow["classification"];
}> = [
  {
    policy: "input surcharge (userContextChars)",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureId: "A1-g31-normal",
  },
  {
    policy: "output-token pricing (api vs savedText fallback)",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    fixtureId: "C6-reasoning-in-completion",
  },
  {
    policy: "reasoning token semantics",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureId: "C3-reasoning-positive",
  },
  {
    policy: "cache read/write semantics",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    fixtureId: "B3-cache-valid-positive",
  },
  {
    policy: "savedTextChars character-priced models",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    fixtureId: "A1-opus5-normal",
  },
  {
    policy: "userContext surcharge",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureId: "A3-large-io",
  },
  {
    policy: "completed-turn cold-start (Opus first turn)",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    fixtureId: "A1-opus5-normal",
  },
  {
    policy: "upstream actual-cost billing (Gemini/OpenRouter USD)",
    owner: BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER,
    reachableModel: OPENROUTER_GEMINI_36_FLASH_MODEL,
    fixtureId: null,
  },
  {
    policy: "waiver minimum charge resolvers",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_BILLING_WAIVER_OWNER,
    reachableModel: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    fixtureId: "W4-waiver-minimum",
  },
  {
    policy: "promptAudit input cap",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureId: "A3-large-io",
  },
  {
    policy: "refusal fallback stage selection",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureId: "D4-fallback",
  },
  {
    policy: "stealth fallback OpenRouter-only stage selection",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USAGE_INPUT_OWNER,
    reachableModel: OPENROUTER_GEMINI_31_PRO_MODEL,
    fixtureId: null,
  },
  {
    policy: "gemini37FlashPricing dedicated formula",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_SPECIAL_POLICY_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    fixtureId: "A1-g37-normal",
  },
  {
    policy: "unified-reasoning margins (G31 CI, Opus5)",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_SPECIAL_POLICY_OWNER,
    reachableModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    fixtureId: "A1-g31-normal",
  },
  {
    policy: "Qwen output-token pricing",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_PRICE_OWNER,
    reachableModel: OPENROUTER_QWEN_37_MAX_MODEL,
    fixtureId: null,
    classification: "LEGACY_COMPAT",
  },
  {
    policy: "Muse margin pricing",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_PRICE_OWNER,
    reachableModel: OPENROUTER_MUSE_SPARK_11_MODEL,
    fixtureId: null,
    classification: "LEGACY_COMPAT",
  },
  {
    policy: "Kimi margin pricing",
    owner: BILLING_LIVE_OWNER_MAP.CURRENT_MODEL_PRICE_OWNER,
    reachableModel: OPENROUTER_KIMI_K3_MODEL,
    fixtureId: null,
    classification: "LEGACY_COMPAT",
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
      usageCoverage: candidate.usageCoverage,
      publishedStatus: "blocked",
    };
  }

  return {
    status: "charged",
    finalPoints: published.snapshot.finalPoints,
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

/** Placeholder — populate after frozen golden run with installAuditLegacyFxForTest(). */
export const FROZEN_LIVE_CHARGE_GOLDEN: Readonly<Record<BillingParityFixtureId, number>> = {};

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
  const resolved = resolveSelectedAI(modelId) as SelectedAI;
  const provider = selectedAIProvider(resolved);
  return provider === "openai" ? "cheaperinference" : provider;
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
    return {
      id: spec.id,
      label: spec.label,
      deliveredModelId: spec.modelId,
      deliveredSelectedAI: resolveSelectedAI(spec.modelId) as SelectedAI,
      provider,
      stages: [primary],
      savedTextChars: spec.savedTextChars,
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
      id: "W2-generation-failure-waiver",
      label: "W2 generation failure billing waived",
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
      id: "W3-forced-abort-waiver",
      label: "W3 loop abort with garbage output waived",
      deliveredModelId: g31,
      deliveredSelectedAI: g31,
      provider: "cheaperinference",
      forcedAbort: true,
      savedText: "!!!!!",
      stages: [
        stage({
          stage: "primary",
          model: g31,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          loopAborted: true,
        }),
      ],
    },
    {
      id: "W4-waiver-minimum",
      label: "W4 waiver minimum floor on healthy partial output",
      deliveredModelId: deepseek,
      deliveredSelectedAI: deepseek,
      provider: "cheaperinference",
      forcedAbort: true,
      savedText:
        "She paused at the doorway, fingers tracing the chipped paint. The hallway smelled of rain and old wood. Whatever waited inside, she would face it without looking back.",
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
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  return SPECIAL_POLICY_DEFINITIONS.map((definition) => ({
    policy: definition.policy,
    owner: definition.owner,
    reachableModel: definition.reachableModel,
    fixtureId: definition.fixtureId,
    covered: definition.fixtureId != null && fixtureIds.has(definition.fixtureId),
    classification: definition.classification,
  }));
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

    const inventory = buildCurrentReachableBilledModelInventory();
    const a1Models = new Set(
      fixtures.filter((fixture) => fixture.id.startsWith("A1-")).map((fixture) => fixture.deliveredModelId)
    );
    const uncoveredModels = inventory.filter(
      (entry) => entry.cutoverRequired && !a1Models.has(entry.modelId)
    );
    const uncoveredModelCount = uncoveredModels.length;
    for (const entry of uncoveredModels) {
      promotionBlockers.push(`uncovered cutover model: ${entry.modelId}`);
    }

    const policyMatrix = buildSpecialPolicyCoverageMatrix(fixtures);
    const uncoveredPolicies = policyMatrix.filter(
      (row) => row.classification !== "LEGACY_COMPAT" && !row.covered
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
