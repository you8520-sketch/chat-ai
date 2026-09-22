import type {
  MainRpPricingObservabilityProjection,
  MainRpPricingObservabilityRow,
  ProcurementFreshnessState,
  ProviderEvidenceStatus,
  RealizedMarginDiagnosticStatus,
} from "@/lib/mainRpPricingObservability";
import {
  formatActualFreePointSpend,
  type ActualProductionCostEvidence,
} from "@/lib/mainRpPricingActualEconomics";

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "UNKNOWN";
  return `${(value * 100).toFixed(1)}%`;
}

function formatKrw(value: number): string {
  return `${Math.round(value).toLocaleString()} KRW`;
}

function formatCostEvidenceLabel(evidence: ActualProductionCostEvidence): string | null {
  const actualKrw = evidence.actualKrw ?? 0;
  const estimatedKrw = evidence.estimatedKrw ?? 0;
  if (actualKrw + estimatedKrw > 0) {
    return `${evidence.sourceState ?? "ledger"} · actual ${formatKrw(actualKrw)} · est ${formatKrw(estimatedKrw)}`;
  }
  if (evidence.sourceState) {
    return evidence.calls != null
      ? `${evidence.sourceState} · ${evidence.calls} calls`
      : evidence.sourceState;
  }
  return null;
}

function formatUsdPair(input: number | null, output: number | null): string {
  if (input == null || output == null) return "UNKNOWN";
  return `$${input}/${output} per M`;
}

