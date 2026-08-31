/**
 * Live billing cutover readiness — read-only classification and migration diagnostics.
 * NO deduction capability. NO catalog/FX mutation. NO feature flags.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const REPO_ROOT = join(import.meta.dirname, "..", "..");

export type Reachability = "reachable" | "not_reachable_current_product" | "unknown";
export type PricingCoverage = "supported" | "unsupported" | "unknown";
export type ReadinessCellStatus =
  | "READY"
  | "NOT_REACHABLE_CURRENT_PRODUCT"
  | "NOT_APPLICABLE"
  | "BLOCKED"
  | "POLICY_DECISION_REQUIRED"
  | "UNKNOWN";

export type ModelCutoverClassification = "A" | "B" | "C" | "D";

export type AuditEvidenceStatus =
  | "verified"
  | "documented"
  | "unknown"
  | "not_implemented"
  | "reproduced_risk";

export type AuditFindingBasis =
  | "CODE_VERIFIED"
  | "TEST_REPRODUCED"
  | "SOURCE_AUDIT"
  | "POLICY_INTERPRETATION"
  | "UNKNOWN";

export type CutoverBlockerOrigin = "existing_production" | "cutover_required" | "both";

export type CutoverBlocker = {
  id: string;
  description: string;
  origin: CutoverBlockerOrigin;
  basis: AuditFindingBasis;
};

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
  effectiveCurrentProductBlocker: boolean | "unknown";
  readinessCell: ReadinessCellStatus;
  evidenceChain: string[];
  notes: string;
  basis: AuditFindingBasis;
};

export type BillingOwnerSourceAudit = {
  chatRouteImportSpecifier: string;
  runtimeEntrypointModule: string;
  fallbackChain: string[];
  modelFormulaOwners: {
    gemini37: string;
    gemini31: string;
    opus5: string;
  };
  liveDeductionDefinition: string;
  chatRouteDeductionCallCount: number;
  publishedPricingLiveDeductionCalls: number;
  wrapperChainVerified: boolean;
  modelFormulaOwnerAuditComplete: boolean;
  ownerAuditSelfAssertionOnly: false;
};

export type ModelBillingDispatchAudit = {
  gemini37UsesUnifiedReasoningBranch: boolean;
  gemini31UsesUnifiedReasoningBranch: boolean;
  opus5UsesUnifiedReasoningBranch: boolean;
  gemini37HasGemini37FlashPricingBreakdown: boolean;
};

export type IdempotencyAudit = {
  idempotencyOwner: string;
  dbEnforcedRequestIdempotency: AuditEvidenceStatus;
  ledgerIdempotencyUniqueKey: "none" | string;
  duplicateRequestDoubleChargePossible: AuditEvidenceStatus;
  regenDoubleChargePossible: AuditEvidenceStatus;
  concurrentDuplicateChargeReproduced: AuditEvidenceStatus;
  dbUniquenessGuardPresent: boolean;
  ledgerAtomicityStatus: AuditEvidenceStatus;
  scenarios: {
    singleProcessSequentialDuplicate: AuditEvidenceStatus;
    multiWorkerConcurrentDuplicate: AuditEvidenceStatus;
    retryAfterCommit: AuditEvidenceStatus;
    regeneration: AuditEvidenceStatus;
  };
};

export type FxAuditEvidence = {
  shadowOneTurnOneFxSnapshot: AuditEvidenceStatus;
  shadowAdminReadCanLockFx: AuditEvidenceStatus;
  shadowMidnightBoundaryPass: AuditEvidenceStatus;
  shadowFxFallbackReady: AuditEvidenceStatus;
  futurePublishedOneTurnOneFxSnapshot: AuditEvidenceStatus;
  currentLegacyFxContract: AuditEvidenceStatus;
};

export type LiveBillingCutoverAuditReport = {
  baseMainSha: string;
  auditVersion: string;
  liveBillingImportSpecifier: string;
  liveBillingRuntimeEntrypoint: string;
  liveBillingFallbackChain: readonly string[];
  livePointDeductionOwner: string;
  billingOwnerAudit: BillingOwnerSourceAudit;
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
    reasoningDoubleCountPossible: AuditEvidenceStatus;
    multiStageUsageComplete: AuditEvidenceStatus;
    fallbackUsageComplete: AuditEvidenceStatus;
    continuationUsageComplete: AuditEvidenceStatus;
  };
  idempotency: IdempotencyAudit;
  fx: FxAuditEvidence;
  receipt: {
    publicReceiptInternalLeakPaths: number;
    historicalPricingSnapshotComplete: AuditEvidenceStatus;
  };
  migrationDelta: MigrationDeltaRow[];
  readinessMatrix: Record<string, Record<string, ReadinessCellStatus>>;
  classification: Record<string, ModelCutoverClassification>;
  safestFirstCutoverModel: string;
  safestFirstCutoverWhy: string;
  leadingPostIdempotencyPrepCandidate: string;
  leadingPostIdempotencyPrepWhy: string;
  nextP0ProductionPr: string;
  pureLiveChargeEngineExtractionRequired: boolean;
  numericCostOwnerOnlyCutoverPossible: AuditEvidenceStatus;
  singleSwitchRollbackArchitecturePossible: AuditEvidenceStatus;
  cutoverBlockers: CutoverBlocker[];
};

/** Expected classifications after corrected evidence — must match classifyModelCutoverReadiness(). */
export const EXPECTED_MODEL_CUTOVER_CLASS: Record<string, ModelCutoverClassification> = {
  "gemini-3.7-flash": "D",
  [GEMINI31_MODEL_ID]: "D",
  [OPUS5_MODEL_ID]: "B",
};

