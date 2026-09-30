import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  type SelectedAI,
} from "@/lib/chatModels";
import type { CatalogPricingEvidence } from "./mainRpMonthlyCacheAudit";
import {
  applyCurrentProcurementBaselineBudgetGuard,
  buildCurrentProcurementBaselineProbeRequest,
  buildSupplyTransportComparisonReport,
  MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS,
  MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_ESTIMATED_USD,
  MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS,
  type CurrentProcurementBaselineResult,
} from "./mainRpSupplyCurrentBaseline";
import {
  buildMainRpSupplyRadarReport,
  type SupplyEndpointEvidence,
} from "./mainRpSupplyRadar";
import {
  buildDeterministicSupplyProbeTurns,
  buildSupplyProbeRequestBody,
  resolveSupplyLiveRequiredProviderParameterKeys,
  selectMainRpSupplyLiveCandidates,
  type SupplyLiveCandidate,
  type SupplyLiveCandidateResult,
  type SupplyLiveTurnResult,
} from "./mainRpSupplyLiveQualification";

function catalog(id: string, input = 0.3, output = 1.2): CatalogPricingEvidence {
  return {
    id,
    input_per_million: input,
    output_per_million: output,
    cache_read_input_per_million: 0.03,
    cache_write_input_per_million: null,
    cacheCapabilityAdvertised: true,
    pricing_version: "fixture-v1",
    pricing_checked_at: "2026-09-30T00:00:00Z",
    pricing_updated_at: "2026-09-30T00:00:00Z",
  };
}

function endpoint(
  modelId: SelectedAI,
  providerName = "FixtureProvider",
  providerSlug = "fixture-provider",
  input = 0.1,
  output = 0.3,
  providerTag: string | null = providerSlug
): SupplyEndpointEvidence {
  return {
    modelId,
    providerName,
    providerTag,
    quantization: modelId.startsWith("deepseek") ? "fp8" : null,
    contextLength: 200_000,
    maxPromptTokens: 190_000,
    maxCompletionTokens: 8_192,
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    cacheReadUsdPerMillion: input / 10,
    cacheWriteUsdPerMillion: null,
    supportsImplicitCaching: true,
    latencyP50SecondsLast30m: 1.2,
    throughputP50TokensPerSecondLast30m: 70,
    uptimeLast1dPercent: 99.9,
    uptimeLast30mPercent: 100,
    status: 0,
    supportedParameters: [
      "reasoning",
      "include_reasoning",
      "max_tokens",
      "temperature",
      "top_p",
      "frequency_penalty",
      "presence_penalty",
      "repetition_penalty",
      "seed",
      "response_format",
      "tools",
      "tool_choice",
      "structured_outputs",
    ],
    provider: {
      name: providerName,
      slug: providerSlug,
      headquarters: "US",
      privacyPolicyUrl: "https://example.com/privacy",
      termsOfServiceUrl: "https://example.com/terms",
      statusPageUrl: "https://example.com/status",
      datacenters: ["US"],
    },
  };
}

function radarReport() {
  const endpointsByModel: Partial<Record<SelectedAI, SupplyEndpointEvidence[]>> = {};
  const ci: Record<string, CatalogPricingEvidence> = {};

  for (const option of MAIN_RP_USER_SELECTABLE_OPTIONS) {
    if (option.provider === "openrouter") {
      endpointsByModel[option.id] = [
        endpoint(
          option.id,
          "Google AI Studio Flex",
          "google-ai-studio",
          0.4,
          1.2,
          "flex"
        ),
        endpoint(option.id, "FixtureProvider", "fixture-provider", 0.1, 0.3),
      ];
    } else {
      endpointsByModel[option.id] = [endpoint(option.id)];
      ci[option.id] = catalog(option.id);
    }
  }

  const report = buildMainRpSupplyRadarReport({
    endpointsByModel,
    ciCatalogByModel: ci,
    credentialSource: "fixture",
    generatedAt: "2026-09-30T00:00:00.000Z",
  });

  // Couple the alternate Gemini endpoint to the actual production request keys.
  for (const modelId of [
    "gemini-3.1-pro-preview",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
  ] as const) {
    const model = report.models.find((row) => row.modelId === modelId);
    const alternate = model?.comparisons.find(
      (row) => row.provider?.slug === "fixture-provider"
    );
    if (!model || !alternate?.provider?.slug) continue;
    const candidate: SupplyLiveCandidate = {
      modelId: model.modelId,
      openRouterSlug: model.openRouterSlug,
      providerName: alternate.providerName,
      providerSlug: alternate.provider.slug,
      quantization: alternate.quantization,
      rawEndpointRateDeltaVsCurrentProcurementPercent:
        alternate.rawEndpointRateDeltaVsCurrentProcurementPercent ?? -0.5,
      inputUsdPerMillion: alternate.inputUsdPerMillion ?? 0.1,
      outputUsdPerMillion: alternate.outputUsdPerMillion ?? 0.3,
      cacheReadUsdPerMillion: alternate.cacheReadUsdPerMillion,
      marketLatencyP50SecondsLast30m:
        alternate.latencyP50SecondsLast30m ?? 1.2,
      marketThroughputP50TokensPerSecondLast30m:
        alternate.throughputP50TokensPerSecondLast30m ?? 70,
      marketUptimeLast1dPercent: alternate.uptimeLast1dPercent ?? 99.9,
      marketUptimeLast30mPercent: alternate.uptimeLast30mPercent ?? 100,
      controlEffort: "low",
      excludeReasoning: true,
      deploymentServiceTier: "flex",
      estimatedPairRawEndpointRateUsd: 0.01,
    };
    alternate.supportedParameters =
      resolveSupplyLiveRequiredProviderParameterKeys(candidate);
  }

  return report;
}

