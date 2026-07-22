import type { CanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { selectActiveCanonChunks } from "@/lib/canonPlan/activeSelector";
import { canonCoreInflationMetrics } from "@/lib/canonPlan/compiler";
import { renderCoreCanonBlock, renderCanonChunksBlock } from "@/lib/canonPlan/coreRenderer";
import type { LazyCompileResult } from "@/lib/canonPlan/lazyCompile";
import {
  buildCanonSourceBreakdown,
  estimateTokensFromChars,
} from "@/lib/canonPlan/observability";
import type { CanonPlanV1 } from "@/lib/canonPlan/types";
import {
  archiveWholeBlobWouldInject,
  selectArchiveChunksSelective,
} from "@/lib/memory/archiveSelective";
import { CANON_PLAN_VERSION } from "@/lib/canonPlan/types";

export type CanonShadowMetricKind = "SHADOW_PLANNED" | "ACTUAL_PROVIDER";

export type ActiveSelectionDebugEntry = {
  chunkId: string;
  reason: "keyword_relevance";
};

export type CanonShadowTurnRecord = {
  metricKind: "SHADOW_PLANNED";
  modelId: string;
  characterId: number;
  policyMode: string;
  archivePolicyMode: string;
  rolloutStage: string;
  shadowOnly: boolean;
  forceFullLegacy: boolean;
  canonPlanVersion: number | null;
  sourceHash: string;
  sourceHashStatus: string;
  compileSource: string;
  technicalFallbackEligible: boolean;
  technicalFallbackReason: string | null;
  fullLegacyCanonChars: number;
  fullLegacyCanonTokens: number;
  coreChars: number;
  coreChunks: number;
  coreRatio: number;
  coreTokens: number;
  activeChars: number;
  activeChunks: number;
  activeTokens: number;
  selectedActiveIds: string[];
  activeSelectionReasons: ActiveSelectionDebugEntry[];
  archiveCandidateChars: number;
  archiveCandidateParagraphCount: number;
  archiveSelectedChars: number;
  archiveSelectedParagraphCount: number;
  archiveLegacyWouldInjectWholeBlob: boolean;
  compileError: string | null;
};

export function shouldRunCanonInjectionSideEffects(
  policy: CanonInjectionPolicy
): boolean {
  return policy.injectionEnabled;
}

export function computeCanonShadowTurnRecord(opts: {
  policy: CanonInjectionPolicy;
  characterId: number;
  charName: string;
  plan: CanonPlanV1 | null;
  lazyResult: LazyCompileResult;
  fullLegacyCanonChars: number;
  userMessage: string;
  archiveText: string;
}): CanonShadowTurnRecord {
  const { policy, plan, lazyResult } = opts;
  const fullLegacyCanonChars = Math.max(0, opts.fullLegacyCanonChars);

  let coreChars = 0;
  let coreChunks = 0;
  let coreRatio = 0;
  let activeChars = 0;
  let activeChunks = 0;
  let selectedActiveIds: string[] = [];
  let activeSelectionReasons: ActiveSelectionDebugEntry[] = [];

  if (plan) {
    const metrics = canonCoreInflationMetrics(plan);
    coreChars = renderCoreCanonBlock(plan, { charName: opts.charName }).length;
    coreChunks = metrics.coreChunks;
    coreRatio = metrics.coreRatio;

    const active = selectActiveCanonChunks({
      plan,
      userMessage: opts.userMessage,
    });
    activeChars = active.activeChunks.length
      ? renderCanonChunksBlock(active.activeChunks, { charName: opts.charName }).length
      : 0;
    activeChunks = active.activeChunks.length;
    selectedActiveIds = active.activeChunks.map((c) => c.id).slice(0, 32);
    activeSelectionReasons = active.activeChunks.slice(0, 32).map((c) => ({
      chunkId: c.id,
      reason: "keyword_relevance" as const,
    }));
  }

  const archiveBudget = plan?.retrieval.archiveBudgetChars ?? 4000;
  const archiveSelective = selectArchiveChunksSelective({
    archive: opts.archiveText,
    userMessage: opts.userMessage,
    budgetChars: archiveBudget,
  });

  const sourceBreakdown = buildCanonSourceBreakdown({
    fullLegacyCanonChars,
    coreCanonChars: coreChars,
    activeCanonChars: activeChars,
    archiveCandidateChars: archiveSelective.candidateChars,
    archiveInjectedChars: archiveSelective.selectedChars,
  });

  const technicalFallbackReason =
    lazyResult.technicalFallbackEligible
      ? lazyResult.error ?? "no_valid_canon_plan"
      : null;

  return {
    metricKind: "SHADOW_PLANNED",
    modelId: policy.modelId,
    characterId: opts.characterId,
    policyMode: policy.canonMode,
    archivePolicyMode: policy.archiveMode,
    rolloutStage: policy.rolloutStage,
    shadowOnly: policy.shadowOnly,
    forceFullLegacy: policy.forceFullLegacy,
    canonPlanVersion: plan?.version ?? null,
    sourceHash: lazyResult.sourceHash,
    sourceHashStatus: lazyResult.sourceHashStatus,
    compileSource: lazyResult.compileSource,
    technicalFallbackEligible: lazyResult.technicalFallbackEligible,
    technicalFallbackReason,
    fullLegacyCanonChars,
    fullLegacyCanonTokens: sourceBreakdown.fullLegacyCanonTokens,
    coreChars,
    coreChunks,
    coreRatio,
    coreTokens: sourceBreakdown.coreCanonTokens,
    activeChars,
    activeChunks,
    activeTokens: sourceBreakdown.activeCanonTokens,
    selectedActiveIds,
    activeSelectionReasons,
    archiveCandidateChars: archiveSelective.candidateChars,
    archiveCandidateParagraphCount: archiveSelective.candidateCount,
    archiveSelectedChars: archiveSelective.selectedChars,
    archiveSelectedParagraphCount: archiveSelective.selectedChunks.length,
    archiveLegacyWouldInjectWholeBlob: archiveWholeBlobWouldInject(
      opts.archiveText,
      opts.userMessage
    ),
    compileError: lazyResult.error ?? null,
  };
}

export function logCanonShadowTurnRecord(record: CanonShadowTurnRecord): void {
  if (record.technicalFallbackEligible) {
    console.warn("[canon-shadow-d0] technical fallback eligible", {
      characterId: record.characterId,
      modelId: record.modelId,
      compileSource: record.compileSource,
      reason: record.technicalFallbackReason,
    });
  }
  console.info("[canon-shadow-d0]", {
    metricKind: record.metricKind,
    characterId: record.characterId,
    modelId: record.modelId,
    policyMode: record.policyMode,
    archivePolicyMode: record.archivePolicyMode,
    rolloutStage: record.rolloutStage,
    shadowOnly: record.shadowOnly,
    canonPlanVersion: record.canonPlanVersion ?? CANON_PLAN_VERSION,
    sourceHashStatus: record.sourceHashStatus,
    compileSource: record.compileSource,
    fullLegacyCanonChars: record.fullLegacyCanonChars,
    coreChars: record.coreChars,
    coreChunks: record.coreChunks,
    coreRatio: Number(record.coreRatio.toFixed(4)),
    activeChars: record.activeChars,
    activeChunks: record.activeChunks,
    selectedActiveIds: record.selectedActiveIds,
    archiveCandidateChars: record.archiveCandidateChars,
    archiveSelectedChars: record.archiveSelectedChars,
    archiveLegacyWouldInjectWholeBlob: record.archiveLegacyWouldInjectWholeBlob,
    technicalFallbackEligible: record.technicalFallbackEligible,
  });
}

export function attachActualProviderCacheMetrics(input: {
  shadowRecord: CanonShadowTurnRecord;
  totalInputTokens: number;
  cachedInputTokens: number;
  estimatedInputCostKrw: number;
  totalModelCostKrw: number;
  cacheDiscountKrw?: number;
}): {
  shadowPlanned: CanonShadowTurnRecord;
  actualProvider: {
    metricKind: "ACTUAL_PROVIDER";
    totalInputTokens: number;
    cachedInputTokens: number;
    uncachedInputTokens: number;
    cacheHitRatio: number;
    cacheDiscountKrw: number;
    estimatedInputCostKrw: number;
    totalModelCostKrw: number;
    estimatedInputTokensFromChars: number;
  };
} {
  const totalInputTokens = Math.max(0, input.totalInputTokens);
  const cachedInputTokens = Math.min(Math.max(0, input.cachedInputTokens), totalInputTokens);
  const uncachedInputTokens = totalInputTokens - cachedInputTokens;
  return {
    shadowPlanned: input.shadowRecord,
    actualProvider: {
      metricKind: "ACTUAL_PROVIDER",
      totalInputTokens,
      cachedInputTokens,
      uncachedInputTokens,
      cacheHitRatio: totalInputTokens > 0 ? cachedInputTokens / totalInputTokens : 0,
      cacheDiscountKrw: input.cacheDiscountKrw ?? 0,
      estimatedInputCostKrw: input.estimatedInputCostKrw,
      totalModelCostKrw: input.totalModelCostKrw,
      estimatedInputTokensFromChars: estimateTokensFromChars(
        input.shadowRecord.fullLegacyCanonChars
      ),
    },
  };
}
