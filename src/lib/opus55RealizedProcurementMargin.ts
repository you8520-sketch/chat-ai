/**
 * Opus 5.5 pre-live commercial candidates — REALIZED NO-CACHE PROCUREMENT GROSS MARGIN.
 * Does not alter published PRODUCT targetMargin semantics (Anthropic list reference).
 */

import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL } from "@/lib/chatModels";
import type { CheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import {
  OPUS55_CI_CATALOG_EVIDENCE,
  OPUS55_MARKET_BENCHMARKS,
  OPUS55_REALIZED_PROCUREMENT_MARGIN_CANDIDATES,
} from "@/lib/opus55PricingEvidence";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import {
  ceilPublishedChargePoints,
  roundKrwTenths,
} from "@/lib/publishedChargeRounding";

export type Opus55RealizedProcurementMarginCandidateRow = {
  candidateLabel: "AGGRESSIVE" | "BALANCED" | "SAFE";
  targetRealizedGrossMargin: number;
  promptTokens: number;
  outputTokens: number;
  ciNoCacheProcurementKrw: number;
  requiredUserChargeKrwRaw: number;
  finalUserChargeKrw: number;
  finalPoints: number;
  actualRealizedGrossMargin: number;
  deltaVsElin7296Krw: number | null;
  deltaVsTpotHypothetical7368P: number | null;
};

function opus55CiProcurementCatalog(): CheaperInferenceCatalogPricing {
  const f = OPUS55_CI_CATALOG_EVIDENCE.fields;
  return {
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    inputUsdPerMillion: f.input_per_million,
    outputUsdPerMillion: f.output_per_million,
    cacheReadUsdPerMillion: f.cache_read_input_per_million,
    cacheWriteUsdPerMillion: f.cache_write_input_per_million,
    referenceInputUsdPerMillion: f.list_input_per_million,
    referenceOutputUsdPerMillion: f.list_output_per_million,
    discountPercent: f.discount_percent,
    fetchedAt: Date.now(),
  };
}

export function resolveOpus55CiNoCacheProcurementKrw(params: {
  promptTokens: number;
  outputTokens: number;
  fxSnapshot: BillingFxSnapshot;
}): number | null {
  const catalog = opus55CiProcurementCatalog();
  const resolved = resolveProcurementCostFromCatalog({
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    promptTokens: params.promptTokens,
    outputTokens: params.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
    catalog,
  });
  return resolved?.procurementCostKrw ?? null;
}

export function computeOpus55RealizedProcurementMarginCandidate(params: {
  promptTokens: number;
  outputTokens: number;
  targetRealizedGrossMargin: number;
  fxSnapshot: BillingFxSnapshot;
}): Opus55RealizedProcurementMarginCandidateRow | null {
  const margin = params.targetRealizedGrossMargin;
  if (!Number.isFinite(margin) || margin < 0 || margin >= 1) return null;
  const ciNoCacheProcurementKrw = resolveOpus55CiNoCacheProcurementKrw({
    promptTokens: params.promptTokens,
    outputTokens: params.outputTokens,
    fxSnapshot: params.fxSnapshot,
  });
  if (ciNoCacheProcurementKrw == null || ciNoCacheProcurementKrw <= 0) return null;

  const requiredUserChargeKrwRaw = ciNoCacheProcurementKrw / (1 - margin);
  const finalUserChargeKrw = roundKrwTenths(requiredUserChargeKrwRaw);
  const finalPoints = ceilPublishedChargePoints(finalUserChargeKrw);
  const actualRealizedGrossMargin =
    finalUserChargeKrw > 0
      ? (finalUserChargeKrw - ciNoCacheProcurementKrw) / finalUserChargeKrw
      : NaN;

  const elin = OPUS55_MARKET_BENCHMARKS.find((b) => b.id === "elin_opus55_a");
  const tpotHypo = OPUS55_MARKET_BENCHMARKS.find((b) => b.id === "tpot_opus55_hypothetical");

  const candidateMeta = OPUS55_REALIZED_PROCUREMENT_MARGIN_CANDIDATES.find(
    (c) => c.targetRealizedGrossMargin === margin
  );

  return {
    candidateLabel: candidateMeta?.label ?? "BALANCED",
    targetRealizedGrossMargin: margin,
    promptTokens: params.promptTokens,
    outputTokens: params.outputTokens,
    ciNoCacheProcurementKrw,
    requiredUserChargeKrwRaw,
    finalUserChargeKrw,
    finalPoints,
    actualRealizedGrossMargin,
    deltaVsElin7296Krw:
      elin?.observedUserCostKrw != null ? finalUserChargeKrw - elin.observedUserCostKrw : null,
    deltaVsTpotHypothetical7368P:
      tpotHypo?.observedUserPoints != null ? finalPoints - tpotHypo.observedUserPoints : null,
  };
}

export function buildOpus55RealizedProcurementMarginMatrix(params: {
  fxSnapshot: BillingFxSnapshot;
  workloads: ReadonlyArray<{
    key: "elin" | "tpot";
    promptTokens: number;
    outputTokens: number;
  }>;
}): Opus55RealizedProcurementMarginCandidateRow[] {
  const rows: Opus55RealizedProcurementMarginCandidateRow[] = [];
  for (const workload of params.workloads) {
    for (const candidate of OPUS55_REALIZED_PROCUREMENT_MARGIN_CANDIDATES) {
      const row = computeOpus55RealizedProcurementMarginCandidate({
        promptTokens: workload.promptTokens,
        outputTokens: workload.outputTokens,
        targetRealizedGrossMargin: candidate.targetRealizedGrossMargin,
        fxSnapshot: params.fxSnapshot,
      });
      if (row) rows.push(row);
    }
  }
  return rows;
}
