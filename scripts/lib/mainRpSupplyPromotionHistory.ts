import type { SelectedAI } from "@/lib/chatModels";
import {
  MAIN_RP_SUPPLY_LIVE_MAX_MARKET_LATENCY_P50_SECONDS,
  MAIN_RP_SUPPLY_LIVE_MIN_MARKET_THROUGHPUT_P50_TPS,
  MAIN_RP_SUPPLY_LIVE_MIN_RAW_RATE_SAVINGS,
  MAIN_RP_SUPPLY_LIVE_MIN_UPTIME_PERCENT,
  type MainRpSupplyLiveQualificationReport,
} from "./mainRpSupplyLiveQualification";
import type { SupplyTransportComparisonReport } from "./mainRpSupplyCurrentBaseline";
import type { MainRpSupplyRadarReport, SupplyComparison } from "./mainRpSupplyRadar";

export const MAIN_RP_SUPPLY_PROMOTION_HISTORY_VERSION = 1;
export const MAIN_RP_SUPPLY_PROMOTION_REQUIRED_MARKET_SNAPSHOTS = 4;
export const MAIN_RP_SUPPLY_PROMOTION_REQUIRED_MARKET_SPAN_DAYS = 21;
export const MAIN_RP_SUPPLY_PROMOTION_REQUIRED_LIVE_PAIRS = 2;
export const MAIN_RP_SUPPLY_PROMOTION_REQUIRED_LIVE_SPAN_DAYS = 14;
export const MAIN_RP_SUPPLY_PROMOTION_MAX_HISTORY_SNAPSHOTS = 24;
export const MAIN_RP_SUPPLY_PROMOTION_MAX_TOTAL_TIME_RATIO = 1;
export const MAIN_RP_SUPPLY_PROMOTION_MAX_TTFT_RATIO = 1.25;

export type SupplyHistorySnapshot = {
  runId: string;
  report: MainRpSupplyRadarReport;
  live: MainRpSupplyLiveQualificationReport | null;
  comparison: SupplyTransportComparisonReport | null;
};

export type SupplyPromotionStatus =
  | "PROMOTION_READY"
  | "CURRENT_MARKET_GATE_FAILED"
  | "INSUFFICIENT_MARKET_HISTORY"
  | "MARKET_HISTORY_SPAN_TOO_SHORT"
  | "LIVE_REGRESSION_OBSERVED"
  | "INSUFFICIENT_LIVE_HISTORY"
  | "LIVE_HISTORY_SPAN_TOO_SHORT"
  | "BASELINE_COMPARISON_MISSING"
  | "DEPLOY_ROUTE_PARITY_UNPROVEN"
  | "OBSERVED_COST_SAVINGS_UNPROVEN"
  | "PERFORMANCE_REGRESSION";

export type SupplyPromotionEvidence = {
  modelId: SelectedAI;
  providerName: string;
  providerSlug: string;
  status: SupplyPromotionStatus;
  qualifyingMarketSnapshots: number;
  marketObservationSpanDays: number;
  completeLivePairs: number;
  incompleteLivePairs: number;
  liveObservationSpanDays: number;
  latestSavingsPercent: number | null;
  latestMarketLatencyP50Seconds: number | null;
  latestMarketThroughputP50TokensPerSecond: number | null;
  latestMarketUptime1dPercent: number | null;
  latestMarketUptime30mPercent: number | null;
  worstCandidateTotalVsBaselineRatio: number | null;
  worstCandidateTtftVsBaselineRatio: number | null;
  worstObservedCostDeltaVsCurrentPercent: number | null;
  testedServiceTier: "flex" | null;
  currentServiceTier: "flex" | null;
  reasons: string[];
};

export type MainRpSupplyPromotionHistoryReport = {
  version: number;
  generatedAt: string;
  snapshotsExamined: number;
  candidates: SupplyPromotionEvidence[];
  promotionReadyCount: number;
  notes: string[];
};

function epoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function spanDays(values: Array<string | null | undefined>): number {
  const times = values.map(epoch).filter((value): value is number => value != null);
  if (times.length < 2) return 0;
  return (Math.max(...times) - Math.min(...times)) / 86_400_000;
}

function providerKey(modelId: string, providerSlug: string): string {
  return `${modelId}::${providerSlug}`;
}