function marginStatusLabel(
  status: RealizedMarginDiagnosticStatus,
  freshness: ProcurementFreshnessState,
  underlying: "healthy" | "below_floor" | null
): string {
  const base = (() => {
    switch (status) {
      case "healthy":
        return "healthy";
      case "below_floor":
        return "below-floor";
      case "blocked":
        return "blocked";
      case "unavailable":
        return "unavailable";
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  })();
  if (freshness !== "FRESH" && underlying != null) {
    const verdict = underlying === "below_floor" ? "below-floor" : "healthy";
    return `${base} (${verdict} on ${freshness} evidence)`;
  }
  if (freshness !== "FRESH" && status === "unavailable") {
    return `${base} (${freshness} evidence)`;
  }
  return base;
}

function procurementRateLabel(freshness: ProcurementFreshnessState): string {
  switch (freshness) {
    case "FRESH":
      return "CI (tracker-completed, fresh)";
    case "STALE":
      return "CI (stale evidence)";
    case "ABSENT":
      return "CI unavailable";
    default: {
      const _exhaustive: never = freshness;
      return _exhaustive;
    }
  }
}

function providerStatusLabel(status: ProviderEvidenceStatus): string {
  switch (status) {
    case "persisted_live":
      return "persisted_live";
    case "live_cached_supplemental":
      return "live_cached_supplemental";
    case "historical_evidence":
      return "historical_evidence";
    case "unsupported":
      return "unsupported";
    case "absent":
      return "absent";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function coverageLabel(coverage: string | null, exact: boolean): string {
  if (!coverage) return "UNKNOWN";
  return `${coverage.toUpperCase()} · ${exact ? "EXACT" : "NOT EXACT"}`;
}

function ModelControlPlaneCard(props: { row: MainRpPricingObservabilityRow }) {
  const { row } = props;
  return (
    <article className="rounded border border-violet-500/30 bg-violet-950/10 p-4 text-xs text-zinc-300">
      <h3 className="text-sm font-semibold text-violet-100">{row.modelId}</h3>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded border border-sky-500/20 bg-sky-950/10 p-2">
          <h4 className="font-medium text-sky-200">PRODUCT</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">BASE </dt><dd className="inline">{formatUsdPair(row.product.publishedInputUsdPerMillion, row.product.publishedOutputUsdPerMillion)}</dd></div>
            <div><dt className="inline text-zinc-500">version </dt><dd className="inline">v{row.product.pricingVersion}</dd></div>
            <div><dt className="inline text-zinc-500">contract </dt><dd className="inline">{row.product.productionBillingContract}</dd></div>
            {row.product.productionBillingContractNotes ? (
              <div><dt className="inline text-zinc-500">notes </dt><dd className="inline text-zinc-400">{row.product.productionBillingContractNotes}</dd></div>
            ) : null}
            <div><dt className="inline text-zinc-500">tracker rep </dt><dd className="inline">{row.product.representativeProductionChargePoints ?? "UNKNOWN"}P @ {row.product.representativeWorkloadLabel}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-emerald-500/20 bg-emerald-950/10 p-2">
          <h4 className="font-medium text-emerald-200">MARKET</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">benchmark </dt><dd className="inline">{row.market.competitorPoints ?? "UNKNOWN"}P · {row.market.comparabilityStatus}</dd></div>
            {row.market.ourBenchmarkWorkloadLabel ? (
              <div><dt className="inline text-zinc-500">our @ benchmark </dt><dd className="inline">{row.market.ourChargeAtBenchmarkPoints ?? "UNKNOWN"}P @ {row.market.ourBenchmarkWorkloadLabel} ({row.market.ourProductionBillingBasis} · {row.market.ourProductionBillingContract})</dd></div>
            ) : null}
            {row.market.publishedChargeAtBenchmarkPoints != null &&
            row.market.ourProductionBillingBasis === "legacy" ? (
              <div><dt className="inline text-zinc-500">published @ benchmark </dt><dd className="inline">{row.market.publishedChargeAtBenchmarkPoints}P (diagnostic only)</dd></div>
            ) : null}
            <div><dt className="inline text-zinc-500">Δ same-workload </dt><dd className="inline">{row.market.differenceVsBenchmarkPoints != null ? `${row.market.differenceVsBenchmarkPoints > 0 ? "+" : ""}${row.market.differenceVsBenchmarkPoints.toFixed(1)}P` : "n/a"}</dd></div>
            <div><dt className="inline text-zinc-500">age </dt><dd className="inline">{row.market.benchmarkAgeLabel}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-amber-500/20 bg-amber-950/10 p-2">
          <h4 className="font-medium text-amber-200">PROVIDER</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">official </dt><dd className="inline">{formatUsdPair(row.provider.officialInputUsdPerMillion, row.provider.officialOutputUsdPerMillion)}</dd></div>
            <div><dt className="inline text-zinc-500">mode </dt><dd className="inline">{row.provider.pricingMode}</dd></div>
            <div><dt className="inline text-zinc-500">evidence </dt><dd className="inline">{providerStatusLabel(row.provider.evidenceStatus)}</dd></div>
            <div><dt className="inline text-zinc-500">observed </dt><dd className="inline">{row.provider.observedAt ?? "UNKNOWN"}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-orange-500/20 bg-orange-950/10 p-2">
          <h4 className="font-medium text-orange-200">PROCUREMENT</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">rates </dt><dd className="inline">{procurementRateLabel(row.procurement.ciFreshnessState)} · {formatUsdPair(row.procurement.ciInputUsdPerMillion, row.procurement.ciOutputUsdPerMillion)}</dd></div>
            <div><dt className="inline text-zinc-500">freshness </dt><dd className="inline">{row.procurement.ciFreshnessState} ({row.procurement.ciEvidenceSource})</dd></div>
            <div><dt className="inline text-zinc-500">observed </dt><dd className="inline">{row.procurement.ciObservedAt ?? "UNKNOWN"}</dd></div>
            <div><dt className="inline text-zinc-500">provenance </dt><dd className="inline">{row.procurement.provenance}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-fuchsia-500/20 bg-fuchsia-950/10 p-2">
          <h4 className="font-medium text-fuchsia-200">PROMOTION</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">site </dt><dd className="inline">{row.promotion.sitePromotionActive ? `ON ${row.promotion.siteDiscountPercent}%` : "OFF"}</dd></div>
            <div><dt className="inline text-zinc-500">official </dt><dd className="inline">{row.promotion.officialPromotionCount > 0 ? row.promotion.officialPromotionSummary : "none"}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-rose-500/20 bg-rose-950/10 p-2">
          <h4 className="font-medium text-rose-200">REPRESENTATIVE</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">workload </dt><dd className="inline">{row.representative.representativeWorkloadLabel}</dd></div>
            <div><dt className="inline text-zinc-500">target / floor </dt><dd className="inline">{formatPct(row.representative.targetMargin)} / {formatPct(row.representative.minimumMarginFloor)}</dd></div>
            <div><dt className="inline text-zinc-500">estimate </dt><dd className="inline">{formatPct(row.representative.representativeMarginEstimate)} ({row.representative.representativeMarginProvenance}, {row.representative.representativeMarginRevenueUnit})</dd></div>
            <div><dt className="inline text-zinc-500">tracker </dt><dd className="inline">{formatPct(row.representative.trackerAlignedMarginEstimate)}</dd></div>
            <div><dt className="inline text-zinc-500">status </dt><dd className="inline">{marginStatusLabel(row.representative.status, row.representative.procurementCostFreshness, row.representative.underlyingFloorVerdict)}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-lime-500/20 bg-lime-950/10 p-2 md:col-span-2 xl:col-span-1">
          <h4 className="font-medium text-lime-200">ACTUAL{row.actual.monthKey ? ` — ${row.actual.monthKey}` : ""}</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">usage </dt><dd className="inline">{row.actual.usageState}</dd></div>
            {row.actual.usageState === "HAS_ACTIVITY" ? (
              <>
                <div><dt className="inline text-zinc-500">paid revenue </dt><dd className="inline">{formatKrw(row.actual.paidRevenueKrw)}</dd></div>
                <div><dt className="inline text-zinc-500">free spend </dt><dd className="inline">{formatActualFreePointSpend(row.actual.freePointSpend)}</dd></div>
                <div><dt className="inline text-zinc-500">provider cost </dt><dd className="inline">{formatKrw(row.actual.apiCostKrw)}</dd></div>
                <div><dt className="inline text-zinc-500">margin </dt><dd className="inline">{row.actual.marginDisplay}</dd></div>
                <div><dt className="inline text-zinc-500">coverage </dt><dd className="inline">{coverageLabel(row.actual.marginCoverage, row.actual.realizedMarginExact)}</dd></div>
                {formatCostEvidenceLabel(row.actual.costEvidence) ? (
                  <div><dt className="inline text-zinc-500">cost evidence </dt><dd className="inline">{formatCostEvidenceLabel(row.actual.costEvidence)}</dd></div>
                ) : null}
              </>
            ) : (
              <div><dt className="inline text-zinc-500">status </dt><dd className="inline">{row.actual.marginDisplay}</dd></div>
            )}
          </dl>
        </div>
      </div>

      {row.gemini37RootCause ? (
        <div className="mt-3 rounded border border-yellow-500/30 bg-yellow-950/20 p-2">
          <h4 className="font-medium text-yellow-100">Gemini 3.7 margin-floor investigation</h4>
          <p className="mt-1">classification: {row.gemini37RootCause.classification} · breach: {row.gemini37RootCause.observedMarginFloorBreach ? "yes" : "no"}</p>
          <p className="mt-1 text-zinc-400">hypotheses: {row.gemini37RootCause.plausibleHypotheses.length > 0 ? row.gemini37RootCause.plausibleHypotheses.join(", ") : "none flagged"}</p>
          {row.gemini37RootCause.notes.map((note) => (
            <p key={note} className="mt-1 text-zinc-500">{note}</p>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function MainRpPricingControlPlaneSection(props: {
  projection: MainRpPricingObservabilityProjection;
}) {
  const { projection } = props;
  return (
    <section className="mt-6">
      <h2 className="font-semibold text-violet-100">Main RP Control Plane (read-only)</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Semantic domains — MARKET / PROVIDER / PROCUREMENT / PRODUCT / PROMOTION / REPRESENTATIVE / ACTUAL.
        OBSERVE_ONLY tracker · actual economics {projection.actualEconomicsMonthKey ?? "unavailable"} · generated {projection.generatedAt}
      </p>
      <div className="mt-4 space-y-4">
        {projection.models.map((row) => (
          <ModelControlPlaneCard key={row.modelId} row={row} />
        ))}
      </div>
    </section>
  );
}