function turn(
  turnNumber: 1 | 2,
  ttft: number,
  total: number,
  cacheRead: number,
  billedCost: number,
  openRouterTotalCost?: number
): SupplyLiveTurnResult {
  return {
    turn: turnNumber,
    httpStatus: 200,
    generationId: "gen",
    resolvedModel: "fixture",
    finishReason: "stop",
    sawDone: true,
    text: "완성된 문장.",
    visibleChars: 7,
    ttftSeconds: ttft,
    totalSeconds: total,
    visibleCharsPerSecondAfterTtft: 5,
    promptTokens: 1000,
    completionTokens: 100,
    reasoningTokens: 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: 0,
    providerReportedCostUsd: billedCost,
    providerMetadata:
      openRouterTotalCost == null
        ? null
        : {
            providerName: "FixtureProvider",
            model: "fixture",
            latencySeconds: ttft,
            generationTimeSeconds: total - ttft,
            nativeTokensCached: cacheRead,
            totalCostUsd: openRouterTotalCost,
            upstreamInferenceCostUsd: billedCost,
          },
    servedProviderMatch: true,
    error: null,
  };
}

describe("current procurement baseline owner", () => {
  it("plans one baseline per model for both CheaperInference and OpenRouter current routes", () => {
    const radar = radarReport();
    const selection = selectMainRpSupplyLiveCandidates(radar);
    const plan = applyCurrentProcurementBaselineBudgetGuard(radar, selection);

    assert.ok(plan.entries.length > 0);
    assert.ok(
      plan.entries.length * 2 <=
        MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS
    );
    assert.ok(
      plan.estimatedCurrentRateUsd <=
        MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_ESTIMATED_USD
    );
    assert.ok(
      plan.entries.some((entry) => entry.currentProvider === "cheaperinference")
    );
    assert.ok(
      plan.entries.some(
        (entry) =>
          entry.currentProvider === "openrouter" &&
          entry.currentProviderSlug === "google-ai-studio" &&
          entry.currentServiceTier === "flex"
      )
    );

    const modelIds = new Set(plan.entries.map((entry) => entry.candidate.modelId));
    assert.equal(modelIds.size, plan.entries.length);
    assert.ok(
      plan.selection.candidates.every((candidate) =>
        modelIds.has(candidate.modelId)
      )
    );
  });

  it("deduplicates the current baseline when one model has multiple ordered candidates", () => {
    const radar = radarReport();
    const selection = selectMainRpSupplyLiveCandidates(radar);
    const target = selection.candidates.find(
      (candidate) => candidate.modelId === "gemini-3.7-flash"
    )!;
    selection.candidates = [
      ...selection.candidates,
      {
        ...target,
        providerName: "Backup",
        providerSlug: "backup",
      },
    ];

    const plan = applyCurrentProcurementBaselineBudgetGuard(radar, selection);
    assert.equal(
      plan.entries.filter(
        (entry) => entry.candidate.modelId === "gemini-3.7-flash"
      ).length,
      1
    );
    assert.equal(
      plan.selection.candidates.filter(
        (candidate) => candidate.modelId === "gemini-3.7-flash"
      ).length,
      2
    );
  });

  it("builds the exact current OpenRouter provider pin + flex service tier while the candidate keeps the same tier", () => {
    const radar = radarReport();
    const selection = selectMainRpSupplyLiveCandidates(radar);
    const plan = applyCurrentProcurementBaselineBudgetGuard(radar, selection);
    const entry = plan.entries.find(
      (row) => row.candidate.modelId === "gemini-3.7-flash"
    )!;
    assert.equal(entry.currentProvider, "openrouter");

    const [turn1] = buildDeterministicSupplyProbeTurns();
    const current = buildCurrentProcurementBaselineProbeRequest({
      entry,
      turn: turn1,
      sessionId: "current-openrouter-fixture",
    });
    const provider = current.body.provider as Record<string, unknown>;
    assert.deepEqual(provider.only, ["google-ai-studio"]);
    assert.equal(provider.allow_fallbacks, false);
    assert.equal(current.body.service_tier, "flex");

    const candidate = buildSupplyProbeRequestBody({
      candidate: entry.candidate,
      turn: turn1,
      sessionId: "candidate-openrouter-fixture",
    });
    assert.deepEqual(
      candidate.messages,
      current.body.messages,
      "current and candidate routes must receive the same assembled messages"
    );
    assert.equal(candidate.service_tier, "flex");
    assert.deepEqual(
      (candidate.provider as Record<string, unknown>).only,
      [entry.candidate.providerSlug]
    );
  });

  it("keeps CI prompt-cache session affinity for current CI baselines", () => {
    const radar = radarReport();
    const selection = selectMainRpSupplyLiveCandidates(radar);
    const plan = applyCurrentProcurementBaselineBudgetGuard(radar, selection);
    const entry = plan.entries.find(
      (row) => row.currentProvider === "cheaperinference"
    )!;
    const [turn1] = buildDeterministicSupplyProbeTurns();
    const request = buildCurrentProcurementBaselineProbeRequest({
      entry,
      turn: turn1,
      sessionId: "current-ci-fixture",
    });
    assert.equal(request.body.model, entry.candidate.modelId);
    assert.match(request.url, /x-ci-prompt-cache-scope=session/);
    assert.match(request.url, /x-ci-prompt-cache-session=current-ci-fixture/);
  });
});

