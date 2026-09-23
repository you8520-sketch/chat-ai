/**
 * Claude Opus 5.5 — pre-live diagnostic owner (NOT live published catalog).
 * PRODUCT: Anthropic list reference + explicit targetMargin parameter.
 * PROCUREMENT: CI /v1/models effective rates (discount metadata only).
 * Live rollout must converge on publishedModelPricing + publishedUserCharge — see module footer.
 */

import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL } from "@/lib/chatModels";
import type { CheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import {
  OPUS55_CI_CATALOG_EVIDENCE,
  OPUS55_COMMERCIAL_WORKLOADS,
  OPUS55_MARKET_BENCHMARKS,
  OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES,
  type Opus55MarketBenchmark,
} from "@/lib/opus55PricingEvidence";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import {
  computePublishedUserChargeFromResolvedPolicy,
  type PublishedUserChargeResult,
} from "@/lib/publishedUserCharge";
import { KOREAN_CHARS_PER_OUTPUT_TOKEN } from "@/lib/responseLengthConstants";

export { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL } from "@/lib/chatModels";
export {
  OPUS55_ANTHROPIC_OFFICIAL_REFERENCE,
  OPUS55_CACHE_PATH_AUDIT,
  OPUS55_CI_CATALOG_EVIDENCE,
  OPUS55_COMMERCIAL_WORKLOADS,
  OPUS55_MARKET_BENCHMARKS,
  OPUS55_PRODUCT_TARGET_MARGIN_SEMANTICS,
  OPUS55_REALIZED_PROCUREMENT_MARGIN_SEMANTICS,
  OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES,
  OPUS55_RUNTIME_CONTRACT_PROBE,
} from "@/lib/opus55PricingEvidence";
export {
  buildOpus55RealizedProcurementMarginMatrix,
  computeOpus55RealizedProcurementMarginCandidate,
  resolveOpus55CiNoCacheProcurementKrw,
  type Opus55RealizedProcurementMarginCandidateRow,
} from "@/lib/opus55RealizedProcurementMargin";
import {
  buildOpus55RealizedProcurementMarginMatrix,
  computeOpus55RealizedProcurementMarginCandidate,
  type Opus55RealizedProcurementMarginCandidateRow,
} from "@/lib/opus55RealizedProcurementMargin";

/** @deprecated use OPUS55_CI_CATALOG_EVIDENCE.fields */
export const OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION =
  OPUS55_CI_CATALOG_EVIDENCE.fields.list_input_per_million;
export const OPUS55_OFFICIAL_LIST_OUTPUT_USD_PER_MILLION =
  OPUS55_CI_CATALOG_EVIDENCE.fields.list_output_per_million;
export const OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION =
  OPUS55_CI_CATALOG_EVIDENCE.fields.input_per_million;
export const OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION =
  OPUS55_CI_CATALOG_EVIDENCE.fields.output_per_million;
export const OPUS55_CI_PROCUREMENT_DISCOUNT_PERCENT =
  OPUS55_CI_CATALOG_EVIDENCE.fields.discount_percent;

export const OPUS55_PREP_INPUT_TOKEN_WORKLOADS = [15_000, 25_000, 35_000, 45_000, 75_000] as const;
export const OPUS55_PREP_OUTPUT_CHAR_PRESETS = [1500, 2500, 3500, 4360, 5000] as const;

export type Opus55PrepOutputPreset = {
  chars: number;
  equivalentOutputTokens: number;
};

export function listOpus55PrepOutputPresets(): Opus55PrepOutputPreset[] {
  return OPUS55_PREP_OUTPUT_CHAR_PRESETS.map((chars) => ({
    chars,
    equivalentOutputTokens: Math.round(chars / KOREAN_CHARS_PER_OUTPUT_TOKEN),
  }));
}

/** Prep published policy — no cache reference rates on PRODUCT (user P uses total prompt tokens only). */
export function buildOpus55PrepPublishedPricing(targetMargin: number): PublishedModelPricing {
  return {
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    billingReferenceInputUsdPerMillion: OPUS55_CI_CATALOG_EVIDENCE.fields.list_input_per_million,
    billingReferenceOutputUsdPerMillion: OPUS55_CI_CATALOG_EVIDENCE.fields.list_output_per_million,
    targetMargin,
    minimumMarginFloor: 0.05,
    pricingVersion: 1,
    publishedAt: "2026-09-23T00:00:00.000Z",
  };
}

/** CI catalog-derived procurement — exact cache_read/cache_write fields from GET /v1/models (runtime hit UNVERIFIED). */
export function buildOpus55PrepProcurementCatalog(
  overrides?: Partial<CheaperInferenceCatalogPricing>
): CheaperInferenceCatalogPricing {
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
    ...overrides,
  };
}