function isMarketQualified(endpoint: SupplyComparison | null): boolean {
  return Boolean(
    endpoint &&
      endpoint.status === 0 &&
      endpoint.lowerRawEndpointRateThanCurrentProcurement === true &&
      endpoint.rawEndpointRateDeltaVsCurrentProcurementPercent != null &&
      endpoint.rawEndpointRateDeltaVsCurrentProcurementPercent <=
        -MAIN_RP_SUPPLY_LIVE_MIN_RAW_RATE_SAVINGS &&
      endpoint.uptimeLast1dPercent != null &&
      endpoint.uptimeLast1dPercent >= MAIN_RP_SUPPLY_LIVE_MIN_UPTIME_PERCENT &&
      endpoint.uptimeLast30mPercent != null &&
      endpoint.uptimeLast30mPercent >= MAIN_RP_SUPPLY_LIVE_MIN_UPTIME_PERCENT &&
      endpoint.latencyP50SecondsLast30m != null &&
      endpoint.latencyP50SecondsLast30m <=
        MAIN_RP_SUPPLY_LIVE_MAX_MARKET_LATENCY_P50_SECONDS &&
      endpoint.throughputP50TokensPerSecondLast30m != null &&
      endpoint.throughputP50TokensPerSecondLast30m >=
        MAIN_RP_SUPPLY_LIVE_MIN_MARKET_THROUGHPUT_P50_TPS &&
      endpoint.provider?.privacyPolicyUrl
  );
}

function matchingMarketEndpoint(
  snapshot: SupplyHistorySnapshot,
  modelId: SelectedAI,
  providerSlug: string
): SupplyComparison | null {
  const model = snapshot.report.models.find((row) => row.modelId === modelId);
  if (!model) return null;
  return (
    model.comparisons.find(
      (row) => row.provider?.slug?.toLowerCase() === providerSlug.toLowerCase()
    ) ?? null
  );
}

function latestSnapshot(
  snapshots: SupplyHistorySnapshot[]
): SupplyHistorySnapshot | null {
  return (
    [...snapshots].sort(
      (a, b) =>
        (epoch(b.report.generatedAt) ?? 0) - (epoch(a.report.generatedAt) ?? 0)
    )[0] ?? null
  );
}

function comparisonRatios(input: {
  snapshots: SupplyHistorySnapshot[];
  modelId: SelectedAI;
  providerSlug: string;
}): {
  total: number[];
  ttft: number[];
  observedCostDelta: number[];
  missing: number;
  routeParityMismatch: number;
  currentOpenRouterComparisons: number;
  testedServiceTiers: Array<"flex" | null>;
  currentServiceTiers: Array<"flex" | null>;
} {
  const total: number[] = [];
  const ttft: number[] = [];
  const observedCostDelta: number[] = [];
  const testedServiceTiers: Array<"flex" | null> = [];
  const currentServiceTiers: Array<"flex" | null> = [];
  let missing = 0;
  let routeParityMismatch = 0;
  let currentOpenRouterComparisons = 0;

  for (const snapshot of input.snapshots) {
    const liveResult = snapshot.live?.results.find(
      (row) =>
        row.candidate.modelId === input.modelId &&
        row.candidate.providerSlug === input.providerSlug &&
        row.livePairComplete
    );
    if (!liveResult) continue;

    const row = snapshot.comparison?.rows.find(
      (candidate) =>
        candidate.modelId === input.modelId &&
        candidate.candidateProviderSlug === input.providerSlug
    );
    if (
      !row ||
      !row.candidatePairComplete ||
      !row.currentPairComplete ||
      row.candidateAverageTotalSeconds == null ||
      row.currentAverageTotalSeconds == null ||
      row.candidateAverageTtftSeconds == null ||
      row.currentAverageTtftSeconds == null ||
      row.currentAverageTotalSeconds <= 0 ||
      row.currentAverageTtftSeconds <= 0
    ) {
      missing += 1;
      continue;
    }

    total.push(
      row.candidateAverageTotalSeconds / row.currentAverageTotalSeconds
    );
    ttft.push(row.candidateAverageTtftSeconds / row.currentAverageTtftSeconds);
    testedServiceTiers.push(row.candidateDeploymentServiceTier);
    currentServiceTiers.push(row.currentServiceTier);

    if (row.currentProvider === "openrouter") {
      currentOpenRouterComparisons += 1;
      if (row.candidateDeploymentServiceTier !== row.currentServiceTier) {
        routeParityMismatch += 1;
      }
      if (row.candidateObservedCostDeltaVsCurrentPercent == null) {
        missing += 1;
      } else {
        observedCostDelta.push(
          row.candidateObservedCostDeltaVsCurrentPercent
        );
      }
    }
  }

  return {
    total,
    ttft,
    observedCostDelta,
    missing,
    routeParityMismatch,
    currentOpenRouterComparisons,
    testedServiceTiers,
    currentServiceTiers,
  };
}

