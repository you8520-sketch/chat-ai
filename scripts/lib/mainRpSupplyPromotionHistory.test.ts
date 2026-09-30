import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SelectedAI } from "@/lib/chatModels";
import type { SupplyComparison } from "./mainRpSupplyRadar";
import type { SupplyLiveCandidateResult } from "./mainRpSupplyLiveQualification";
import {
  evaluateMainRpSupplyPromotionHistory,
  type SupplyHistorySnapshot,
} from "./mainRpSupplyPromotionHistory";

const DEEPSEEK: SelectedAI = "deepseek-v4.1-flash";
const GEMINI: SelectedAI = "gemini-3.7-flash";
const CANDIDATE_PROVIDER = "wafer";

function iso(day: number): string {
  return new Date(Date.UTC(2026, 8, 1 + day, 0, 0, 0)).toISOString();
}

function openRouterSlug(modelId: SelectedAI): string {
  if (modelId === GEMINI) return "google/gemini-3.7-flash";
  return "deepseek/deepseek-v4.1-flash";
}

function endpoint(
  modelId: SelectedAI,
  overrides: Partial<SupplyComparison> = {}
): SupplyComparison {
  return {
    modelId,
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
      slug: CANDIDATE_PROVIDER,
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

function candidateResult(input: {
  modelId: SelectedAI;
  complete: boolean;
  cacheRead?: boolean;
}): SupplyLiveCandidateResult {
  return {
    candidate: {
      modelId: input.modelId,
      openRouterSlug: openRouterSlug(input.modelId),
      providerName: "Wafer",
      providerSlug: CANDIDATE_PROVIDER,
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
    providerGenerationCalls: input.complete ? 2 : 1,
    livePairComplete: input.complete,
    secondTurnCacheReadObserved: input.cacheRead ?? false,
    transportStatus: input.complete ? "PAIR_COMPLETE" : "PAIR_INCOMPLETE",
    interpretation: [],
  };
}

function snapshot(input: {
  day: number;
  modelId?: SelectedAI;
  currentProvider?: "cheaperinference" | "openrouter";
  live?: "complete" | "incomplete" | null;
  endpointOverrides?: Partial<SupplyComparison>;
  candidateTotal?: number;
  baselineTotal?: number;
  candidateTtft?: number;
  baselineTtft?: number;
  candidateCost?: number | null;
  baselineCost?: number | null;
  candidateCache?: boolean;
  baselineCache?: boolean;
}): SupplyHistorySnapshot {
  const modelId = input.modelId ?? DEEPSEEK;
  const currentProvider = input.currentProvider ?? "cheaperinference";
  const when = iso(input.day);
  const liveResult =
    input.live == null
      ? null
      : candidateResult({
          modelId,
          complete: input.live === "complete",
          cacheRead: input.candidateCache,
        });
  const currentProviderName =
    currentProvider === "openrouter" ? "Google AI Studio" : "CheaperInference";
  const currentProviderSlug =
    currentProvider === "openrouter" ? "google-ai-studio" : null;

  return {
    runId: `run-${modelId}-${input.day}`,
    report: {
      version: 1,
      generatedAt: when,
      status: "OK",
      providerGenerationCalls: 0,
      activeModelIds: [modelId],
      credentialSource: "fixture",
      currentProcurementEvidence: "registry_route_evidence",
      marketEvidence: "openrouter_endpoint_metrics",
      notes: [],
      models: [
        {
          modelId,
          label: modelId,
          openRouterSlug: openRouterSlug(modelId),
          currentProcurement: {
            provider: currentProvider,
            evidenceSource:
              currentProvider === "openrouter"
                ? "openrouter_endpoint_market"
                : "cheaperinference_catalog",
            modelId,
            inputUsdPerMillion: 0.15,
            outputUsdPerMillion: 0.6,
            cacheReadUsdPerMillion: 0.003,
            cacheWriteUsdPerMillion: null,
            cacheCapabilityAdvertised: true,
            pricingVersion: currentProvider === "openrouter" ? null : "fixture",
            pricingCheckedAt: when,
            pricingUpdatedAt: when,
          },
          endpointCount: 1,
          providersDiscovered: ["Wafer"],
          comparisons: [endpoint(modelId, input.endpointOverrides)],
          lowerRawEndpointRateCount: 1,
          publishedMarginRisk: null,
          evidenceFingerprint: `fp-${modelId}-${input.day}`,
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
            activeModelIds: [modelId],
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
                modelId,
                candidateProviderName: "Wafer",
                candidateProviderSlug: CANDIDATE_PROVIDER,
                currentBaselineProvider: currentProvider,
                currentBaselineProviderName: currentProviderName,
                currentBaselineProviderSlug: currentProviderSlug,
                candidatePairComplete: true,
                currentBaselinePairComplete: true,
                candidateSecondTurnCacheReadObserved:
                  input.candidateCache ?? false,
                currentBaselineSecondTurnCacheReadObserved:
                  input.baselineCache ?? false,
                candidateAverageTtftSeconds: input.candidateTtft ?? 1,
                currentBaselineAverageTtftSeconds: input.baselineTtft ?? 1.5,
                candidateAverageTotalSeconds: input.candidateTotal ?? 10,
                currentBaselineAverageTotalSeconds: input.baselineTotal ?? 20,
                candidateObservedProviderCostUsd:
                  input.candidateCost === undefined ? 0.01 : input.candidateCost,
                currentBaselineObservedProviderCostUsd:
                  input.baselineCost === undefined ? 0.02 : input.baselineCost,
                candidateEstimatedPairRawEndpointRateUsd: 0.01,
                currentBaselineEstimatedPairRateUsd: 0.016,
                marketRawEndpointRateDeltaVsCurrentBaselinePercent: -0.2,
              },
            ],
            notes: [],
          },
  };
}

function durableSnapshots(
  overrides: Partial<Parameters<typeof snapshot>[0]> = {}
): SupplyHistorySnapshot[] {
  return [
    snapshot({ day: 0, live: "complete", ...overrides }),
    snapshot({ day: 7, ...overrides, live: null }),
    snapshot({ day: 14, ...overrides, live: null }),
    snapshot({ day: 21, live: "complete", ...overrides }),
  ];
}

describe("Main RP supplier promotion history gate", () => {
  it("requires time-separated market evidence and repeated live proof before PROMOTION_READY", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: durableSnapshots(),
      generatedAt: iso(21),
    });
    const row = report.candidates[0]!;
    assert.equal(report.promotionReadyCount, 1);
    assert.equal(row.status, "PROMOTION_READY");
    assert.equal(row.qualifyingMarketSnapshots, 4);
    assert.equal(row.marketObservationSpanDays, 21);
    assert.equal(row.completeLivePairs, 2);
    assert.equal(row.incompleteLivePairs, 0);
    assert.equal(row.liveObservationSpanDays, 21);
  });

  it("fails closed when the latest market snapshot no longer passes stability", () => {
    const snapshots = durableSnapshots();
    snapshots[3] = snapshot({
      day: 21,
      live: "complete",
      endpointOverrides: { uptimeLast1dPercent: 99.1 },
    });
    const report = evaluateMainRpSupplyPromotionHistory({ snapshots });
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
      snapshots: durableSnapshots({
        candidateTotal: 25,
        baselineTotal: 20,
      }),
    });
    const row = report.candidates[0]!;
    assert.equal(row.status, "PERFORMANCE_REGRESSION");
    assert.ok((row.worstCandidateTotalVsBaselineRatio ?? 0) > 1);
  });

  it("requires same-OpenRouter observed cost evidence on every successful live proof", () => {
    const snapshots = durableSnapshots({
      modelId: GEMINI,
      currentProvider: "openrouter",
    });
    snapshots[3] = snapshot({
      day: 21,
      modelId: GEMINI,
      currentProvider: "openrouter",
      live: "complete",
      candidateCost: null,
      baselineCost: 0.02,
    });
    const report = evaluateMainRpSupplyPromotionHistory({ snapshots });
    assert.equal(
      report.candidates[0]!.status,
      "OBSERVED_COST_EVIDENCE_MISSING"
    );
  });

  it("blocks same-OpenRouter promotion when actual observed candidate cost exceeds the current route", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: durableSnapshots({
        modelId: GEMINI,
        currentProvider: "openrouter",
        candidateCost: 0.021,
        baselineCost: 0.02,
      }),
    });
    const row = report.candidates[0]!;
    assert.equal(row.status, "OBSERVED_COST_REGRESSION");
    assert.ok((row.worstObservedCostVsBaselineRatio ?? 0) > 1);
  });

  it("blocks same-OpenRouter promotion when current route cache reuse disappears on the candidate", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: durableSnapshots({
        modelId: GEMINI,
        currentProvider: "openrouter",
        baselineCache: true,
        candidateCache: false,
      }),
    });
    const row = report.candidates[0]!;
    assert.equal(row.status, "CACHE_REGRESSION");
    assert.equal(row.cacheRegressionObservations, 2);
  });

  it("allows same-OpenRouter promotion when actual cost is lower and cache parity is preserved", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: durableSnapshots({
        modelId: GEMINI,
        currentProvider: "openrouter",
        candidateCost: 0.015,
        baselineCost: 0.02,
        baselineCache: true,
        candidateCache: true,
      }),
    });
    const row = report.candidates[0]!;
    assert.equal(row.status, "PROMOTION_READY");
    assert.equal(row.worstObservedCostVsBaselineRatio, 0.75);
    assert.equal(row.cacheRegressionObservations, 0);
  });

  it("does not directly compare cross-provider observed costs with different billing semantics", () => {
    const report = evaluateMainRpSupplyPromotionHistory({
      snapshots: durableSnapshots({
        currentProvider: "cheaperinference",
        candidateCost: 0.5,
        baselineCost: 0.01,
      }),
    });
    assert.equal(report.candidates[0]!.status, "PROMOTION_READY");
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
