import { convertUsdToKrw } from "@/lib/exchangeRate";
import type { ActualCostSource } from "@/lib/shadowPricing";

export type SyncActualCostCoverage = "complete" | "partial" | "unavailable";

export type SyncExtractActualCostProvenance = {
  actualProviderCostUsd?: number;
  actualProviderCostKrw?: number;
  actualCostSource: ActualCostSource;
  actualCostCoverage: SyncActualCostCoverage;
  /** Participating physical provider calls in this aggregate. */
  physicalCallCount: number;
  /** Calls with CheaperInference billed USD present. */
  billedCallCount: number;
};

export type SyncExtractUsageCostInput = {
  cheaperInferenceBilledCostUsd?: number;
  upstreamCostUsd?: number;
};

export type SyncExtractAggregateInput = {
  cheaperInferenceBilledCostUsd?: number;
  physicalCallCount: number;
  billedCallCount: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function nonNegativeFinite(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

function hasCiBilled(u: SyncExtractUsageCostInput): boolean {
  const billed = nonNegativeFinite(u.cheaperInferenceBilledCostUsd);
  return billed > 0;
}

/**
 * Canonical sync post-turn aggregate actual cost provenance.
 * CheaperInference billed USD is the settled actual owner — upstream is never promoted to exact.
 */
export function resolveSyncExtractActualCost(
  usages: SyncExtractUsageCostInput[],
  effectiveKrwPerUsd: number
): SyncExtractActualCostProvenance {
  const physicalCallCount = usages.length;
  if (physicalCallCount === 0) {
    return {
      actualCostSource: "unavailable",
      actualCostCoverage: "unavailable",
      physicalCallCount: 0,
      billedCallCount: 0,
    };
  }

  const billedUsages = usages.filter(hasCiBilled);
  const billedCallCount = billedUsages.length;

  if (billedCallCount > 0) {
    const actualProviderCostUsd = billedUsages.reduce(
      (sum, u) => sum + nonNegativeFinite(u.cheaperInferenceBilledCostUsd),
      0
    );
    const actualProviderCostKrw = round1(
      convertUsdToKrw(actualProviderCostUsd, effectiveKrwPerUsd)
    );
    return {
      actualProviderCostUsd,
      actualProviderCostKrw,
      actualCostSource: "cheaper_inference_billed",
      actualCostCoverage:
        billedCallCount === physicalCallCount ? "complete" : "partial",
      physicalCallCount,
      billedCallCount,
    };
  }

  return {
    actualCostSource: "unavailable",
    actualCostCoverage: "unavailable",
    physicalCallCount,
    billedCallCount: 0,
  };
}

/** Resolve from pre-merged aggregate totals (e.g. statusWidgetExtract receipt build). */
export function resolveSyncExtractActualCostFromAggregate(
  input: SyncExtractAggregateInput,
  effectiveKrwPerUsd: number
): SyncExtractActualCostProvenance {
  const physicalCallCount = Math.max(0, Math.floor(input.physicalCallCount));
  const billedCallCount = Math.min(
    physicalCallCount,
    Math.max(0, Math.floor(input.billedCallCount))
  );
  const billedUsd = nonNegativeFinite(input.cheaperInferenceBilledCostUsd);

  if (physicalCallCount === 0 || billedCallCount === 0 || billedUsd <= 0) {
    return {
      actualCostSource: "unavailable",
      actualCostCoverage: "unavailable",
      physicalCallCount,
      billedCallCount,
    };
  }

  return {
    actualProviderCostUsd: billedUsd,
    actualProviderCostKrw: round1(convertUsdToKrw(billedUsd, effectiveKrwPerUsd)),
    actualCostSource: "cheaper_inference_billed",
    actualCostCoverage:
      billedCallCount === physicalCallCount ? "complete" : "partial",
    physicalCallCount,
    billedCallCount,
  };
}

export function isSyncExtractActualExact(
  provenance: Pick<
    SyncExtractActualCostProvenance,
    "actualCostSource" | "actualCostCoverage"
  >
): boolean {
  return (
    provenance.actualCostSource === "cheaper_inference_billed" &&
    provenance.actualCostCoverage === "complete"
  );
}
