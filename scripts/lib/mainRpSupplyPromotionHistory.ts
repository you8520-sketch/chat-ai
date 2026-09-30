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
  | "CACHE_REGRESSION"
  | "OBSERVED_COST_EVIDENCE_MISSING"
  | "OBSERVED_COST_REGRESSION"
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
  worstObservedCostVsBaselineRatio: number | null;
  cacheRegressionObservations: number;
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

function comparisonEvidence(input: {
  snapshots: SupplyHistorySnapshot[];
  modelId: SelectedAI;
  providerSlug: string;
}): {
  total: number[];
  ttft: number[];
  sameOpenRouterObservedCost: number[];
  missing: number;
  sameOpenRouterCostMissing: number;
  cacheRegressions: number;
} {
  const total: number[] = [];
  const ttft: number[] = [];
  const sameOpenRouterObservedCost: number[] = [];
  let missing = 0;
  let sameOpenRouterCostMissing = 0;
  let cacheRegressions = 0;

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
      !row.currentBaselinePairComplete ||
      row.candidateAverageTotalSeconds == null ||
      row.currentBaselineAverageTotalSeconds == null ||
      row.candidateAverageTtftSeconds == null ||
      row.currentBaselineAverageTtftSeconds == null ||
      row.currentBaselineAverageTotalSeconds <= 0 ||
      row.currentBaselineAverageTtftSeconds <= 0
    ) {
      missing += 1;
      continue;
    }

    total.push(
      row.candidateAverageTotalSeconds / row.currentBaselineAverageTotalSeconds
    );
    ttft.push(
      row.candidateAverageTtftSeconds / row.currentBaselineAverageTtftSeconds
    );

    if (row.currentBaselineProvider === "openrouter") {
      if (
        row.currentBaselineSecondTurnCacheReadObserved &&
        !row.candidateSecondTurnCacheReadObserved
      ) {
        cacheRegressions += 1;
      }

      if (
        row.candidateObservedProviderCostUsd == null ||
        row.currentBaselineObservedProviderCostUsd == null ||
        row.currentBaselineObservedProviderCostUsd <= 0
      ) {
        sameOpenRouterCostMissing += 1;
      } else {
        sameOpenRouterObservedCost.push(
          row.candidateObservedProviderCostUsd /
            row.currentBaselineObservedProviderCostUsd
        );
      }
    }
  }

  return {
    total,
    ttft,
    sameOpenRouterObservedCost,
    missing,
    sameOpenRouterCostMissing,
    cacheRegressions,
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
    const comparison = comparisonEvidence({
      snapshots,
      modelId: candidate.modelId,
      providerSlug: candidate.providerSlug,
    });
    const worstTotalRatio = comparison.total.length
      ? Math.max(...comparison.total)
      : null;
    const worstTtftRatio = comparison.ttft.length
      ? Math.max(...comparison.ttft)
      : null;
    const worstObservedCostRatio = comparison.sameOpenRouterObservedCost.length
      ? Math.max(...comparison.sameOpenRouterObservedCost)
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
      comparison.missing > 0 ||
      worstTotalRatio == null ||
      worstTtftRatio == null
    ) {
      status = "BASELINE_COMPARISON_MISSING";
      reasons.push("successful_live_pair_missing_current_baseline_comparison");
    } else if (comparison.cacheRegressions > 0) {
      status = "CACHE_REGRESSION";
      reasons.push(
        `current_route_cache_hit_but_candidate_missed=${comparison.cacheRegressions}`
      );
    } else if (comparison.sameOpenRouterCostMissing > 0) {
      status = "OBSERVED_COST_EVIDENCE_MISSING";
      reasons.push(
        `same_openrouter_cost_comparisons_missing=${comparison.sameOpenRouterCostMissing}`
      );
    } else if (
      worstObservedCostRatio != null &&
      worstObservedCostRatio > 1
    ) {
      status = "OBSERVED_COST_REGRESSION";
      reasons.push(
        `worst_observed_cost_ratio=${worstObservedCostRatio.toFixed(3)} max=1`
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
      worstObservedCostVsBaselineRatio: worstObservedCostRatio,
      cacheRegressionObservations: comparison.cacheRegressions,
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
      "For same-OpenRouter transitions, observed provider cost must be present and no higher than the actual current OpenRouter baseline in every successful comparison.",
      "If the current OpenRouter baseline observes second-turn prompt-cache read, the candidate must preserve it.",
      "Cross-provider observed cost values are not directly compared because provider billing semantics can differ.",
      "Direct suppliers without dedicated benchmark credentials are not eligible for this OpenRouter live-history gate."
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
    "| Model | Provider | Status | Market samples/span | Live complete/fail/span | Savings | Latency | TPS | Uptime 1d/30m | Worst total ratio | Worst TTFT ratio |",
    "|---|---|---|---|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const row of report.candidates) {
    lines.push(
      `| ${row.modelId} | ${row.providerName} | ${row.status} | ${row.qualifyingMarketSnapshots} / ${n(row.marketObservationSpanDays, 1)}d | ${row.completeLivePairs} / ${row.incompleteLivePairs} / ${n(row.liveObservationSpanDays, 1)}d | ${n(row.latestSavingsPercent, 1)}% | ${n(row.latestMarketLatencyP50Seconds, 3)}s | ${n(row.latestMarketThroughputP50TokensPerSecond, 1)} | ${n(row.latestMarketUptime1dPercent, 2)}% / ${n(row.latestMarketUptime30mPercent, 2)}% | ${n(row.worstCandidateTotalVsBaselineRatio, 3)} | ${n(row.worstCandidateTtftVsBaselineRatio, 3)} |`
    );
  }

  if (!report.candidates.length) {
    lines.push("| — | — | no successful live candidate history yet | — | — | — | — | — | — | — | — |");
  }

  lines.push("", "## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
