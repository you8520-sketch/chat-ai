import type {
  MainRpPricingObservabilityProjection,
  MainRpPricingObservabilityRow,
  PricingCandidateObservation,
  ProcurementFreshnessState,
  ProviderEvidenceStatus,
  RealizedMarginDiagnosticStatus,
} from "@/lib/mainRpPricingObservability";
import {
  formatActualFreePointSpend,
  type ActualProductionCostEvidence,
} from "@/lib/mainRpPricingActualEconomics";
import type { MainRpPricingCandidateRecord } from "@/lib/mainRpPricingProposal";
import {
  buildMainRpPricingApplicationPlan,
  type MainRpPricingApplicationPlan,
} from "@/lib/mainRpPricingApplicationPlan";
import { MainRpPricingProposalReviewButtons } from "@/components/admin/MainRpPricingProposalReviewButtons";

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

function candidateStatusLabel(status: PricingCandidateObservation["status"]): string {
  switch (status) {
    case "READY":
      return "READY";
    case "KEEP_CURRENT":
      return "KEEP CURRENT";
    case "HOLD_NON_TARGET_MARGIN_PRICING_OWNER":
      return "Hold — commercial pricing owner is not targetMargin";
    case "HOLD_NO_HARD_MARKET_EVIDENCE":
      return "Hold — no hard-comparable market benchmark";
    case "HOLD_PROCUREMENT_NOT_FRESH":
      return "Hold — procurement not fresh";
    case "HOLD_ACTUAL_REPRESENTATIVE_CONFLICT":
      return "Hold — actual vs representative conflict";
    case "NO_FEASIBLE_PRICE":
      return "No feasible price band";
    case "UNAVAILABLE":
      return "Unavailable";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function formatSafeBand(
  minimum: number | null,
  maximum: number | null
): string {
  if (minimum == null && maximum == null) return "n/a";
  if (minimum != null && maximum != null) {
    return `${(minimum * 100).toFixed(1)}% — ${(maximum * 100).toFixed(1)}%`;
  }
  if (minimum != null) return `floor ${(minimum * 100).toFixed(1)}% (no market ceiling)`;
  return `market ${(maximum! * 100).toFixed(1)}% max (no floor bound)`;
}

function candidatePointsLabel(candidate: PricingCandidateObservation): string {
  if (candidate.candidateTargetMargin == null) return "";
  const margin =
    candidate.representative.candidateProjectedMargin != null
      ? ` · projected margin ${formatPct(candidate.representative.candidateProjectedMargin)}`
      : "";
  return ` · candidate ${candidate.representative.candidatePoints ?? "UNKNOWN"}P${margin}`;
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
            <div><dt className="inline text-zinc-500">cache read effective </dt><dd className="inline">{row.procurement.ciCacheReadUsdPerMillion != null ? `${row.procurement.ciCacheReadUsdPerMillion}/M` : "UNKNOWN"} · {row.procurement.ciCacheReadRateProvenance}</dd></div>
            <div><dt className="inline text-zinc-500">cache write provenance </dt><dd className="inline">{row.procurement.ciCacheWriteRateProvenance}</dd></div>
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

        <div className="rounded border border-cyan-500/20 bg-cyan-950/10 p-2 md:col-span-2">
          <h4 className="font-medium text-cyan-200">CANDIDATE</h4>
          <dl className="mt-1 space-y-1">
            <div><dt className="inline text-zinc-500">status </dt><dd className="inline">{candidateStatusLabel(row.candidate.status)}</dd></div>
            <div><dt className="inline text-zinc-500">pricing owner </dt><dd className="inline">{row.candidate.commercialPricingOwner}</dd></div>
            <div><dt className="inline text-zinc-500">current target </dt><dd className="inline">{formatPct(row.candidate.currentTargetMargin)}</dd></div>
            <div><dt className="inline text-zinc-500">safe band </dt><dd className="inline">{formatSafeBand(row.candidate.minimumSafeTargetMargin, row.candidate.maximumCompetitiveTargetMargin)}</dd></div>
            <div><dt className="inline text-zinc-500">decision </dt><dd className="inline">{row.candidate.candidateDirection}{row.candidate.candidateTargetMargin != null ? ` → ${formatPct(row.candidate.candidateTargetMargin)}` : ""}</dd></div>
            <div><dt className="inline text-zinc-500">live applicability </dt><dd className="inline">{row.candidate.liveApplicability} · {row.candidate.productionBillingContract}</dd></div>
            <div><dt className="inline text-zinc-500">representative </dt><dd className="inline">{row.representative.representativeWorkloadLabel} · current {row.candidate.representative.currentPoints ?? "UNKNOWN"}P{candidatePointsLabel(row.candidate)}</dd></div>
            {row.candidate.market.hardBenchmarkCount > 0 ? (
              <div>
                <dt className="inline text-zinc-500">market </dt>
                <dd className="inline">
                  {row.candidate.market.cases.map((marketCase) => (
                    <span key={marketCase.benchmarkId} className="mr-2">
                      {marketCase.benchmarkId}: {marketCase.currentPoints ?? "?"}P / competitor {marketCase.competitorPoints}P — {marketCase.pass == null ? "?" : marketCase.pass ? "PASS" : "FAIL"}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
            <div><dt className="inline text-zinc-500">actual signal </dt><dd className="inline">{row.candidate.actual.signal}{row.candidate.actual.exact && row.candidate.actual.marginRate != null ? ` (${formatPct(row.candidate.actual.marginRate)})` : ""}</dd></div>
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

function formatProposalMargin(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function applicationPlanStatusLabel(
  plan: MainRpPricingApplicationPlan
): string {
  switch (plan.status) {
    case "READY":
      return "READY — read-only change plan";
    case "HOLD_NOT_APPROVED":
      return "Hold — proposal not approved";
    case "HOLD_NEWER_OCCURRENCE_EXISTS":
      return "Hold — newer candidate occurrence exists";
    case "HOLD_MISSING_REVIEW_EVIDENCE":
      return "Hold — review evidence missing";
    case "HOLD_REVIEW_EVIDENCE_MISMATCH":
      return "Hold — review evidence mismatch";
    case "HOLD_PUBLISHED_BASE_CHANGED":
      return "Hold — Published base changed";
    case "HOLD_CANDIDATE_CHANGED":
      return "Hold — candidate changed";
    case "HOLD_COMMERCIAL_OWNER_CHANGED":
      return "Hold — pricing owner changed";
    case "HOLD_UNSUPPORTED_COMMERCIAL_OWNER":
      return "Hold — specialized pricing owner required";
    case "HOLD_SITE_PROMOTION_ACTIVE":
      return "Hold — site promotion active";
    case "HOLD_PUBLISHED_NOT_LIVE":
      return "Hold — Published path is not live";
    case "HOLD_NO_EFFECTIVE_CHANGE":
      return "Hold — no effective target change";
    case "UNAVAILABLE":
      return "Unavailable";
    default: {
      const _exhaustive: never = plan.status;
      return _exhaustive;
    }
  }
}

function ApplicationPlanCell(props: { plan: MainRpPricingApplicationPlan }) {
  const { plan } = props;
  return (
    <div className="min-w-72 text-zinc-400">
      <div className={plan.status === "READY" ? "font-medium text-emerald-200" : "font-medium text-amber-200"}>
        {applicationPlanStatusLabel(plan)}
      </div>
      {plan.status === "READY" ? (
        <>
          <div>
            target {formatProposalMargin(plan.currentTargetMargin)} → {formatProposalMargin(plan.proposedTargetMargin)}
          </div>
          <div>
            version v{plan.currentPricingVersion} → v{plan.nextPricingVersion} · {plan.liveScope}
          </div>
          <div>owner {plan.ownerModule}</div>
          <div>publishedAt: set at application commit</div>
          <div>
            representative {plan.preview.representativeCurrentPoints ?? "?"}P → {plan.preview.representativeCandidatePoints ?? "?"}P
          </div>
          <div>NO MUTATION / NO APPLY BUTTON</div>
        </>
      ) : (
        <div>{plan.blockers[0] ?? "Blocked"}</div>
      )}
    </div>
  );
}

function CandidateProposalHistory(props: {
  records: readonly MainRpPricingCandidateRecord[];
  projection: MainRpPricingObservabilityProjection;
}) {
  const latestRecordIdByModel = new Map<string, number>();
  for (const record of props.records) {
    const latest = latestRecordIdByModel.get(record.modelId);
    if (latest == null || record.id > latest) {
      latestRecordIdByModel.set(record.modelId, record.id);
    }
  }

  if (props.records.length === 0) {
    return (
      <div className="mt-4 rounded border border-white/10 p-3 text-xs text-zinc-500">
        Candidate history is empty. Records are created by the daily finance/pricing scheduler after a completed pricing-tracker observation.
      </div>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto rounded border border-cyan-500/20">
      <div className="border-b border-white/10 bg-cyan-950/10 p-3">
        <h3 className="font-medium text-cyan-100">Candidate history / review records</h3>
        <p className="mt-1 text-xs text-zinc-500">
          APPROVED records can show a read-only application plan. No action on this table changes Published pricing or live billing.
        </p>
      </div>
      <table className="w-full min-w-[1100px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-white/10 text-left text-zinc-400">
            <th className="p-2">state</th>
            <th className="p-2">model</th>
            <th className="p-2">candidate</th>
            <th className="p-2">band</th>
            <th className="p-2">evidence</th>
            <th className="p-2">observed</th>
            <th className="p-2">review</th>
            <th className="p-2">application plan</th>
          </tr>
        </thead>
        <tbody>
          {props.records.map((record) => {
            const currentRow =
              props.projection.models.find((row) => row.modelId === record.modelId) ?? null;
            const applicationPlan =
              record.reviewState === "APPROVED"
                ? buildMainRpPricingApplicationPlan({
                    record,
                    currentRow,
                    latestRecordIdForModel:
                      latestRecordIdByModel.get(record.modelId) ?? null,
                  })
                : null;
            return (
            <tr key={record.id} className="border-b border-white/5 align-top">
              <td className="p-2">
                <div className="font-medium text-zinc-200">{record.reviewState}</div>
                <div className="text-zinc-500">{record.candidateStatus}</div>
              </td>
              <td className="p-2">
                <div>{record.modelId}</div>
                <div className="text-zinc-500">base v{record.basePricingVersion}</div>
              </td>
              <td className="p-2">
                <div>{record.candidateDirection}</div>
                <div className="text-zinc-500">
                  {formatProposalMargin(record.baseTargetMargin)} → {formatProposalMargin(record.proposedTargetMargin)}
                </div>
              </td>
              <td className="p-2 text-zinc-400">
                {formatProposalMargin(record.minimumSafeTargetMargin)} — {formatProposalMargin(record.maximumCompetitiveTargetMargin)}
              </td>
              <td className="p-2 text-zinc-400">
                <div>{record.procurementFreshness} · {record.actualSignal}</div>
                <div>{record.liveApplicability}</div>
                <div>{record.hardBenchmarkCount} hard benchmark(s)</div>
              </td>
              <td className="p-2 text-zinc-400">
                <div>{record.lastObservedAt}</div>
                <div>count {record.observationCount}</div>
              </td>
              <td className="p-2">
                {record.reviewState === "OPEN" ? (
                  <MainRpPricingProposalReviewButtons proposalId={record.id} />
                ) : (
                  <div className="text-zinc-500">
                    <div>{record.reviewedAt ?? record.supersededReason ?? "—"}</div>
                    {record.reviewNote ? <div className="mt-1">{record.reviewNote}</div> : null}
                  </div>
                )}
              </td>
              <td className="p-2">
                {applicationPlan ? <ApplicationPlanCell plan={applicationPlan} /> : <span className="text-zinc-600">—</span>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MainRpPricingControlPlaneSection(props: {
  projection: MainRpPricingObservabilityProjection;
  candidateRecords: readonly MainRpPricingCandidateRecord[];
}) {
  const { projection, candidateRecords } = props;
  return (
    <section className="mt-6">
      <h2 className="font-semibold text-violet-100">Main RP Control Plane</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Pricing projection is read-only. Proposal controls record human review only and never apply a price.
        Semantic domains — MARKET / PROVIDER / PROCUREMENT / PRODUCT / PROMOTION / REPRESENTATIVE / ACTUAL / CANDIDATE.
        OBSERVE_ONLY tracker · actual economics {projection.actualEconomicsMonthKey ?? "unavailable"} · generated {projection.generatedAt}
      </p>
      <CandidateProposalHistory records={candidateRecords} projection={projection} />
      <div className="mt-4 space-y-4">
        {projection.models.map((row) => (
          <ModelControlPlaneCard key={row.modelId} row={row} />
        ))}
      </div>
    </section>
  );
}
