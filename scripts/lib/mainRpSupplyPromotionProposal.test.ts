import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";
import type { MainRpSupplyPromotionHistoryReport } from "./mainRpSupplyPromotionHistory";
import {
  buildMainRpSupplyPromotionProposalPacket,
  classifySupplyTransition,
} from "./mainRpSupplyPromotionProposal";

function history(): MainRpSupplyPromotionHistoryReport {
  return {
    version: 1,
    generatedAt: "2026-10-22T00:00:00.000Z",
    snapshotsExamined: 4,
    promotionReadyCount: 2,
    notes: [],
    candidates: [
      {
        modelId: "gemini-3.7-flash",
        providerName: "Alternative Studio",
        providerSlug: "alternative-studio",
        status: "PROMOTION_READY",
        qualifyingMarketSnapshots: 4,
        marketObservationSpanDays: 21,
        completeLivePairs: 2,
        incompleteLivePairs: 0,
        liveObservationSpanDays: 21,
        latestSavingsPercent: 18,
        latestMarketLatencyP50Seconds: 1.1,
        latestMarketThroughputP50TokensPerSecond: 60,
        latestMarketUptime1dPercent: 99.95,
        latestMarketUptime30mPercent: 100,
        worstCandidateTotalVsBaselineRatio: 0.82,
        worstCandidateTtftVsBaselineRatio: 0.9,
        reasons: [],
      },
      {
        modelId: "deepseek-v4.1-flash",
        providerName: "Wafer",
        providerSlug: "wafer",
        status: "PROMOTION_READY",
        qualifyingMarketSnapshots: 4,
        marketObservationSpanDays: 21,
        completeLivePairs: 2,
        incompleteLivePairs: 0,
        liveObservationSpanDays: 21,
        latestSavingsPercent: 17.3,
        latestMarketLatencyP50Seconds: 0.8,
        latestMarketThroughputP50TokensPerSecond: 44,
        latestMarketUptime1dPercent: 99.9,
        latestMarketUptime30mPercent: 99.95,
        worstCandidateTotalVsBaselineRatio: 0.5,
        worstCandidateTtftVsBaselineRatio: 0.8,
        reasons: [],
      },
    ],
  };
}

function radar(): MainRpSupplyRadarReport {
  return {
    version: 1,
    generatedAt: "2026-10-22T00:00:00.000Z",
    status: "OK",
    providerGenerationCalls: 0,
    activeModelIds: ["deepseek-v4.1-flash", "gemini-3.7-flash"],
    credentialSource: "fixture",
    currentProcurementEvidence: "registry_route_evidence",
    marketEvidence: "openrouter_endpoint_metrics",
    notes: [],
    models: [
      {
        modelId: "deepseek-v4.1-flash",
        label: "DeepSeek V4.1 Flash",
        openRouterSlug: "deepseek/deepseek-v4.1-flash",
        currentProcurement: {
          provider: "cheaperinference",
          evidenceSource: "cheaperinference_catalog",
          modelId: "deepseek-v4.1-flash",
          inputUsdPerMillion: 0.15,
          outputUsdPerMillion: 0.6,
          cacheReadUsdPerMillion: 0.003,
          cacheWriteUsdPerMillion: null,
          cacheCapabilityAdvertised: true,
          pricingVersion: "fixture",
          pricingCheckedAt: null,
          pricingUpdatedAt: null,
        },
        endpointCount: 0,
        providersDiscovered: [],
        comparisons: [],
        lowerRawEndpointRateCount: 0,
        publishedMarginRisk: null,
        evidenceFingerprint: "deepseek",
      },
      {
        modelId: "gemini-3.7-flash",
        label: "Gemini 3.7 Flash",
        openRouterSlug: "google/gemini-3.7-flash",
        currentProcurement: {
          provider: "openrouter",
          evidenceSource: "openrouter_endpoint_market",
          modelId: "gemini-3.7-flash",
          inputUsdPerMillion: 0.3,
          outputUsdPerMillion: 1.5,
          cacheReadUsdPerMillion: null,
          cacheWriteUsdPerMillion: null,
          cacheCapabilityAdvertised: false,
          pricingVersion: null,
          pricingCheckedAt: null,
          pricingUpdatedAt: null,
        },
        endpointCount: 0,
        providersDiscovered: [],
        comparisons: [],
        lowerRawEndpointRateCount: 0,
        publishedMarginRisk: null,
        evidenceFingerprint: "gemini",
      },
    ],
  };
}

describe("Main RP supply promotion proposal packet", () => {
  it("allows only same-OpenRouter transport evidence to proceed toward a Draft route PR", () => {
    const packet = buildMainRpSupplyPromotionProposalPacket({
      history: history(),
      radar: radar(),
      generatedAt: "2026-10-22T00:00:00.000Z",
    });

    assert.equal(packet.proposals.length, 2);
    assert.equal(packet.draftRoutePrEligibleCount, 1);
    assert.equal(packet.crossProviderReviewRequiredCount, 1);
    assert.equal(packet.automaticMergeEligibleCount, 0);

    const gemini = packet.proposals.find(
      (row) => row.modelId === "gemini-3.7-flash"
    )!;
    assert.equal(gemini.transitionKind, "SAME_OPENROUTER_TRANSPORT");
    assert.equal(gemini.draftRoutePrEligible, true);
    assert.equal(gemini.stopReason, null);
    assert.equal(gemini.automaticMergeEligible, false);
    assert.deepEqual(gemini.proposedRoute, {
      providerSlug: "alternative-studio",
      providerLabel: "Alternative Studio",
      serviceTier: null,
    });

    const deepseek = packet.proposals.find(
      (row) => row.modelId === "deepseek-v4.1-flash"
    )!;
    assert.equal(deepseek.transitionKind, "CROSS_PROVIDER_PROCUREMENT");
    assert.equal(deepseek.draftRoutePrEligible, false);
    assert.equal(deepseek.proposedRoute, null);
    assert.match(deepseek.stopReason ?? "", /billing_path_changes/);
  });

  it("fails closed when current procurement cannot be resolved", () => {
    const classification = classifySupplyTransition({ currentProvider: null });
    assert.equal(classification.kind, "UNKNOWN_CURRENT_PROCUREMENT");
    assert.equal(classification.draftRoutePrEligible, false);
    assert.match(classification.stopReason ?? "", /unresolved/);
  });

  it("ignores candidates that have not reached PROMOTION_READY", () => {
    const h = history();
    h.candidates[0] = {
      ...h.candidates[0]!,
      status: "INSUFFICIENT_LIVE_HISTORY",
    };
    h.promotionReadyCount = 1;

    const packet = buildMainRpSupplyPromotionProposalPacket({
      history: h,
      radar: radar(),
    });
    assert.deepEqual(
      packet.proposals.map((row) => row.modelId),
      ["deepseek-v4.1-flash"]
    );
  });
});
