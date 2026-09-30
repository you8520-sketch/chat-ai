import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SelectedAI } from "@/lib/chatModels";
import type { SupplyComparison } from "./mainRpSupplyRadar";
import type { SupplyLiveCandidateResult } from "./mainRpSupplyLiveQualification";
import {
  evaluateMainRpSupplyPromotionHistory,
  type SupplyHistorySnapshot,
} from "./mainRpSupplyPromotionHistory";

const MODEL: SelectedAI = "deepseek-v4.1-flash";
const PROVIDER = "wafer";

function iso(day: number): string {
  return new Date(Date.UTC(2026, 8, 1 + day, 0, 0, 0)).toISOString();
}

function endpoint(overrides: Partial<SupplyComparison> = {}): SupplyComparison {
  return {
    modelId: MODEL,
    providerName: "Wafer",
    providerTag: null,
    quantization: null,
    contextLength: 128_000,
    maxPromptTokens: 120_000,
    maxCompletionTokens: 8_192,
    inputUsdPerMillion: 0.0833,
    outputUsdPerMillion: 0.7,
    cacheReadUsdPerMillion: 0.045,
    cacheWriteUsdPerMillion: null,
    supportsImplicitCaching: true,
    latencyP50SecondsLast30m: 0.8,
    throughputP50TokensPerSecondLast30m: 44,
    uptimeLast1dPercent: 99.9,
    uptimeLast30mPercent: 99.95,
    status: 0,
    supportedParameters: ["temperature", "reasoning"],
    provider: {
      name: "Wafer",
      slug: PROVIDER,
      headquarters: null,
      privacyPolicyUrl: "https://example.test/privacy",
      termsOfServiceUrl: "https://example.test/terms",
      statusPageUrl: "https://example.test/status",
      datacenters: [],
    },
    rawEndpointRepresentativeUncachedRateUsd: 0.01,
    currentRepresentativeUncachedProcurementUsd: 0.016,
    rawEndpointRateDeltaVsCurrentProcurementPercent: -0.2,
    inputPriceDeltaPercent: -0.2,
    outputPriceDeltaPercent: -0.2,
    cacheReadPriceDeltaPercent: null,
    lowerRawEndpointRateThanCurrentProcurement: true,
    evidenceFlags: [],
    ...overrides,
  };
}

function candidateResult(complete: boolean): SupplyLiveCandidateResult {
  return {
    candidate: {
      modelId: MODEL,
      openRouterSlug: "deepseek/deepseek-v4.1-flash",
      providerName: "Wafer",
      providerSlug: PROVIDER,
      quantization: null,
      rawEndpointRateDeltaVsCurrentProcurementPercent: -0.2,
      inputUsdPerMillion: 0.0833,
      outputUsdPerMillion: 0.7,
      cacheReadUsdPerMillion: 0.045,
      marketLatencyP50SecondsLast30m: 0.8,
      marketThroughputP50TokensPerSecondLast30m: 44,
      marketUptimeLast1dPercent: 99.9,
      marketUptimeLast30mPercent: 99.95,
      controlEffort: "none",
      excludeReasoning: true,
      estimatedPairRawEndpointRateUsd: 0.01,
    },
    turns: [],
    providerGenerationCalls: complete ? 2 : 1,
    livePairComplete: complete,
    secondTurnCacheReadObserved: false,
    transportStatus: complete ? "PAIR_COMPLETE" : "PAIR_INCOMPLETE",
    interpretation: [],
  };
}