describe("candidate vs current procurement comparison", () => {
  it("uses generic current-route fields and comparable OpenRouter total_cost evidence", () => {
    const radar = radarReport();
    const selection = selectMainRpSupplyLiveCandidates(radar);
    const plan = applyCurrentProcurementBaselineBudgetGuard(radar, selection);
    const entry = plan.entries.find(
      (row) => row.candidate.modelId === "gemini-3.7-flash"
    )!;
    const candidate = entry.candidate;

    const candidateResult: SupplyLiveCandidateResult = {
      candidate,
      turns: [
        turn(1, 1, 3, 0, 0.01, 0.018),
        turn(2, 0.8, 2.5, 500, 0.008, 0.012),
      ],
      providerGenerationCalls: 2,
      livePairComplete: true,
      secondTurnCacheReadObserved: true,
      transportStatus: "PAIR_COMPLETE",
      interpretation: [],
    };
    const current: CurrentProcurementBaselineResult = {
      modelId: candidate.modelId,
      currentProvider: "openrouter",
      currentProviderName: "Google AI Studio Flex",
      currentProviderSlug: "google-ai-studio",
      currentServiceTier: "flex",
      turns: [
        turn(1, 1.5, 4, 0, 0.02, 0.025),
        turn(2, 1, 3, 400, 0.015, 0.02),
      ],
      providerGenerationCalls: 2,
      livePairComplete: true,
      secondTurnCacheReadObserved: true,
      estimatedPairCurrentRateUsd: entry.estimatedPairCurrentRateUsd,
    };

    const report = buildSupplyTransportComparisonReport({
      candidateResults: [candidateResult],
      currentResults: [current],
      generatedAt: "2026-09-30T00:00:00.000Z",
    });

    assert.equal(report.providerGenerationCalls, 4);
    assert.ok(
      report.providerGenerationCalls <= MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS
    );
    const row = report.rows[0]!;
    assert.equal(row.currentProvider, "openrouter");
    assert.equal(row.currentServiceTier, "flex");
    assert.equal(row.candidateDeploymentServiceTier, "flex");
    assert.equal(row.candidateObservedBilledCostUsd, 0.03);
    assert.equal(row.currentObservedBilledCostUsd, 0.045);
    assert.ok((row.candidateObservedCostDeltaVsCurrentPercent ?? 0) < -0.3);
    assert.equal(row.currentAverageTtftSeconds, 1.25);
    assert.doesNotMatch(JSON.stringify(report), /qualityScore|winner|ranking/i);
  });

  it("runner only requires the CI benchmark credential when a CI current baseline exists", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/main-rp-supply-live-qualification.ts"),
      "utf8"
    );
    assert.match(
      source,
      /needsCiCredential = baselinePlan\.entries\.some/
    );
    assert.match(
      source,
      /entry\.currentProvider === "cheaperinference"/
    );
    assert.match(
      source,
      /runCurrentProcurementBaselinePair/
    );
    assert.doesNotMatch(source, /runCurrentCiBaselinePair/);
  });
});