function resolvePrepPublishedPricing(targetMargin: number): {
  requestedModelId: string;
  canonicalModelId: string;
  pricing: PublishedModelPricing;
} {
  return {
    requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    canonicalModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    pricing: buildOpus55PrepPublishedPricing(targetMargin),
  };
}

/**
 * Canonical pre-live USER PRODUCT charge — billable totals only.
 * Ignores cache buckets, upstreamCostUsd, provider attempts (not passed to published engine).
 */
export function computeOpus55PrepProductCharge(params: {
  promptTokens: number;
  outputTokens: number;
  targetMargin: number;
  fxSnapshot: BillingFxSnapshot;
}): PublishedUserChargeResult {
  const usage = normalizeBillableUsage({
    modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    promptTokens: params.promptTokens,
    outputTokens: params.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return computePublishedUserChargeFromResolvedPolicy({
    requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    resolvedPricing: resolvePrepPublishedPricing(params.targetMargin),
    usage,
    usageCoverage: "complete",
    fxSnapshot: params.fxSnapshot,
    adjustment: { kind: "none" },
  });
}

/** Determinism regression helper — simulates noisy provider fields without affecting USER P. */
export function computeOpus55InvariantUserProductCharge(params: {
  promptTokens: number;
  billableOutputTokens: number;
  targetMargin: number;
  fxSnapshot: BillingFxSnapshot;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  upstreamCostUsd?: number;
  providerAttemptCount?: number;
}): PublishedUserChargeResult {
  void params.cacheReadTokens;
  void params.cacheWriteTokens;
  void params.upstreamCostUsd;
  void params.providerAttemptCount;
  return computeOpus55PrepProductCharge({
    promptTokens: params.promptTokens,
    outputTokens: params.billableOutputTokens,
    targetMargin: params.targetMargin,
    fxSnapshot: params.fxSnapshot,
  });
}

export type Opus55PriceMatrixCell = {
  promptTokens: number;
  outputTokens: number;
  outputChars: number | null;
  userChargePoints: number | null;
  userChargeKrw: number | null;
  anthropicListCostKrw: number | null;
  procurementCostKrwNoCache: number | null;
  grossMarginPercentNoCache: number | null;
  userChargeInvariantNote: string;
};

function grossMarginPercent(chargeKrw: number, procurementKrw: number): number | null {
  if (!Number.isFinite(chargeKrw) || chargeKrw <= 0) return null;
  return ((chargeKrw - procurementKrw) / chargeKrw) * 100;
}

export function buildOpus55PriceMatrix(params: {
  targetMargin: number;
  fxSnapshot: BillingFxSnapshot;
  catalog?: CheaperInferenceCatalogPricing;
}): Opus55PriceMatrixCell[] {
  const catalog = params.catalog ?? buildOpus55PrepProcurementCatalog();
  const cells: Opus55PriceMatrixCell[] = [];
  const outputPresets = listOpus55PrepOutputPresets();

  for (const promptTokens of OPUS55_PREP_INPUT_TOKEN_WORKLOADS) {
    for (const preset of outputPresets) {
      const charge = computeOpus55PrepProductCharge({
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        targetMargin: params.targetMargin,
        fxSnapshot: params.fxSnapshot,
      });
      const userChargeKrw =
        charge.status === "complete" ? charge.snapshot.finalUserChargeKrw : null;
      const userChargePoints =
        charge.status === "complete" ? charge.snapshot.finalPoints : null;

      const listProcurement = resolveProcurementCostFromCatalog({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
        catalog: {
          ...catalog,
          inputUsdPerMillion: OPUS55_CI_CATALOG_EVIDENCE.fields.list_input_per_million,
          outputUsdPerMillion: OPUS55_CI_CATALOG_EVIDENCE.fields.list_output_per_million,
        },
      });

      const procurementNoCache = resolveProcurementCostFromCatalog({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
        catalog,
      });

      cells.push({
        promptTokens,
        outputTokens: preset.equivalentOutputTokens,
        outputChars: preset.chars,
        userChargePoints,
        userChargeKrw,
        anthropicListCostKrw: listProcurement?.procurementCostKrw ?? null,
        procurementCostKrwNoCache: procurementNoCache?.procurementCostKrw ?? null,
        grossMarginPercentNoCache:
          userChargeKrw != null && procurementNoCache != null
            ? grossMarginPercent(userChargeKrw, procurementNoCache.procurementCostKrw)
            : null,
        userChargeInvariantNote:
          "USER P = f(total prompt, billable output, targetMargin) — cache/provider state excluded.",
      });
    }
  }
  return cells;
}

/** REFERENCE_PRODUCT_MARGIN_MATRIX — Anthropic list PRODUCT targetMargin (not CI procurement margin). */
export type Opus55ReferenceProductMarginRow = {
  matrixKind: "REFERENCE_PRODUCT_MARGIN_MATRIX";
  workloadKey: "elin" | "tpot";
  targetMargin: number;
  promptTokens: number;
  outputTokens: number;
  userChargePoints: number | null;
  userChargeKrw: number | null;
  procurementCostKrwNoCache: number | null;
  grossMarginPercentNoCache: number | null;
  anthropicListCostKrw: number | null;
  marketComparisons: Array<{
    benchmarkId: string;
    label: string;
    kind: Opus55MarketBenchmark["kind"];
    referencePoints: number | null;
    referenceKrw: number | null;
    deltaPoints: number | null;
    deltaKrw: number | null;
    notes: string;
  }>;
  cacheProcurementNote: string;
};

export function buildOpus55ReferenceProductMarginMatrix(params: {
  fxSnapshot: BillingFxSnapshot;
  targetMargins?: readonly number[];
}): Opus55ReferenceProductMarginRow[] {
  const margins = params.targetMargins ?? OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES;
  const catalog = buildOpus55PrepProcurementCatalog();
  const rows: Opus55ReferenceProductMarginRow[] = [];

  for (const [workloadKey, workload] of Object.entries(OPUS55_COMMERCIAL_WORKLOADS) as Array<
    ["elin" | "tpot", (typeof OPUS55_COMMERCIAL_WORKLOADS)["elin"]]
  >) {
    for (const targetMargin of margins) {
      const charge = computeOpus55PrepProductCharge({
        promptTokens: workload.promptTokens,
        outputTokens: workload.outputTokens,
        targetMargin,
        fxSnapshot: params.fxSnapshot,
      });
      const userChargeKrw =
        charge.status === "complete" ? charge.snapshot.finalUserChargeKrw : null;
      const userChargePoints =
        charge.status === "complete" ? charge.snapshot.finalPoints : null;

      const procurementNoCache = resolveProcurementCostFromCatalog({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens: workload.promptTokens,
        outputTokens: workload.outputTokens,
        effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
        catalog,
      });

      const listProcurement = resolveProcurementCostFromCatalog({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens: workload.promptTokens,
        outputTokens: workload.outputTokens,
        effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
        catalog: {
          ...catalog,
          inputUsdPerMillion: OPUS55_CI_CATALOG_EVIDENCE.fields.list_input_per_million,
          outputUsdPerMillion: OPUS55_CI_CATALOG_EVIDENCE.fields.list_output_per_million,
        },
      });

      const marketComparisons = OPUS55_MARKET_BENCHMARKS.map((benchmark) => {
        const refPoints = benchmark.observedUserPoints;
        const refKrw = benchmark.observedUserCostKrw;
        return {
          benchmarkId: benchmark.id,
          label: benchmark.label,
          kind: benchmark.kind,
          referencePoints: refPoints,
          referenceKrw: refKrw,
          deltaPoints:
            userChargePoints != null && refPoints != null ? userChargePoints - refPoints : null,
          deltaKrw: userChargeKrw != null && refKrw != null ? userChargeKrw - refKrw : null,
          notes: benchmark.notes,
        };
      });

      rows.push({
        matrixKind: "REFERENCE_PRODUCT_MARGIN_MATRIX",
        workloadKey,
        targetMargin,
        promptTokens: workload.promptTokens,
        outputTokens: workload.outputTokens,
        userChargePoints,
        userChargeKrw,
        procurementCostKrwNoCache: procurementNoCache?.procurementCostKrw ?? null,
        grossMarginPercentNoCache:
          userChargeKrw != null && procurementNoCache != null
            ? grossMarginPercent(userChargeKrw, procurementNoCache.procurementCostKrw)
            : null,
        anthropicListCostKrw: listProcurement?.procurementCostKrw ?? null,
        marketComparisons,
        cacheProcurementNote:
          "CI catalog lists cache_read/write at $2.80/M (same as input). Runtime cache-hit economics UNVERIFIED — no-cache procurement used as conservative baseline.",
      });
    }
  }
  return rows;
}

/** @deprecated use buildOpus55ReferenceProductMarginMatrix */
export const buildOpus55CommercialPriceMatrix = buildOpus55ReferenceProductMarginMatrix;

/** @deprecated use Opus55ReferenceProductMarginRow */
export type Opus55CommercialPriceRow = Opus55ReferenceProductMarginRow;

/** REALIZED_PROCUREMENT_MARGIN_CANDIDATES — ELIN + T-POT exact workloads. */
export function buildOpus55RealizedProcurementMarginCandidateMatrix(params: {
  fxSnapshot: BillingFxSnapshot;
}): Opus55RealizedProcurementMarginCandidateRow[] {
  return buildOpus55RealizedProcurementMarginMatrix({
    fxSnapshot: params.fxSnapshot,
    workloads: [
      {
        key: "elin",
        promptTokens: OPUS55_COMMERCIAL_WORKLOADS.elin.promptTokens,
        outputTokens: OPUS55_COMMERCIAL_WORKLOADS.elin.outputTokens,
      },
      {
        key: "tpot",
        promptTokens: OPUS55_COMMERCIAL_WORKLOADS.tpot.promptTokens,
        outputTokens: OPUS55_COMMERCIAL_WORKLOADS.tpot.outputTokens,
      },
    ],
  });
}

export type Opus55CrackPerceivedReferenceRow = {
  matrixKind: "MARKET_PERCEIVED_REFERENCE";
  approxOutputChars: number;
  equivalentOutputTokens: number;
  representativePromptTokens: number;
  crackObservedPoints: number;
  realizedProcurementCandidates: Array<{
    candidateLabel: string;
    targetRealizedGrossMargin: number;
    finalPoints: number;
    deltaVsCrack523P: number;
  }>;
  notes: string;
};

/** ~4,360 char perceived reference — token workload unknown; uses representative 45k prompt. */
export function buildOpus55CrackPerceivedReference(params: {
  fxSnapshot: BillingFxSnapshot;
  representativePromptTokens?: number;
}): Opus55CrackPerceivedReferenceRow {
  const chars = 4_360;
  const equivalentOutputTokens = Math.round(chars / KOREAN_CHARS_PER_OUTPUT_TOKEN);
  const promptTokens = params.representativePromptTokens ?? 45_000;
  const crackObservedPoints = 523;
  const realizedProcurementCandidates = [0.3, 0.35, 0.4].map((targetRealizedGrossMargin) => {
    const row = computeOpus55RealizedProcurementMarginCandidate({
      promptTokens,
      outputTokens: equivalentOutputTokens,
      targetRealizedGrossMargin,
      fxSnapshot: params.fxSnapshot,
    });
    return {
      candidateLabel: row?.candidateLabel ?? "UNKNOWN",
      targetRealizedGrossMargin,
      finalPoints: row?.finalPoints ?? 0,
      deltaVsCrack523P: row != null ? row.finalPoints - crackObservedPoints : 0,
    };
  });
  return {
    matrixKind: "MARKET_PERCEIVED_REFERENCE",
    approxOutputChars: chars,
    equivalentOutputTokens,
    representativePromptTokens: promptTokens,
    crackObservedPoints,
    realizedProcurementCandidates,
    notes: "CRACK token split UNKNOWN — not comparable to ELIN/T-POT exact token rows.",
  };
}

/**
 * Lifecycle: SAFE TO DELETE after Opus 5.5 live enablement when:
 * - publishedModelPricing.ts holds commercial policy
 * - publishedUserCharge.ts is the sole USER charge owner
 * - chatBillingContractDispatch routes Opus 5.5 only through published path
 * Until then: KEEP as diagnostic/pre-live matrix owner.
 */