export function evaluateMainRpSupplyPromotionHistory(input: {
  snapshots: SupplyHistorySnapshot[];
  generatedAt?: string;
}): MainRpSupplyPromotionHistoryReport {
  const snapshots = [...input.snapshots]
    .sort(
      (a, b) =>
        (epoch(a.report.generatedAt) ?? 0) - (epoch(b.report.generatedAt) ?? 0)
    )
    .slice(-MAIN_RP_SUPPLY_PROMOTION_MAX_HISTORY_SNAPSHOTS);

  const candidateMap = new Map<
    string,
    { modelId: SelectedAI; providerName: string; providerSlug: string }
  >();

  for (const snapshot of snapshots) {
    for (const result of snapshot.live?.results ?? []) {
      if (!result.livePairComplete) continue;
      candidateMap.set(providerKey(result.candidate.modelId, result.candidate.providerSlug), {
        modelId: result.candidate.modelId,
        providerName: result.candidate.providerName,
        providerSlug: result.candidate.providerSlug,
      });
    }
  }

  const latest = latestSnapshot(snapshots);
  const candidates: SupplyPromotionEvidence[] = [];

  for (const candidate of candidateMap.values()) {
    if (!latest?.report.activeModelIds.includes(candidate.modelId)) continue;
    const marketRows = snapshots
      .map((snapshot) => ({
        snapshot,
        endpoint: matchingMarketEndpoint(
          snapshot,
          candidate.modelId,
          candidate.providerSlug
        ),
      }))
      .filter((row) => isMarketQualified(row.endpoint));

    const allLiveRows = snapshots.flatMap((snapshot) =>
      (snapshot.live?.results ?? [])
        .filter(
          (result) =>
            result.candidate.modelId === candidate.modelId &&
            result.candidate.providerSlug === candidate.providerSlug
        )
        .map((result) => ({ snapshot, result }))
    );
    const completeLiveRows = allLiveRows.filter((row) => row.result.livePairComplete);
    const incompleteLiveRows = allLiveRows.filter(
      (row) => !row.result.livePairComplete
    );

    const latestEndpoint = latest
      ? matchingMarketEndpoint(latest, candidate.modelId, candidate.providerSlug)
      : null;
    const marketSpan = spanDays(
      marketRows.map((row) => row.snapshot.report.generatedAt)
    );
    const liveSpan = spanDays(
      completeLiveRows.map(
        (row) => row.snapshot.live?.generatedAt ?? row.snapshot.report.generatedAt
      )
    );
    const ratios = comparisonRatios({
      snapshots,
      modelId: candidate.modelId,
      providerSlug: candidate.providerSlug,
    });
    const worstTotalRatio = ratios.total.length ? Math.max(...ratios.total) : null;
    const worstTtftRatio = ratios.ttft.length ? Math.max(...ratios.ttft) : null;
    const worstObservedCostDelta =
      ratios.observedCostDelta.length > 0
        ? Math.max(...ratios.observedCostDelta)
        : null;
    const testedServiceTier =
      ratios.testedServiceTiers.length > 0
        ? ratios.testedServiceTiers.at(-1) ?? null
        : null;
    const currentServiceTier =
      ratios.currentServiceTiers.length > 0
        ? ratios.currentServiceTiers.at(-1) ?? null
        : null;

    let status: SupplyPromotionStatus = "PROMOTION_READY";
    const reasons: string[] = [];

    if (!isMarketQualified(latestEndpoint)) {
      status = "CURRENT_MARKET_GATE_FAILED";
      reasons.push("latest_market_snapshot_no_longer_passes_price_and_stability_gate");
    } else if (
      marketRows.length < MAIN_RP_SUPPLY_PROMOTION_REQUIRED_MARKET_SNAPSHOTS
    ) {
      status = "INSUFFICIENT_MARKET_HISTORY";
      reasons.push(
        `market_snapshots=${marketRows.length}/${MAIN_RP_SUPPLY_PROMOTION_REQUIRED_MARKET_SNAPSHOTS}`
      );
    } else if (
      marketSpan < MAIN_RP_SUPPLY_PROMOTION_REQUIRED_MARKET_SPAN_DAYS
    ) {
      status = "MARKET_HISTORY_SPAN_TOO_SHORT";
      reasons.push(
        `market_span_days=${marketSpan.toFixed(1)}/${MAIN_RP_SUPPLY_PROMOTION_REQUIRED_MARKET_SPAN_DAYS}`
      );
    } else if (incompleteLiveRows.length > 0) {
      status = "LIVE_REGRESSION_OBSERVED";
      reasons.push(`incomplete_live_pairs=${incompleteLiveRows.length}`);
    } else if (
      completeLiveRows.length < MAIN_RP_SUPPLY_PROMOTION_REQUIRED_LIVE_PAIRS
    ) {
      status = "INSUFFICIENT_LIVE_HISTORY";
      reasons.push(
        `complete_live_pairs=${completeLiveRows.length}/${MAIN_RP_SUPPLY_PROMOTION_REQUIRED_LIVE_PAIRS}`
      );
    } else if (
      liveSpan < MAIN_RP_SUPPLY_PROMOTION_REQUIRED_LIVE_SPAN_DAYS
    ) {
      status = "LIVE_HISTORY_SPAN_TOO_SHORT";
      reasons.push(
        `live_span_days=${liveSpan.toFixed(1)}/${MAIN_RP_SUPPLY_PROMOTION_REQUIRED_LIVE_SPAN_DAYS}`
      );
    } else if (
      ratios.missing > 0 ||
      worstTotalRatio == null ||
      worstTtftRatio == null
    ) {
      status = "BASELINE_COMPARISON_MISSING";
      reasons.push("successful_live_pair_missing_current_baseline_comparison");
    } else if (ratios.routeParityMismatch > 0) {
      status = "DEPLOY_ROUTE_PARITY_UNPROVEN";
      reasons.push(
        `service_tier_mismatch_count=${ratios.routeParityMismatch}`
      );
    } else if (
      ratios.currentOpenRouterComparisons > 0 &&
      (worstObservedCostDelta == null ||
        worstObservedCostDelta > -MAIN_RP_SUPPLY_LIVE_MIN_RAW_RATE_SAVINGS)
    ) {
      status = "OBSERVED_COST_SAVINGS_UNPROVEN";
      reasons.push(
        `worst_observed_cost_delta=${worstObservedCostDelta == null ? "missing" : worstObservedCostDelta.toFixed(3)} required<=-${MAIN_RP_SUPPLY_LIVE_MIN_RAW_RATE_SAVINGS}`
      );
    } else if (
      worstTotalRatio > MAIN_RP_SUPPLY_PROMOTION_MAX_TOTAL_TIME_RATIO ||
      worstTtftRatio > MAIN_RP_SUPPLY_PROMOTION_MAX_TTFT_RATIO
    ) {
      status = "PERFORMANCE_REGRESSION";
      reasons.push(
        `worst_total_ratio=${worstTotalRatio.toFixed(3)} max=${MAIN_RP_SUPPLY_PROMOTION_MAX_TOTAL_TIME_RATIO}`
      );
      reasons.push(
        `worst_ttft_ratio=${worstTtftRatio.toFixed(3)} max=${MAIN_RP_SUPPLY_PROMOTION_MAX_TTFT_RATIO}`
      );
    } else {
      reasons.push("time_separated_market_history_passed");
      reasons.push("repeated_canonical_live_pairs_passed");
      reasons.push("candidate_not_slower_than_current_baseline");
    }

    candidates.push({
      ...candidate,
      status,
      qualifyingMarketSnapshots: marketRows.length,
      marketObservationSpanDays: marketSpan,
      completeLivePairs: completeLiveRows.length,
      incompleteLivePairs: incompleteLiveRows.length,
      liveObservationSpanDays: liveSpan,
      latestSavingsPercent:
        latestEndpoint?.rawEndpointRateDeltaVsCurrentProcurementPercent == null
          ? null
          : -latestEndpoint.rawEndpointRateDeltaVsCurrentProcurementPercent * 100,
      latestMarketLatencyP50Seconds:
        latestEndpoint?.latencyP50SecondsLast30m ?? null,
      latestMarketThroughputP50TokensPerSecond:
        latestEndpoint?.throughputP50TokensPerSecondLast30m ?? null,
      latestMarketUptime1dPercent: latestEndpoint?.uptimeLast1dPercent ?? null,
      latestMarketUptime30mPercent: latestEndpoint?.uptimeLast30mPercent ?? null,
      worstCandidateTotalVsBaselineRatio: worstTotalRatio,
      worstCandidateTtftVsBaselineRatio: worstTtftRatio,
      worstObservedCostDeltaVsCurrentPercent: worstObservedCostDelta,
      testedServiceTier,
      currentServiceTier,
      reasons,
    });
  }

  candidates.sort((a, b) => {
    if (a.modelId !== b.modelId) return a.modelId.localeCompare(b.modelId);
    return a.providerSlug.localeCompare(b.providerSlug);
  });

  return {
    version: MAIN_RP_SUPPLY_PROMOTION_HISTORY_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    snapshotsExamined: snapshots.length,
    candidates,
    promotionReadyCount: candidates.filter(
      (candidate) => candidate.status === "PROMOTION_READY"
    ).length,
    notes: [
      "PROMOTION_READY is evidence readiness only; it never mutates production routing.",
      "Four qualifying market snapshots spanning >=21 days are required.",
      "Two complete canonical two-turn live pairs spanning >=14 days are required.",
      "Any recorded incomplete live pair for the same candidate blocks promotion until the history window moves past it.",
      "Candidate total response time must not exceed the current baseline and TTFT may be at most 1.25x the current baseline.",
      "Same-OpenRouter promotion additionally requires exact service-tier parity and >=10% observed total_cost savings on every successful comparison.",
      "Direct suppliers without dedicated benchmark credentials are not eligible for this OpenRouter live-history gate.",
      "Production cutover remains a separate canary/rollback change.",
    ],
  };
}

