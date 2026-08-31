/**
 * Billing live-owner cutover READINESS AUDIT — test/audit only.
 * NO production route imports. NO live owner mutation. NO deduction capability.
 *
 * Compares:
 *   A = current live charge path (computeTurnBilling via legacy route assembly)
 *   B = candidate path (resolveTurnBillableUsage → computePublishedUserChargeWithSnapshot)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { computeTurnBilling } from "@/lib/points";
import {
  computePublishedUserChargeWithSnapshot,
  type PublishedChargeAdjustment,
  type PublishedUserChargeResult,
} from "@/lib/publishedUserCharge";
import {
  billableOpenRouterOutputTokens,
  resolveRouteApiTokensForCost,
  resolveTurnBillableInput,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
} from "@/lib/stageBillableUsage";
import {
  type UserBillableUsageCoverage,
} from "@/lib/billingUsage";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import { GEMINI31_MODEL_ID, OPUS5_MODEL_ID } from "@/lib/premiumModelIds";
import type { UsageReportingEvidence } from "@/lib/usageReportingEvidence";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** Frozen at origin/main cc5c88f41d6abdc3f923430161189dfaa2b87532 — BASE live charge golden totals. */
export const AUDIT_BASE_MAIN_SHA = "cc5c88f41d6abdc3f923430161189dfaa2b87532";

