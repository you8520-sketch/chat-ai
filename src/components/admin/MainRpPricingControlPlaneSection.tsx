import type {
  MainRpPricingObservabilityProjection,
  MainRpPricingObservabilityRow,
  RealizedMarginDiagnosticStatus,
} from "@/lib/mainRpPricingObservability";

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "UNKNOWN";
  return `${(value * 100).toFixed(1)}%`;
}

function formatUsdPair(input: number | null, output: number | null): string {
  if (input == null || output == null) return "UNKNOWN";
  return `$${input}/${output} per M`;
}

function marginStatusLabel(status: RealizedMarginDiagnosticStatus): string {
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
            <div><dt className="inline text-zinc-500">rep charge </dt><dd className="inline">{row.product.representativeProductionChargePoints ?? "UNKNOWN"}P @ {row.product.representativeWorkloadLabel}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-emerald-500/20 bg-emerald-950/10 p-2">
          <h4 className="font-medium text-emerald-200">MARKET</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">benchmark </dt><dd className="inline">{row.market.competitorPoints ?? "UNKNOWN"}P · {row.market.comparabilityStatus}</dd></div>
            <div><dt className="inline text-zinc-500">Δ vs us </dt><dd className="inline">{row.market.differenceVsBenchmarkPoints != null ? `${row.market.differenceVsBenchmarkPoints > 0 ? "+" : ""}${row.market.differenceVsBenchmarkPoints.toFixed(1)}P` : "UNKNOWN"}</dd></div>
            <div><dt className="inline text-zinc-500">age </dt><dd className="inline">{row.market.benchmarkAgeLabel}</dd></div>
            <div><dt className="inline text-zinc-500">source </dt><dd className="inline">{row.market.sourceLabel ?? "UNKNOWN"}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-amber-500/20 bg-amber-950/10 p-2">
          <h4 className="font-medium text-amber-200">PROVIDER</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">official </dt><dd className="inline">{formatUsdPair(row.provider.officialInputUsdPerMillion, row.provider.officialOutputUsdPerMillion)}</dd></div>
            <div><dt className="inline text-zinc-500">mode </dt><dd className="inline">{row.provider.pricingMode}</dd></div>
            <div><dt className="inline text-zinc-500">observer </dt><dd className="inline">{row.provider.observerStatus}</dd></div>
            <div><dt className="inline text-zinc-500">observed </dt><dd className="inline">{row.provider.observedAt ?? "UNKNOWN"}</dd></div>
          </dl>
        </div>

        <div className="rounded border border-orange-500/20 bg-orange-950/10 p-2">
          <h4 className="font-medium text-orange-200">PROCUREMENT</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">CI current </dt><dd className="inline">{formatUsdPair(row.procurement.ciCurrentInputUsdPerMillion, row.procurement.ciCurrentOutputUsdPerMillion)}</dd></div>
            <div><dt className="inline text-zinc-500">discount </dt><dd className="inline">{row.procurement.ciDiscountPercent != null ? `${row.procurement.ciDiscountPercent}%` : "UNKNOWN"}</dd></div>
            <div><dt className="inline text-zinc-500">provenance </dt><dd className="inline">{row.procurement.provenance}</dd></div>
            <div><dt className="inline text-zinc-500">rep cost </dt><dd className="inline">{row.procurement.representativeProcurementCostKrw != null ? `${row.procurement.representativeProcurementCostKrw.toFixed(1)} KRW` : "UNKNOWN"}</dd></div>
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
          <h4 className="font-medium text-rose-200">MARGIN</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">target / floor </dt><dd className="inline">{formatPct(row.margin.targetMargin)} / {formatPct(row.margin.minimumMarginFloor)}</dd></div>
            <div><dt className="inline text-zinc-500">realized </dt><dd className="inline">{formatPct(row.margin.realizedMargin)} ({row.margin.realizedMarginProvenance})</dd></div>
            <div><dt className="inline text-zinc-500">tracker </dt><dd className="inline">{formatPct(row.margin.trackerAlignedRealizedMargin)}</dd></div>
            <div><dt className="inline text-zinc-500">status </dt><dd className="inline">{marginStatusLabel(row.margin.status)}</dd></div>
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
        Semantic domains separated — MARKET / PROVIDER / PROCUREMENT / PRODUCT / PROMOTION / MARGIN.
        OBSERVE_ONLY · main {projection.mainHead.slice(0, 12)} · generated {projection.generatedAt}
      </p>
      <div className="mt-4 space-y-4">
        {projection.models.map((row) => (
          <ModelControlPlaneCard key={row.modelId} row={row} />
        ))}
      </div>
    </section>
  );
}