function snapshot(input: {
  day: number;
  live?: "complete" | "incomplete" | null;
  endpointOverrides?: Partial<SupplyComparison>;
  candidateTotal?: number;
  baselineTotal?: number;
  candidateTtft?: number;
  baselineTtft?: number;
}): SupplyHistorySnapshot {
  const when = iso(input.day);
  const liveResult =
    input.live == null ? null : candidateResult(input.live === "complete");
  return {
    runId: `run-${input.day}`,
    report: {
      version: 1,
      generatedAt: when,
      status: "OK",
      providerGenerationCalls: 0,
      activeModelIds: [MODEL],
      credentialSource: "fixture",
      currentProcurementEvidence: "registry_route_evidence",
      marketEvidence: "openrouter_endpoint_metrics",
      notes: [],
      models: [
        {
          modelId: MODEL,
          label: "DeepSeek V4.1 Flash",
          openRouterSlug: "deepseek/deepseek-v4.1-flash",
          currentProcurement: {
            provider: "cheaperinference",
            evidenceSource: "cheaperinference_catalog",
            modelId: MODEL,
            inputUsdPerMillion: 0.15,
            outputUsdPerMillion: 0.6,
            cacheReadUsdPerMillion: 0.003,
            cacheWriteUsdPerMillion: null,
            cacheCapabilityAdvertised: true,
            pricingVersion: "fixture",
            pricingCheckedAt: when,
            pricingUpdatedAt: when,
          },
          endpointCount: 1,
          providersDiscovered: ["Wafer"],
          comparisons: [endpoint(input.endpointOverrides)],
          lowerRawEndpointRateCount: 1,
          publishedMarginRisk: null,
          evidenceFingerprint: `fp-${input.day}`,
        },
      ],
    },
    live:
      liveResult == null
        ? null
        : {
            version: 1,
            generatedAt: when,
            status: input.live === "complete" ? "OK" : "PARTIAL",
            providerGenerationCalls: liveResult.providerGenerationCalls,
            maxProviderGenerationCalls: 10,
            activeModelIds: [MODEL],
            selection: {
              candidates: [liveResult.candidate],
              skipped: [],
              maxProviderGenerationCalls: 10,
              estimatedRawEndpointRateUsd: 0.01,
            },
            results: [liveResult],
            notes: [],
          },
    comparison:
      input.live !== "complete"
        ? null
        : {
            version: 1,
            generatedAt: when,
            providerGenerationCalls: 4,
            maxProviderGenerationCalls: 20,
            candidateGenerationCalls: 2,
            currentBaselineGenerationCalls: 2,
            rows: [
              {
                modelId: MODEL,
                candidateProviderName: "Wafer",
                candidateProviderSlug: PROVIDER,
                currentProvider: "cheaperinference",
                currentProviderName: "CheaperInference",
                currentProviderSlug: null,
                currentServiceTier: null,
                candidatePairComplete: true,
                currentBaselinePairComplete: true,
                candidateSecondTurnCacheReadObserved: false,
                currentBaselineSecondTurnCacheReadObserved: false,
                candidateAverageTtftSeconds: input.candidateTtft ?? 1,
                currentBaselineAverageTtftSeconds: input.baselineTtft ?? 1.5,
                candidateAverageTotalSeconds: input.candidateTotal ?? 10,
                currentBaselineAverageTotalSeconds: input.baselineTotal ?? 20,
                candidateObservedProviderCostUsd: 0.01,
                currentBaselineObservedProviderCostUsd: 0.02,
                candidateEstimatedPairRawEndpointRateUsd: 0.01,
                currentBaselineEstimatedPairRateUsd: 0.016,
                marketRawEndpointRateDeltaVsCurrentBaselinePercent: -0.2,
              },
            ],
            notes: [],
          },
  };
}

describe("Main RP supplier promotion history gate", () => {
  it("requires time-separated market evidence and repeated live proof before PROMOTION_READY", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: [
        snapshot({ day: 0, live: "complete" }),
        snapshot({ day: 7 }),
        snapshot({ day: 14 }),
        snapshot({ day: 21, live: "complete" }),
      ],
      generatedAt: iso(21),
    });

    assert.equal(report.promotionReadyCount, 1);
    const row = report.candidates[0]!;
    assert.equal(row.status, "PROMOTION_READY");
    assert.equal(row.qualifyingMarketSnapshots, 4);
    assert.equal(row.marketObservationSpanDays, 21);
    assert.equal(row.completeLivePairs, 2);
    assert.equal(row.incompleteLivePairs, 0);
    assert.equal(row.liveObservationSpanDays, 21);
  });

  it("fails closed when the latest market snapshot no longer passes stability", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: [
        snapshot({ day: 0, live: "complete" }),
        snapshot({ day: 7 }),
        snapshot({ day: 14 }),
        snapshot({
          day: 21,
          live: "complete",
          endpointOverrides: { uptimeLast1dPercent: 99.1 },
        }),
      ],
    });
    assert.equal(report.candidates[0]!.status, "CURRENT_MARKET_GATE_FAILED");
  });

  it("does not forgive a factual live incompletion inside the observed history", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: [
        snapshot({ day: 0, live: "complete" }),
        snapshot({ day: 7 }),
        snapshot({ day: 14, live: "incomplete" }),
        snapshot({ day: 21, live: "complete" }),
      ],
    });
    const row = report.candidates[0]!;
    assert.equal(row.status, "LIVE_REGRESSION_OBSERVED");
    assert.equal(row.incompleteLivePairs, 1);
  });

  it("keeps a supplier on HOLD when only one live pair exists", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: [
        snapshot({ day: 0, live: "complete" }),
        snapshot({ day: 7 }),
        snapshot({ day: 14 }),
        snapshot({ day: 21 }),
      ],
    });
    assert.equal(report.candidates[0]!.status, "INSUFFICIENT_LIVE_HISTORY");
  });

  it("does not promote a cheaper stable supplier that is slower than the current baseline", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: [
        snapshot({
          day: 0,
          live: "complete",
          candidateTotal: 25,
          baselineTotal: 20,
        }),
        snapshot({ day: 7 }),
        snapshot({ day: 14 }),
        snapshot({
          day: 21,
          live: "complete",
          candidateTotal: 22,
          baselineTotal: 20,
        }),
      ],
    });
    const row = report.candidates[0]!;
    assert.equal(row.status, "PERFORMANCE_REGRESSION");
    assert.ok((row.worstCandidateTotalVsBaselineRatio ?? 0) > 1);
  });

  it("produces no candidate when there has never been a complete live proof", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: [
        snapshot({ day: 0 }),
        snapshot({ day: 7, live: "incomplete" }),
        snapshot({ day: 14 }),
        snapshot({ day: 21 }),
      ],
    });
    assert.equal(report.candidates.length, 0);
    assert.equal(report.promotionReadyCount, 0);
  });
});