export const BILLING_LIVE_OWNER_MAP = {
  CURRENT_LIVE_USER_CHARGE_OWNER:
    "computeTurnBilling() via @/lib/points → pointsReasoningMargins → pointsMuse60 → points.ts",
  CURRENT_LIVE_USAGE_INPUT_OWNER:
    "selectBillableStages + resolveTurnBillableInput + sumOpenRouterStage* in stageBillableUsage.ts (assembled in route.ts)",
  CURRENT_POINT_DEDUCTION_OWNER:
    "settleChatTurnBillingExactlyOnce() → deductPointsOnDb() in chatBillingSettlement.ts / points.ts",
  CURRENT_BILLING_SETTLEMENT_OWNER: "settleChatTurnBillingExactlyOnce() in chatBillingSettlement.ts",
  CURRENT_REFUND_OWNER: "refund flows in src/lib/refund* (canonical settled points)",
  CURRENT_CREATOR_REWARD_OWNER: "creator reward derivation from settled usage (unchanged this PR)",
  CURRENT_BILLING_WAIVER_OWNER: "shouldWaiveTurnBilling() + resolve*WaiverMinimumCharge() in points.ts (route.ts composes)",
  CURRENT_FX_SNAPSHOT_OWNER: "exchangeRate.ts (live); shadowBillingExchangeRate.ts (shadow/admin)",
  CURRENT_CARD_FEE_OWNER: "OVERSEAS_CARD_FEE_PERCENT in exchangeRate.ts (0.02)",
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

export const LIVE_BILLED_MODEL_FAMILIES = [
  "gemini-3.7-flash",
  GEMINI31_MODEL_ID,
  OPUS5_MODEL_ID,
  "qwen/qwen3.7-max",
  "deepseek/deepseek-v4-pro",
  "google/gemini-3.6-flash",
  "meta/muse-spark-1.1",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

export const SPECIAL_BILLING_POLICIES = [
  "gemini37FlashPricing dedicated formula (apiPrompt preference)",
  "unified-reasoning margins (G31 CI, Opus5)",
  "character-priced Opus blend path",
  "Qwen output-token pricing",
  "Muse margin pricing",
  "waiver minimum charge resolvers (model-specific)",
  "Opus cold-start cache write threshold",
  "prompt audit input cap (resolveTurnBillableInput)",
  "refusal fallback stage selection",
  "stealth fallback OpenRouter-only stage selection",
] as const;

export type BillingParityFixtureId = string;

export type BillingParityFixture = {
  id: BillingParityFixtureId;
  label: string;
  modelId: string;
  provider: "cheaperinference" | "openrouter";
  stages: StageUsage[];
  promptAuditTotal?: number | null;
  refusalFallbackDelivered?: boolean;
  savedTextChars?: number;
  billingWaived?: boolean;
  waiverReason?: string;
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
};

export type ParityComparisonResult =
  | { status: "match"; livePoints: number; candidatePoints: number }
  | { status: "not_comparable"; reason: string; livePoints: number | null; candidatePoints: number | null }
  | { status: "mismatch"; livePoints: number; candidatePoints: number | null; mismatch: ParityMismatchRecord };

export const AUDIT_FX_SNAPSHOT: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

/** Mirrors route.ts LEVEL 1 assembly — independent of turnBillableUsage candidate. */
export function resolveLegacyRouteUsageBasis(opts: {
  stages: StageUsage[];
  modelId: string;
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
}): LegacyRouteUsageBasis {
  const billableStages = selectBillableStages(opts.stages, {
    refusalFallbackDelivered: opts.refusalFallbackDelivered ?? false,
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

/** Path A — current live user charge (authoritative today). */
export function computeLiveChargeFromFixture(fixture: BillingParityFixture): LiveChargeAuditResult {
  const basis = resolveLegacyRouteUsageBasis({
    stages: fixture.stages,
    modelId: fixture.modelId,
    refusalFallbackDelivered: fixture.refusalFallbackDelivered,
    promptAuditTotal: fixture.promptAuditTotal,
  });

  if (fixture.billingWaived) {
    return { totalPoints: 0, modelId: fixture.modelId, basis };
  }

  const billing = computeTurnBilling({
    provider: fixture.provider,
    openRouterModelId: fixture.modelId,
    inputTokens: basis.routeTotalInput,
    outputTokens: basis.routeChargeOutput,
    reasoningTokens: basis.reasoningTotal,
    cacheReadTokens: basis.cacheReadTokens,
    cacheWriteTokens: basis.cacheWriteTokens,
    apiPromptTokens: basis.apiPromptTokensForCost,
    apiCompletionTokens: basis.apiCompletionTokensForCost,
    savedTextChars: fixture.savedTextChars ?? 0,
    completedTurnsBeforeRequest: 0,
    modelLabel: fixture.modelId,
  });

  return { totalPoints: billing.total, modelId: billing.modelId, basis };
}

/** Path B — candidate published charge (NOT live). Independent of computeTurnBilling. */
export function computeCandidateChargeFromFixture(
  fixture: BillingParityFixture
): CandidateChargeAuditResult {
  const candidate = resolveTurnBillableUsage({
    stages: fixture.stages,
    modelId: fixture.modelId,
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

  const adjustment: PublishedChargeAdjustment = fixture.billingWaived
    ? { kind: "waiver", reason: fixture.waiverReason ?? "audit_waiver" }
    : { kind: "none" };

  const published: PublishedUserChargeResult = computePublishedUserChargeWithSnapshot({
    modelId: fixture.modelId,
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
    const mismatch: ParityMismatchRecord = {
      id: `${fixture.id}-blocked`,
      fixtureId: fixture.id,
      modelId: fixture.modelId,
      scenario: fixture.label,
      liveResult: live.totalPoints,
      candidateResult: null,
      firstDivergenceOwner: BILLING_LIVE_OWNER_MAP.CANDIDATE_PUBLISHED_CHARGE_OWNER,
      rootCause: candidate.reason,
      class: classifyBlockedReason(candidate.reason),
      moneyImpact: "user_charge",
      cutoverBlocker: true,
    };
    return {
      status: "mismatch",
      livePoints: live.totalPoints,
      candidatePoints: null,
      mismatch,
    };
  }

  if (live.totalPoints === candidate.finalPoints) {
    return { status: "match", livePoints: live.totalPoints, candidatePoints: candidate.finalPoints };
  }

  const mismatch: ParityMismatchRecord = {
    id: `${fixture.id}-points`,
    fixtureId: fixture.id,
    modelId: fixture.modelId,
    scenario: fixture.label,
    liveResult: live.totalPoints,
    candidateResult: candidate.finalPoints,
    firstDivergenceOwner: BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USER_CHARGE_OWNER,
    rootCause: "live computeTurnBilling vs published charge engine policy/formula divergence",
    class: "DIFFERENT_POLICY",
    moneyImpact: "user_charge",
    cutoverBlocker: true,
  };
  return {
    status: "mismatch",
    livePoints: live.totalPoints,
    candidatePoints: candidate.finalPoints,
    mismatch,
  };
}

function classifyBlockedReason(reason: string): ParityMismatchClass {
  if (reason.includes("cache")) return "CACHE_SEMANTICS";
  if (reason.includes("tier") || reason.includes("unsupported_model")) return "PRICING_IDENTITY";
  if (reason.includes("usage")) return "MISSING_PROVENANCE";
  if (reason.includes("waiver")) return "WAIVER";
  return "OTHER";
}

/** Golden live totals frozen from BASE main execution — HEAD must match exactly. */
export const FROZEN_LIVE_CHARGE_GOLDEN: Readonly<Record<BillingParityFixtureId, number>> = {
  "A1-g37-normal": 35,
  "A1-g31-normal": 150,
  "A1-opus-normal": 112,
  "A1-qwen-normal": 58,
  "A1-g36-normal": 65,
  "A1-muse-normal": 44,
  "A2-small-io": 4,
  "A3-large-io": 977,
  "A4-zero-reasoning": 150,
  "A5-positive-reasoning": 112,
  "B1-cache-unreported": 112,
  "B2-cache-valid-zero": 112,
  "B3-cache-valid-positive": 79,
  "B4-cache-malformed-positive": 112,
  "B5-cache-invalid-beats-valid": 147,
  "B6-cache-mixed-valid-invalid": 48,
  "C1-reasoning-unreported": 150,
  "C2-reasoning-zero": 150,
  "C3-reasoning-positive": 117,
  "C4-reasoning-malformed-positive": 150,
  "C5-reasoning-valid-invalid-stage": 49,
  "C6-reasoning-in-completion": 112,
  "D1-single-stage": 150,
  "D2-recovery": 49,
  "D3-continuation": 44,
  "D4-fallback": 152,
  "D5-failover": 35,
  "D6-multi-attempt": 42,
  "D7-failed-then-success": 39,
  "E1-waiver": 0,
  "E2-waiver-min-not-applied-live": 0,
  "F1-general-normal": 150,
  "F2-adult-normal": 324,
  "F3-adult-fallback": 331,
  "F4-model-handoff": 112,
  "G1-regen-current-gen-only": 150,
  "P1-platform-aux-isolation": 150,
};

export function verifyBaseVsHeadLiveParity(
  fixtures: BillingParityFixture[]
): { mismatchCount: number; mismatches: Array<{ fixtureId: string; expected: number; actual: number }> } {
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
}

export type InternalReaderAuditEntry = {
  reader: string;
  record: "status_meta" | "suggested_replies" | "both";
  scope: "client" | "admin" | "internal_semantic" | "raw_io" | "fork_copy";
  classification: "SAFE" | "FIXED_THIS_PR" | "FOLLOW_UP";
  note: string;
};

/** Static source audit — semantic continuity readers for async logical records. */
export function auditInternalAsyncRecordReaders(): InternalReaderAuditEntry[] {
  return [
    {
      reader: "clientAsyncRecordRead (5 client readers)",
      record: "both",
      scope: "client",
      classification: "FOLLOW_UP",
      note: "Generation-scoped on PR #788 branch; main may still be unscoped until merge",
    },
    {
      reader: "adminBillingReceiptV3Server",
      record: "both",
      scope: "admin",
      classification: "SAFE",
      note: "Generation-scoped async record filter on main",
    },
    {
      reader: "loadPreviousTurnStatusMeta",
      record: "status_meta",
      scope: "internal_semantic",
      classification: "FOLLOW_UP",
      note: "Prior-turn extraction continuity; generation filter landed on PR #788 branch",
    },
    {
      reader: "loadMessageStatusMeta / loadMessageSuggestedReplies",
      record: "both",
      scope: "raw_io",
      classification: "SAFE",
      note: "Raw DB load; semantic filter at use sites (client/admin/requeue)",
    },
    {
      reader: "fork/route.ts",
      record: "both",
      scope: "fork_copy",
      classification: "SAFE",
      note: "Copies raw JSON to new chat; no cross-turn semantic continuity",
    },
    {
      reader: "requeue*ExtractionIfNeeded",
      record: "both",
      scope: "internal_semantic",
      classification: "SAFE",
      note: "Generation-scoped requeue gate on main",
    },
  ];
}

export function countUnscopedSemanticReaders(entries: InternalReaderAuditEntry[]): number {
  return entries.filter(
    (e) => e.scope === "internal_semantic" && e.classification === "FOLLOW_UP"
  ).length;
}

export function isTurnBillableUsageCanaryLiveInSource(): boolean {
  const routeSrc = readRepoFile("src/app/api/chat/route.ts");
  return routeSrc.includes("observeTurnBillableUsageCanary(");
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

export function collectParityMismatches(fixtures: BillingParityFixture[]): ParityMismatchRecord[] {
  const mismatches: ParityMismatchRecord[] = [];
  for (const fixture of fixtures) {
    const result = compareLiveVsCandidate(fixture);
    if (result.status === "mismatch") {
      mismatches.push(result.mismatch);
    }
  }
  return mismatches;
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
): { auxChangesUserCharge: boolean; baselineId: string; withAuxId: string } {
  const baseline = fixtures.find((f) => f.id === "P1-platform-aux-isolation");
  const withAux = fixtures.find((f) => f.id === "P1-platform-aux-isolation-with-aux-stage");
  if (!baseline || !withAux) {
    return { auxChangesUserCharge: false, baselineId: "P1-platform-aux-isolation", withAuxId: "missing" };
  }
  const baseLive = computeLiveChargeFromFixture(baseline).totalPoints;
  const auxLive = computeLiveChargeFromFixture(withAux).totalPoints;
  return {
    auxChangesUserCharge: baseLive !== auxLive,
    baselineId: baseline.id,
    withAuxId: withAux.id,
  };
}

export function buildBillingLiveOwnerReadinessFixtures(): BillingParityFixture[] {
  return [
    {
      id: "A1-g37-normal",
      label: "A1 G37 normal",
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
          input: 9000,
          output: 2500,
          apiOutputTokens: 2500,
          apiReportedInputTokens: 9000,
        }),
      ],
    },
    {
      id: "A1-g31-normal",
      label: "A1 G31 CI normal",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          apiReportedInputTokens: 9000,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "A1-opus-normal",
      label: "A1 Opus5 normal",
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
          input: 9000,
          output: 500,
          apiOutputTokens: 500,
          apiReportedInputTokens: 9000,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "A1-qwen-normal",
      label: "A1 Qwen normal",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 12000,
          output: 900,
          apiOutputTokens: 900,
        }),
      ],
    },
    {
      id: "A1-g36-normal",
      label: "A1 G36 Flash normal",
      modelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
      provider: "openrouter",
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_GEMINI_36_FLASH_MODEL,
          input: 8000,
          output: 1200,
          apiOutputTokens: 1200,
        }),
      ],
    },
    {
      id: "A1-muse-normal",
      label: "A1 Muse normal",
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      provider: "openrouter",
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_MUSE_SPARK_11_MODEL,
          input: 5000,
          output: 1200,
          apiOutputTokens: 1200,
          apiReasoningOutputTokens: 200,
          cacheReadTokens: 300,
          cacheWriteTokens: 100,
        }),
      ],
    },
    {
      id: "A2-small-io",
      label: "A2 small input/output",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
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
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 180_000,
          output: 8000,
          apiOutputTokens: 8000,
          apiReportedInputTokens: 180_000,
        }),
      ],
      savedTextChars: 5000,
    },
    {
      id: "A4-zero-reasoning",
      label: "A4 zero reasoning",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
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
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
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
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
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
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
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
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
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
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
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
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
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
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 400,
          apiOutputTokens: 400,
          cacheReadTokens: 500,
          usageReportingEvidence: evidence({ cacheRead: "reported_valid", cacheWrite: "reported_valid" }),
        }),
        stage({
          stage: "server-under-length-recovery",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
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
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "C2-reasoning-zero",
      label: "C2 reasoning reported zero",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
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
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
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
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
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
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 400,
          apiOutputTokens: 400,
          apiReasoningOutputTokens: 0,
          usageReportingEvidence: evidence({ reasoning: "reported_valid" }),
        }),
        stage({
          stage: "server-under-length-recovery",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
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
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
          input: 9000,
          output: 620,
          apiOutputTokens: 500,
          apiReasoningOutputTokens: 120,
          usageReportingEvidence: evidence({ reasoning: "reported_valid", cacheRead: "reported_valid", cacheWrite: "reported_valid" }),
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "D1-single-stage",
      label: "D1 single physical stage",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "D2-recovery",
      label: "D2 recovery stage",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 400,
          apiOutputTokens: 400,
        }),
        stage({
          stage: "server-under-length-recovery",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9500,
          output: 3907,
          apiOutputTokens: 3907,
        }),
      ],
    },
    {
      id: "D3-continuation",
      label: "D3 continuation stage",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 200,
          apiOutputTokens: 200,
        }),
        stage({
          stage: "continuation",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9200,
          output: 4107,
          apiOutputTokens: 4107,
        }),
      ],
    },
    {
      id: "D4-fallback",
      label: "D4 refusal fallback",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      refusalFallbackDelivered: true,
      stages: [
        stage({ stage: "primary-refused", model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, input: 8000, output: 100 }),
        stage({
          stage: "fallback",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9500,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "D5-failover",
      label: "D5 failover stage",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary-failed",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 8000,
          output: 0,
          apiOutputTokens: 0,
        }),
        stage({
          stage: "failover",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "D6-multi-attempt",
      label: "D6 multiple physical attempts",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "attempt-1",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 100,
          apiOutputTokens: 100,
        }),
        stage({
          stage: "attempt-2",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9100,
          output: 200,
          apiOutputTokens: 200,
        }),
        stage({
          stage: "attempt-3",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9200,
          output: 4007,
          apiOutputTokens: 4007,
        }),
      ],
    },
    {
      id: "D7-failed-then-success",
      label: "D7 failed attempt + successful attempt",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary-error",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 0,
          apiOutputTokens: 0,
        }),
        stage({
          stage: "retry-success",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "E1-waiver",
      label: "E1 billing waived",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      billingWaived: true,
      waiverReason: "degeneration",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "E2-waiver-min-not-applied-live",
      label: "E2 waiver path live charge zero",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      billingWaived: true,
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "F1-general-normal",
      label: "F1 general route normal",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "F2-adult-normal",
      label: "F2 adult route normal",
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      provider: "openrouter",
      stages: [
        stage({
          stage: "openRouterAdult",
          model: OPENROUTER_GEMINI_31_PRO_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
          cacheReadTokens: 1000,
          cacheWriteTokens: 200,
        }),
      ],
    },
    {
      id: "F3-adult-fallback",
      label: "F3 adult fallback delivered",
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      provider: "openrouter",
      refusalFallbackDelivered: true,
      stages: [
        stage({ stage: "primary-refused", model: OPENROUTER_GEMINI_31_PRO_MODEL, input: 8000, output: 100 }),
        stage({
          stage: "fallback",
          model: OPENROUTER_GEMINI_31_PRO_MODEL,
          input: 9500,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "F4-model-handoff",
      label: "F4 requested vs delivered model handoff",
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
          input: 9000,
          output: 500,
          apiOutputTokens: 500,
        }),
      ],
      savedTextChars: 2000,
    },
    {
      id: "G1-regen-current-gen-only",
      label: "G1 regen current generation charge isolation",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "P1-platform-aux-isolation",
      label: "P1 platform aux does not change user charge",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
      ],
    },
    {
      id: "P1-platform-aux-isolation-with-aux-stage",
      label: "P1 with aux stage present in stages array",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      stages: [
        stage({
          stage: "primary",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 9000,
          output: 4307,
          apiOutputTokens: 4307,
        }),
        stage({
          stage: "status_widget_extract",
          model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          input: 50_000,
          output: 500,
          apiOutputTokens: 500,
          upstreamCostUsd: 0.05,
        }),
      ],
    },
  ];
}