function n(value: number | null, digits = 2): string {
  return value == null ? "n/a" : value.toFixed(digits);
}

export function renderMainRpSupplyPromotionHistoryMarkdown(
  report: MainRpSupplyPromotionHistoryReport
): string {
  const lines = [
    "# Main RP Supply Promotion History",
    "",
    `- snapshots examined: **${report.snapshotsExamined}**`,
    `- promotion ready: **${report.promotionReadyCount}**`,
    "",
    "| Model | Provider | Status | Market samples/span | Live complete/fail/span | Market savings | Tier tested/current | Worst observed cost Δ | Latency | TPS | Uptime 1d/30m | Worst total ratio | Worst TTFT ratio |",
    "|---|---|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const row of report.candidates) {
    lines.push(
      `| ${row.modelId} | ${row.providerName} | ${row.status} | ${row.qualifyingMarketSnapshots} / ${n(row.marketObservationSpanDays, 1)}d | ${row.completeLivePairs} / ${row.incompleteLivePairs} / ${n(row.liveObservationSpanDays, 1)}d | ${n(row.latestSavingsPercent, 1)}% | ${row.testedServiceTier ?? "default"} / ${row.currentServiceTier ?? "default"} | ${row.worstObservedCostDeltaVsCurrentPercent == null ? "n/a" : n(row.worstObservedCostDeltaVsCurrentPercent * 100, 1) + "%"} | ${n(row.latestMarketLatencyP50Seconds, 3)}s | ${n(row.latestMarketThroughputP50TokensPerSecond, 1)} | ${n(row.latestMarketUptime1dPercent, 2)}% / ${n(row.latestMarketUptime30mPercent, 2)}% | ${n(row.worstCandidateTotalVsBaselineRatio, 3)} | ${n(row.worstCandidateTtftVsBaselineRatio, 3)} |`
    );
  }

  if (!report.candidates.length) {
    lines.push("| — | — | no successful live candidate history yet | — | — | — | — | — | — | — | — | — | — |");
  }

  lines.push("", "## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