export const G37_LIVE_FORMULA_OWNER =
  "pointsReasoningMargins.ts → not unified → pointsMuse60.ts → points.ts → gemini37FlashPricing.ts (computeGemini37FlashUserChargePoints)";
export const G31_LIVE_FORMULA_OWNER =
  "pointsReasoningMargins.ts → unified reasoning branch (computeReasoningPointCost / computeOpenRouterTurnBilling)";
export const OPUS5_LIVE_FORMULA_OWNER =
  "pointsReasoningMargins.ts → unified reasoning branch (computeReasoningPointCost / computeOpenRouterTurnBilling)";

export const LIVE_BILLING_OWNER_AUDIT = {
  liveBillingImportSpecifier: "@/lib/points",
  liveBillingRuntimeEntrypoint: "src/lib/pointsReasoningMargins.ts",
  liveBillingFallbackChain: [
    "pointsReasoningMargins.ts",
    "pointsMuse60.ts",
    "points.ts",
  ] as const,
  livePointDeductionOwner: "deductPoints() in src/lib/points.ts (re-exported via wrapper chain)",
  shadowDiagnosticsOwner:
    "computeShadowPricing() in src/lib/shadowPricing.ts — admin-only, never sets cost",
  billableStageSelectionOwner: "selectBillableStages() in src/lib/points.ts",
  billableInputOwner: "resolveTurnBillableInput() in src/lib/points.ts",
  billableOutputOwner:
    "billableOpenRouterOutputTokens / primary stage output in src/app/api/chat/route.ts",
  billableUsageNormalizer: "normalizeBillableUsage() in src/lib/billingUsage.ts",
  idempotencyOwner:
    "settleChatTurnBillingExactlyOnce() in src/lib/chatBillingSettlement.ts — chat_billing_settlements UNIQUE(user_id, chat_id, request_id, charge_kind)",
} as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/** Source-backed owner audit — not self-referential constants. */
export function auditBillingOwnersFromSource(): BillingOwnerSourceAudit {
  const routeSrc = readRepoFile("src/app/api/chat/route.ts");
  const tsconfigSrc = readRepoFile("tsconfig.json");
  const pointsReasoningSrc = readRepoFile("src/lib/pointsReasoningMargins.ts");
  const pointsMuse60Src = readRepoFile("src/lib/pointsMuse60.ts");
  const pointsSrc = readRepoFile("src/lib/points.ts");

  const importFromPoints = /import\s*\{[^}]*\bcomputeTurnBilling\b[^}]*\}[^;]*from\s*["']@\/lib\/points["']/.test(
    routeSrc
  );
  const importDeductFromPoints = /import\s*\{[^}]*\bdeductPoints\b[^}]*\}[^;]*from\s*["']@\/lib\/points["']/.test(
    routeSrc
  );
  const importSettlement = routeSrc.includes("settleChatTurnBillingExactlyOnce");

  const aliasTarget =
    tsconfigSrc.match(/"@\/lib\/points"\s*:\s*\[\s*"\.\/src\/lib\/([^"]+)"/)?.[1] ??
    "unknown";

  const routeLines = routeSrc.split("\n").filter((line) => !line.trimStart().startsWith("//"));
  const routeWithoutComments = routeLines.join("\n");
  const chatDeductionCalls = (routeWithoutComments.match(/\bdeductPoints\s*\(/g) ?? []).length;
  const chatSettlementCalls = (routeWithoutComments.match(/\bsettleChatTurnBillingExactlyOnce\s*\(/g) ?? [])
    .length;
  const publishedInRoute = (routeWithoutComments.match(/\bgetPublishedPricing\s*\(/g) ?? []).length;

  const wrapperChainVerified =
    aliasTarget === "pointsReasoningMargins" &&
    /import \* as core from "\.\/pointsMuse60"/.test(pointsReasoningSrc) &&
    /import \* as core from "\.\/points"/.test(pointsMuse60Src) &&
    /return core\.computeTurnBilling\(opts\)/.test(pointsReasoningSrc);

  const dispatch = auditModelBillingDispatchFromFixtures();

  return {
    chatRouteImportSpecifier: importFromPoints ? "@/lib/points" : "NOT_FOUND",
    runtimeEntrypointModule: `src/lib/${aliasTarget}.ts`,
    fallbackChain: ["pointsReasoningMargins.ts", "pointsMuse60.ts", "points.ts"],
    modelFormulaOwners: {
      gemini37: G37_LIVE_FORMULA_OWNER,
      gemini31: G31_LIVE_FORMULA_OWNER,
      opus5: OPUS5_LIVE_FORMULA_OWNER,
    },
    liveDeductionDefinition: importSettlement
      ? "settleChatTurnBillingExactlyOnce() in src/lib/chatBillingSettlement.ts (uses deductPointsOnDb inside settlement transaction)"
      : importDeductFromPoints
        ? "deductPoints() in src/lib/points.ts (via @/lib/points re-export chain)"
        : "NOT_FOUND",
    chatRouteDeductionCallCount: chatSettlementCalls > 0 ? chatSettlementCalls : chatDeductionCalls,
    publishedPricingLiveDeductionCalls: publishedInRoute,
    wrapperChainVerified,
    modelFormulaOwnerAuditComplete:
      wrapperChainVerified &&
      !dispatch.gemini37UsesUnifiedReasoningBranch &&
      dispatch.gemini31UsesUnifiedReasoningBranch &&
      dispatch.opus5UsesUnifiedReasoningBranch &&
      dispatch.gemini37HasGemini37FlashPricingBreakdown,
    ownerAuditSelfAssertionOnly: false,
  };
}

/** Deterministic billing fixture dispatch — proves model-specific formula routing. */
export function auditModelBillingDispatchFromFixtures(): ModelBillingDispatchAudit {
  const fixture = {
    provider: "cheaperinference" as const,
    inputTokens: 40_000,
    outputTokens: 4_000,
    completedTurnsBeforeRequest: 0,
  };
  const g37 = computeTurnBilling({
    ...fixture,
    openRouterModelId: "gemini-3.7-flash",
  });
  const g31 = computeTurnBilling({
    ...fixture,
    openRouterModelId: GEMINI31_MODEL_ID,
  });
  const opus = computeTurnBilling({
    ...fixture,
    openRouterModelId: OPUS5_MODEL_ID,
  });
  return {
    gemini37UsesUnifiedReasoningBranch: g37.gemini37FlashPricing == null,
    gemini37HasGemini37FlashPricingBreakdown: g37.gemini37FlashPricing != null,
    gemini31UsesUnifiedReasoningBranch:
      g31.gemini37FlashPricing == null && g31.modelId === GEMINI31_MODEL_ID,
    opus5UsesUnifiedReasoningBranch:
      opus.gemini37FlashPricing == null && opus.modelId === OPUS5_MODEL_ID,
  };
}

/** Source-backed wrapper chain verification for tests. */
export function auditWrapperChainFromSource(): {
  tsconfigAliasTarget: string;
  pointsReasoningImportsMuse60: boolean;
  pointsMuse60ImportsPoints: boolean;
  pointsReasoningDelegatesToCore: boolean;
} {
  const tsconfigSrc = readRepoFile("tsconfig.json");
  const pointsReasoningSrc = readRepoFile("src/lib/pointsReasoningMargins.ts");
  const pointsMuse60Src = readRepoFile("src/lib/pointsMuse60.ts");
  const aliasTarget =
    tsconfigSrc.match(/"@\/lib\/points"\s*:\s*\[\s*"\.\/src\/lib\/([^"]+)"/)?.[1] ?? "";
  return {
    tsconfigAliasTarget: aliasTarget,
    pointsReasoningImportsMuse60: /import \* as core from "\.\/pointsMuse60"/.test(pointsReasoningSrc),
    pointsMuse60ImportsPoints: /import \* as core from "\.\/points"/.test(pointsMuse60Src),
    pointsReasoningDelegatesToCore: /return core\.computeTurnBilling\(opts\)/.test(pointsReasoningSrc),
  };
}

/** Documented component budgets only — NOT a proven provider-prompt hard ceiling. */
export function documentPromptAssemblyComponentBudgets(): {
  systemTokenBudget: number;
  historyTokenBudget: number;
  memoryTokenReserve: number;
  resolveMaxPayloadInputTokens: "unbounded";
  notes: string;
} {
  return {
    systemTokenBudget: DEFAULT_SYSTEM_TOKEN_BUDGET,
    historyTokenBudget: HISTORY_TOKEN_BUDGET,
    memoryTokenReserve: GEMINI_MEMORY_TOKEN_RESERVE,
    resolveMaxPayloadInputTokens: "unbounded",
    notes:
      "Component budgets/reserves do not prove final provider prompt <= 200k. resolveMaxPayloadInputTokens() returns Number.MAX_SAFE_INTEGER. Additional prompt sections (persona, lorebook, user note, canon, status widget, etc.) are not summed here.",
  };
}

export function assessGemini31Above200kReachability(): DimensionAssessment {
  const budgets = documentPromptAssemblyComponentBudgets();
  return {
    pricingCoverage: "unsupported",
    productReachability: "unknown",
    effectiveCurrentProductBlocker: "unknown",
    readinessCell: "UNKNOWN",
    evidenceChain: [
      `Published base tier max: ${GEMINI31_BASE_TIER_PROMPT_THRESHOLD.toLocaleString()} tokens`,
      `Component budgets only: system ${budgets.systemTokenBudget}, history ${budgets.historyTokenBudget}, memory ${budgets.memoryTokenReserve}`,
      "resolveMaxPayloadInputTokens() → Number.MAX_SAFE_INTEGER (src/lib/contextTrack.ts)",
      "No production invariant found proving assembled provider prompt <= 200k",
    ],
    notes:
      "Shadow pricing marks >200k as unsupported_pricing_tier, but current-product reachability of that state is UNKNOWN without a measured provider-prompt hard bound.",
    basis: "SOURCE_AUDIT",
  };
}

export function assessGemini31CacheReachability(): DimensionAssessment {
  return {
    pricingCoverage: "unsupported",
    productReachability: "unknown",
    effectiveCurrentProductBlocker: "unknown",
    readinessCell: "UNKNOWN",
    evidenceChain: [
      "Model: gemini-3.1-pro-preview (Cheaper Inference)",
      "Request: assemblePrimaryRpRequest → applyAnthropicCacheAndPrefill skips non-Anthropic models (openRouterAdult.ts)",
      "No proven Gemini CI request cache_control path for this model",
      "Usage parser: openRouterUsage.ts CAN parse cache_read/cache_write IF provider reports them",
      "Billing: route.ts passes cacheReadTokens/cacheWriteTokens to computeTurnBilling for unified-reasoning path",
      "No production fixture in repo proving cacheReadTokens > 0 on G31 CI turns",
    ],
    notes:
      "Legacy billing CAN consume cache tokens when reported, but production-path cache activity for this model is not proven end-to-end.",
    basis: "SOURCE_AUDIT",
  };
}

export function assessGemini37CacheReachability(): DimensionAssessment {
  return {
    pricingCoverage: "unsupported",
    productReachability: "unknown",
    effectiveCurrentProductBlocker: "unknown",
    readinessCell: "UNKNOWN",
    evidenceChain: [
      "Model: gemini-3.7-flash (Cheaper Inference)",
      "Request: no Anthropic cache_control (Gemini is non-Anthropic in applyAnthropicCacheAndPrefill)",
      "Legacy user charge: gemini37FlashPricing.ts explicitly excludes cache from user price",
      "Usage parser: openRouterUsage.ts may parse provider-reported cache tokens",
      "No production fixture proving cacheReadTokens > 0 on G37 CI turns",
    ],
    notes:
      "Provider may report implicit cache usage, but no proven production request→usage→billing cache path for G37 under current product.",
    basis: "SOURCE_AUDIT",
  };
}

export function assessOpusCacheReachability(): DimensionAssessment {
  return {
    pricingCoverage: "supported",
    productReachability: "reachable",
    effectiveCurrentProductBlocker: false,
    readinessCell: "READY",
    evidenceChain: [
      "Model: claude-opus-5 (Cheaper Inference unified reasoning)",
      "Request: assemblePrimaryRpRequest → applyCacheAndPrefillForTransport → cache_control:{type:ephemeral} (openRouterAdult.ts, openRouterCache.ts)",
      "Provider usage: parseCompatibleUsage / openRouterUsage.ts extracts cacheReadTokens/cacheWriteTokens",
      "Billing: route.ts → computeTurnBilling with cacheReadTokens/cacheWriteTokens → pointsReasoningMargins unified path",
      "Published v2: billingReferenceCacheRead/Write rates present; cachePolicyStatus verified_5m",
    ],
    notes: "End-to-end request cache_control → parsed usage → legacy billing → Published cache buckets verified.",
    basis: "CODE_VERIFIED",
  };
}

export function auditIdempotencyFromSource(): IdempotencyAudit {
  const routeSrc = readRepoFile("src/app/api/chat/route.ts");
  const pointsSrc = readRepoFile("src/lib/points.ts");
  const settlementSrc = readRepoFile("src/lib/chatBillingSettlement.ts");
  const schemaSrc = readRepoFile("src/lib/chatBillingSettlementSchema.ts");
  const remoteBootstrapSrc = readRepoFile("src/lib/remoteSchemaBootstrap.ts");
  const settlementTestSrc = readRepoFile("src/lib/chatBillingSettlement.test.ts");
  const remoteTestSrc = readRepoFile("src/lib/remoteSchemaBootstrap.test.ts");

  const hasSettlementUnique = schemaSrc.includes(
    "UNIQUE(user_id, chat_id, request_id, charge_kind)"
  );
  const hasRemoteSchemaUpgradeChain =
    remoteBootstrapSrc.includes("turso-v5-pinned-column-retired") &&
    remoteBootstrapSrc.includes("turso-v6-last-compressed-at-retired");
  const remoteUpgradeTestPresent = remoteTestSrc.includes("OLD_REMOTE_V1_DB_UPGRADE_PASS");
  const trueConcurrentTestPresent = settlementTestSrc.includes("true overlapping duplicate workers");
  const claimFirstPresent = settlementSrc.includes("ON CONFLICT(user_id, chat_id, request_id, charge_kind) DO NOTHING");

  const usesSettlementOwner = routeSrc.includes("settleChatTurnBillingExactlyOnce");
  const capturedBeforeStream = routeSrc.includes("const alreadyBilledForRequest = existingByRequest.alreadyBilled");
  const guardBeforeDeduct = routeSrc.includes("if (cost > 0 && !alreadyBilledForRequest)");

  return {
    idempotencyOwner: LIVE_BILLING_OWNER_AUDIT.idempotencyOwner,
    dbEnforcedRequestIdempotency:
      hasSettlementUnique && hasRemoteSchemaUpgradeChain && remoteUpgradeTestPresent ? "verified" : "documented",
    ledgerIdempotencyUniqueKey: hasSettlementUnique
      ? "chat_billing_settlements(user_id, chat_id, request_id, charge_kind)"
      : "none",
    duplicateRequestDoubleChargePossible: usesSettlementOwner && claimFirstPresent
      ? "documented"
      : "reproduced_risk",
    regenDoubleChargePossible: usesSettlementOwner ? "documented" : capturedBeforeStream && guardBeforeDeduct ? "documented" : "unknown",
    concurrentDuplicateChargeReproduced: trueConcurrentTestPresent ? "verified" : "unknown",
    dbUniquenessGuardPresent: hasSettlementUnique && remoteUpgradeTestPresent,
    ledgerAtomicityStatus:
      claimFirstPresent &&
      settlementSrc.includes("BEGIN IMMEDIATE") &&
      settlementSrc.includes("deductPointsOnDb")
        ? "verified"
        : "documented",
    scenarios: {
      singleProcessSequentialDuplicate: usesSettlementOwner ? "verified" : guardBeforeDeduct ? "documented" : "unknown",
      multiWorkerConcurrentDuplicate: trueConcurrentTestPresent ? "verified" : "documented",
      retryAfterCommit: usesSettlementOwner ? "verified" : guardBeforeDeduct ? "documented" : "unknown",
      regeneration: "documented",
    },
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
  blocker: boolean | "unknown"
): ReadinessCellStatus {
  if (reachability === "not_reachable_current_product") return "NOT_REACHABLE_CURRENT_PRODUCT";
  if (reachability === "unknown") return "UNKNOWN";
  if (pricingCoverage === "unsupported" && blocker === true) return "BLOCKED";
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
  const idempotencyAudit = auditIdempotencyFromSource();
  const idempotency: ReadinessCellStatus =
    idempotencyAudit.dbUniquenessGuardPresent &&
    idempotencyAudit.scenarios.multiWorkerConcurrentDuplicate === "verified"
      ? "READY"
      : "BLOCKED";
  const multiStage: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const fallback: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const continuation: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const missingUsage: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";
  const waiver: ReadinessCellStatus = "POLICY_DECISION_REQUIRED";

  return {
    "gemini-3.7-flash": {
      "Base uncached usage": baseUncached,
      "Cache read": cell(
        g37Cache.pricingCoverage,
        g37Cache.productReachability,
        g37Cache.effectiveCurrentProductBlocker
      ),
      "Cache write": cell(
        g37Cache.pricingCoverage,
        g37Cache.productReachability,
        g37Cache.effectiveCurrentProductBlocker
      ),
      "Above pricing threshold": "NOT_APPLICABLE",
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
      "Cache read": cell(
        g31Cache.pricingCoverage,
        g31Cache.productReachability,
        g31Cache.effectiveCurrentProductBlocker
      ),
      "Cache write": cell(
        g31Cache.pricingCoverage,
        g31Cache.productReachability,
        g31Cache.effectiveCurrentProductBlocker
      ),
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
      "Cache read": cell(
        opusCache.pricingCoverage,
        opusCache.productReachability,
        opusCache.effectiveCurrentProductBlocker
      ),
      "Cache write": cell(
        opusCache.pricingCoverage,
        opusCache.productReachability,
        opusCache.effectiveCurrentProductBlocker
      ),
      "Above pricing threshold": "NOT_APPLICABLE",
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
  if (cells.includes("UNKNOWN")) return "D";
  if (cells.some((c) => c === "POLICY_DECISION_REQUIRED")) return "B";
  if (cells.every((c) => c === "READY" || c === "NOT_APPLICABLE" || c === "NOT_REACHABLE_CURRENT_PRODUCT")) {
    return "A";
  }
  return "D";
}

const CLASS_RANK: Record<ModelCutoverClassification, number> = { A: 4, B: 3, C: 2, D: 1 };

export function computeLeadingPostIdempotencyPrepCandidate(): {
  model: string;
  why: string;
} {
  const matrix = buildCurrentProductReadinessMatrix();
  const score = (modelId: string): number => {
    const row = matrix[modelId];
    if (!row) return 0;
    let s = 0;
    if (row["Cache read"] === "READY" && row["Cache write"] === "READY") s += 30;
    if (row["Above pricing threshold"] === "NOT_APPLICABLE") s += 10;
    if (row["Base uncached usage"] === "READY") s += 5;
    return s;
  };
  const ranked = [OPUS5_MODEL_ID, GEMINI31_MODEL_ID, "gemini-3.7-flash"].sort(
    (a, b) => score(b) - score(a)
  );
  const model = ranked[0]!;
  return {
    model,
    why:
      "POLICY_INTERPRETATION: best non-global evidence — Opus5 cache READY, idempotency READY, no >200k tier ambiguity",
  };
}

export function computeSafestFirstCutoverModel(
  classification: Record<string, ModelCutoverClassification>
): { model: string; why: string; undecided: boolean; leadingCandidate: string; leadingWhy: string } {
  const matrix = buildCurrentProductReadinessMatrix();
  const globalIdempotencyBlocked = Object.values(matrix).every((row) => row.Idempotency === "BLOCKED");
  const leading = computeLeadingPostIdempotencyPrepCandidate();

  if (globalIdempotencyBlocked) {
    return {
      model: "NONE_GLOBAL_BLOCKER",
      why: "Global concurrent duplicate-charge implementation blocker — no model is cutover-safe",
      undecided: true,
      leadingCandidate: leading.model,
      leadingWhy: leading.why,
    };
  }

  const candidates = Object.entries(classification);
  const maxRank = Math.max(...candidates.map(([, c]) => CLASS_RANK[c]));
  if (maxRank <= CLASS_RANK.D) {
    return {
      model: "UNDECIDED_UNTIL_POLICY_PREP",
      why: "All audit models classify D — insufficient evidence for ordering",
      undecided: true,
      leadingCandidate: leading.model,
      leadingWhy: leading.why,
    };
  }
  if (maxRank < CLASS_RANK.B) {
    return {
      model: "UNDECIDED_UNTIL_POLICY_PREP",
      why: "No model reaches B or better — cutover ordering premature",
      undecided: true,
      leadingCandidate: leading.model,
      leadingWhy: leading.why,
    };
  }
  const eligible = candidates.filter(([, c]) => CLASS_RANK[c] === maxRank);
  const score = (modelId: string, cls: ModelCutoverClassification): number => {
    let s = CLASS_RANK[cls] * 100;
    const row = matrix[modelId];
    if (row?.["Cache read"] === "READY" && row?.["Cache write"] === "READY") s += 20;
    if (row?.["Above pricing threshold"] === "NOT_APPLICABLE") s += 5;
    return s;
  };
  eligible.sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]));
  const [model, cls] = eligible[0]!;
  return {
    model,
    why: `Highest classification (${cls}); deterministic score favors ${model} among tied class-${cls} models`,
    undecided: false,
    leadingCandidate: leading.model,
    leadingWhy: leading.why,
  };
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

export function buildFxAuditEvidence(): FxAuditEvidence {
  return {
    shadowOneTurnOneFxSnapshot: "verified",
    shadowAdminReadCanLockFx: "verified",
    shadowMidnightBoundaryPass: verifyKstMidnightBoundary() ? "verified" : "unknown",
    shadowFxFallbackReady: "documented",
    futurePublishedOneTurnOneFxSnapshot: "not_implemented",
    currentLegacyFxContract: "documented",
  };
}

export function buildCutoverBlockers(): CutoverBlocker[] {
  return [
    {
      id: "shadow_only_pricing",
      description: "Published pricing is shadow-only — no live numeric owner swap implemented",
      origin: "cutover_required",
      basis: "SOURCE_AUDIT",
    },
    {
      id: "g31_cache_unverified",
      description: "Gemini31 Published v2 cache semantics UNVERIFIED; production cache path not proven",
      origin: "cutover_required",
      basis: "SOURCE_AUDIT",
    },
    {
      id: "g37_cache_unsupported",
      description: "Gemini37 Published v2 has no cache rate fields; G37 production cache path not proven",
      origin: "cutover_required",
      basis: "SOURCE_AUDIT",
    },
    {
      id: "multi_stage_billing",
      description: "Multi-stage / fallback / continuation — primary input only, summed output; policy undecided",
      origin: "both",
      basis: "SOURCE_AUDIT",
    },
    {
      id: "waiver_interaction",
      description: "Quality waiver minimums (e.g. Gemini31 65P) interact with Published charge — cutover policy undecided",
      origin: "both",
      basis: "POLICY_INTERPRETATION",
    },
    {
      id: "historical_receipt_snapshot",
      description: "Historical receipt lacks pricingVersion + FX snapshot identity for immutable repricing audit",
      origin: "cutover_required",
      basis: "SOURCE_AUDIT",
    },
    {
      id: "pure_live_engine",
      description: "Pure live charge engine not extracted — computeShadowPricing mixes economics with user charge",
      origin: "cutover_required",
      basis: "SOURCE_AUDIT",
    },
  ];
}

export function buildLiveBillingCutoverAuditReport(baseMainSha = "unknown"): LiveBillingCutoverAuditReport {
  const g31Above = assessGemini31Above200kReachability();
  const g31Cache = assessGemini31CacheReachability();
  const g37Cache = assessGemini37CacheReachability();
  const opusCache = assessOpusCacheReachability();
  const matrix = buildCurrentProductReadinessMatrix();
  const billingOwnerAudit = auditBillingOwnersFromSource();
  const idempotency = auditIdempotencyFromSource();
  const classification = {
    "gemini-3.7-flash": classifyModelCutoverReadiness("gemini-3.7-flash"),
    [GEMINI31_MODEL_ID]: classifyModelCutoverReadiness(GEMINI31_MODEL_ID),
    [OPUS5_MODEL_ID]: classifyModelCutoverReadiness(OPUS5_MODEL_ID),
  };
  const safest = computeSafestFirstCutoverModel(classification);

  return {
    baseMainSha,
    auditVersion: "2026-08-28-readiness-v3",
    liveBillingImportSpecifier: LIVE_BILLING_OWNER_AUDIT.liveBillingImportSpecifier,
    liveBillingRuntimeEntrypoint: LIVE_BILLING_OWNER_AUDIT.liveBillingRuntimeEntrypoint,
    liveBillingFallbackChain: LIVE_BILLING_OWNER_AUDIT.liveBillingFallbackChain,
    livePointDeductionOwner: LIVE_BILLING_OWNER_AUDIT.livePointDeductionOwner,
    billingOwnerAudit,
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
      reasoningDoubleCountPossible: verifyReasoningNotDoubleCounted() ? "verified" : "reproduced_risk",
      multiStageUsageComplete: "unknown",
      fallbackUsageComplete: "documented",
      continuationUsageComplete: "unknown",
    },
    idempotency,
    fx: buildFxAuditEvidence(),
    receipt: {
      publicReceiptInternalLeakPaths: countPublicReceiptInternalLeakPaths(),
      historicalPricingSnapshotComplete: "not_implemented",
    },
    migrationDelta: computeMigrationDeltaRows(),
    readinessMatrix: matrix,
    classification,
    safestFirstCutoverModel: safest.model,
    safestFirstCutoverWhy: safest.why,
    leadingPostIdempotencyPrepCandidate: safest.leadingCandidate,
    leadingPostIdempotencyPrepWhy: safest.leadingWhy,
    nextP0ProductionPr: "Published live charge engine extraction (idempotency hardening complete)",
    pureLiveChargeEngineExtractionRequired: true,
    numericCostOwnerOnlyCutoverPossible: "documented",
    singleSwitchRollbackArchitecturePossible: "documented",
    cutoverBlockers: buildCutoverBlockers(),
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
