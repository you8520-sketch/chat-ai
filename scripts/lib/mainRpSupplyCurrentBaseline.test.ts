import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import type { SelectedAI } from "@/lib/chatModels";
import {
  applyCurrentBaselineBudgetGuard,
  buildCurrentBaselineProbeRequest,
  buildSupplyTransportComparisonReport,
  MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS,
  MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_ESTIMATED_USD,
  MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS,
  type CurrentBaselineResult,
} from "./mainRpSupplyCurrentBaseline";
import {
  compareSupplyEndpoint,
  type MainRpSupplyRadarReport,
  type ProcurementBaseline,
  type SupplyEndpointEvidence,
} from "./mainRpSupplyRadar";
import {
  buildDeterministicSupplyProbeTurns,
  buildSupplyProbeRequestBody,
  type SupplyLiveCandidate,
  type SupplyLiveCandidateResult,
  type SupplyLiveSelection,
  type SupplyLiveTurnResult,
} from "./mainRpSupplyLiveQualification";

function endpoint(input: {
  modelId: string;
  name: string;
  slug: string;
  tag?: string | null;
  input: number;
  output: number;
}): SupplyEndpointEvidence {
  return {
    modelId: input.modelId,
    providerName: input.name,
    providerTag: input.tag ?? null,
    quantization: null,
    contextLength: 200_000,
    maxPromptTokens: 190_000,
    maxCompletionTokens: 8_192,
    inputUsdPerMillion: input.input,
    outputUsdPerMillion: input.output,
    cacheReadUsdPerMillion: 0.01,
    cacheWriteUsdPerMillion: null,
    supportsImplicitCaching: true,
    latencyP50SecondsLast30m: 1.2,
    throughputP50TokensPerSecondLast30m: 70,
    uptimeLast1dPercent: 99.9,
    uptimeLast30mPercent: 100,
    status: 0,
    supportedParameters: ["reasoning", "include_reasoning", "temperature"],
    provider: {
      name: input.name,
      slug: input.slug,
      headquarters: "US",
      privacyPolicyUrl: "https://example.com/privacy",
      termsOfServiceUrl: "https://example.com/terms",
      statusPageUrl: "https://example.com/status",
      datacenters: ["US"],
    },
  };
}

function candidate(input: {
  modelId: SelectedAI;
  openRouterSlug: string;
  providerName?: string;
  providerSlug?: string;
}): SupplyLiveCandidate {
  return {
    modelId: input.modelId,
    openRouterSlug: input.openRouterSlug,
    providerName: input.providerName ?? "Alternative Studio",
    providerSlug: input.providerSlug ?? "alternative-studio",
    quantization: null,
    rawEndpointRateDeltaVsCurrentProcurementPercent: -0.2,
    inputUsdPerMillion: 0.2,
    outputUsdPerMillion: 1,
    cacheReadUsdPerMillion: 0.01,
    marketLatencyP50SecondsLast30m: 1,
    marketThroughputP50TokensPerSecondLast30m: 60,
    marketUptimeLast1dPercent: 99.95,
    marketUptimeLast30mPercent: 100,
    controlEffort: "none",
    excludeReasoning: true,
    estimatedPairRawEndpointRateUsd: 0.02,
  };
}

function selection(...candidates: SupplyLiveCandidate[]): SupplyLiveSelection {
  return {
    candidates,
    skipped: [],
    maxProviderGenerationCalls: 10,
    estimatedRawEndpointRateUsd: candidates.reduce(
      (sum, row) => sum + row.estimatedPairRawEndpointRateUsd,
      0
    ),
  };
}

function modelReport(input: {
  modelId: SelectedAI;
  openRouterSlug: string;
  baseline: ProcurementBaseline;
  endpoints: SupplyEndpointEvidence[];
}): MainRpSupplyRadarReport["models"][number] {
  const comparisons = input.endpoints.map((row) =>
    compareSupplyEndpoint(row, input.baseline)
  );
  return {
    modelId: input.modelId,
    label: input.modelId,
    openRouterSlug: input.openRouterSlug,
    currentProcurement: input.baseline,
    endpointCount: comparisons.length,
    providersDiscovered: comparisons.map((row) => row.providerName),
    comparisons,
    lowerRawEndpointRateCount: comparisons.filter(
      (row) => row.lowerRawEndpointRateThanCurrentProcurement
    ).length,
    publishedMarginRisk: null,
    evidenceFingerprint: "fixture",
  };
}

function radar(models: MainRpSupplyRadarReport["models"]): MainRpSupplyRadarReport {
  return {
    version: 1,
    generatedAt: "2026-09-30T00:00:00.000Z",
    status: "OK",
    providerGenerationCalls: 0,
    activeModelIds: models.map((row) => row.modelId),
    credentialSource: "fixture",
    currentProcurementEvidence: "registry_route_evidence",
    marketEvidence: "openrouter_endpoint_metrics",
    notes: [],
    models,
  };
}

function geminiFixture() {
  const modelId = "gemini-3.7-flash" as const;
  const openRouterSlug = "google/gemini-3.7-flash";
  const baseline: ProcurementBaseline = {
    provider: "openrouter",
    evidenceSource: "openrouter_endpoint_market",
    modelId,
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.5,
    cacheReadUsdPerMillion: 0.03,
    cacheWriteUsdPerMillion: null,
    cacheCapabilityAdvertised: true,
    pricingVersion: null,
    pricingCheckedAt: null,
    pricingUpdatedAt: null,
  };
  const current = endpoint({
    modelId: openRouterSlug,
    name: "Google AI Studio Flex",
    slug: "google-ai-studio",
    tag: "flex",
    input: 0.3,
    output: 1.5,
  });
  const alternate = endpoint({
    modelId: openRouterSlug,
    name: "Alternative Studio",
    slug: "alternative-studio",
    input: 0.2,
    output: 1,
  });
  const cand = candidate({ modelId, openRouterSlug });
  return {
    modelId,
    cand,
    radar: radar([
      modelReport({
        modelId,
        openRouterSlug,
        baseline,
        endpoints: [current, alternate],
      }),
    ]),
  };
}

function deepseekFixture() {
  const modelId = "deepseek-v4.1-flash" as const;
  const openRouterSlug = "deepseek/deepseek-v4.1-flash";
  const baseline: ProcurementBaseline = {
    provider: "cheaperinference",
    evidenceSource: "cheaperinference_catalog",
    modelId,
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    cacheReadUsdPerMillion: 0.003,
    cacheWriteUsdPerMillion: null,
    cacheCapabilityAdvertised: true,
    pricingVersion: "fixture",
    pricingCheckedAt: null,
    pricingUpdatedAt: null,
  };
  const alternate = endpoint({
    modelId: openRouterSlug,
    name: "Wafer",
    slug: "wafer",
    input: 0.08,
    output: 0.4,
  });
  const cand = candidate({
    modelId,
    openRouterSlug,
    providerName: "Wafer",
    providerSlug: "wafer",
  });
  return {
    modelId,
    cand,
    radar: radar([
      modelReport({
        modelId,
        openRouterSlug,
        baseline,
        endpoints: [alternate],
      }),
    ]),
  };
}

function turn(
  turnNumber: 1 | 2,
  ttft: number,
  total: number,
  cacheRead: number,
  cost: number
): SupplyLiveTurnResult {
  return {
    turn: turnNumber,
    httpStatus: 200,
    generationId: null,
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
    providerReportedCostUsd: cost,
    providerMetadata: null,
    servedProviderMatch: null,
    error: null,
  };
}

describe("current production baseline owner", () => {
  it("accepts the actual OpenRouter production route instead of filtering it as non-CI", () => {
    const fixture = geminiFixture();
    const plan = applyCurrentBaselineBudgetGuard(
      fixture.radar,
      selection(fixture.cand)
    );
    assert.equal(plan.entries.length, 1);
    const entry = plan.entries[0]!;
    assert.equal(entry.currentProvider, "openrouter");
    assert.equal(entry.currentProviderSlug, "google-ai-studio");
    assert.equal(entry.currentServiceTier, "flex");
    assert.equal(entry.openRouterRouteCandidate?.providerSlug, "google-ai-studio");
  });

  it("keeps current CheaperInference models on the CI baseline path", () => {
    const fixture = deepseekFixture();
    const plan = applyCurrentBaselineBudgetGuard(
      fixture.radar,
      selection(fixture.cand)
    );
    const entry = plan.entries[0]!;
    assert.equal(entry.currentProvider, "cheaperinference");
    assert.equal(entry.currentProviderName, "CheaperInference");
    assert.equal(entry.currentProviderSlug, null);
    assert.equal(entry.currentServiceTier, null);
  });

  it("deduplicates current baseline calls when one model has multiple ordered candidates", () => {
    const fixture = deepseekFixture();
    const backup = {
      ...fixture.cand,
      providerName: "Backup",
      providerSlug: "backup",
    };
    const plan = applyCurrentBaselineBudgetGuard(
      fixture.radar,
      selection(fixture.cand, backup)
    );
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.selection.candidates.length, 2);
    assert.ok(
      plan.entries.length * 2 <=
        MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS
    );
    assert.ok(
      plan.estimatedCurrentRateUsd <=
        MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_ESTIMATED_USD
    );
  });

  it("fails closed when the current procurement rate evidence is missing", () => {
    const fixture = deepseekFixture();
    fixture.radar.models[0]!.currentProcurement = {
      ...fixture.radar.models[0]!.currentProcurement!,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
    };
    const plan = applyCurrentBaselineBudgetGuard(
      fixture.radar,
      selection(fixture.cand)
    );
    assert.equal(plan.entries.length, 0);
    assert.equal(plan.selection.candidates.length, 0);
    assert.equal(
      plan.skipped[0]?.reason,
      "current_procurement_baseline_missing"
    );
  });
});

describe("current production request parity", () => {
  it("builds the OpenRouter baseline with the exact current Google AI Studio + Flex production route", () => {
    const fixture = geminiFixture();
    const plan = applyCurrentBaselineBudgetGuard(
      fixture.radar,
      selection(fixture.cand)
    );
    const [turn1] = buildDeterministicSupplyProbeTurns();
    const request = buildCurrentBaselineProbeRequest({
      entry: plan.entries[0]!,
      turn: turn1,
      sessionId: "current-openrouter-baseline",
    });
    assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(request.body.model, "google/gemini-3.7-flash");
    assert.deepEqual(request.body.provider, {
      only: ["google-ai-studio"],
      allow_fallbacks: false,
      require_parameters: true,
    });
    assert.equal(request.body.service_tier, "flex");
  });

  it("tests a same-OpenRouter alternate provider with the same production Flex service tier", () => {
    const fixture = geminiFixture();
    const [turn1] = buildDeterministicSupplyProbeTurns();
    const request = buildSupplyProbeRequestBody({
      candidate: fixture.cand,
      turn: turn1,
      sessionId: "candidate-openrouter-flex",
    });
    assert.deepEqual(request.provider, {
      only: ["alternative-studio"],
      allow_fallbacks: false,
      data_collection: "deny",
      require_parameters: true,
    });
    assert.equal(request.service_tier, "flex");
  });

  it("keeps the CheaperInference session-affinity baseline behavior unchanged", () => {
    const fixture = deepseekFixture();
    const plan = applyCurrentBaselineBudgetGuard(
      fixture.radar,
      selection(fixture.cand)
    );
    const [turn1] = buildDeterministicSupplyProbeTurns();
    const request = buildCurrentBaselineProbeRequest({
      entry: plan.entries[0]!,
      turn: turn1,
      sessionId: "current-ci-baseline",
    });
    assert.equal(request.body.model, fixture.modelId);
    assert.doesNotMatch(JSON.stringify(request.body), /"provider":\s*\{/);
    assert.match(request.url, /x-ci-prompt-cache-scope=session/);
    assert.match(request.url, /x-ci-prompt-cache-session=current-ci-baseline/);
  });

  it("reuses the canonical live target-length owner", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/lib/mainRpSupplyCurrentBaseline.ts"),
      "utf8"
    );
    assert.match(source, /MAIN_RP_SUPPLY_LIVE_TARGET_CHARS/);
    assert.doesNotMatch(source, /targetResponseChars:\s*1200/);
  });
});

describe("candidate vs current production comparison semantics", () => {
  it("compares against a provider-agnostic current baseline without a winner or score", () => {
    const fixture = geminiFixture();
    const plan = applyCurrentBaselineBudgetGuard(
      fixture.radar,
      selection(fixture.cand)
    );
    const entry = plan.entries[0]!;
    const candidateResult: SupplyLiveCandidateResult = {
      candidate: fixture.cand,
      turns: [turn(1, 1, 3, 0, 0.02), turn(2, 0.8, 2.5, 500, 0.015)],
      providerGenerationCalls: 2,
      livePairComplete: true,
      secondTurnCacheReadObserved: true,
      transportStatus: "PAIR_COMPLETE",
      interpretation: [],
    };
    const baseline: CurrentBaselineResult = {
      modelId: fixture.modelId,
      currentProvider: "openrouter",
      currentProviderName: "Google AI Studio Flex",
      currentProviderSlug: "google-ai-studio",
      currentServiceTier: "flex",
      turns: [turn(1, 1.5, 4, 0, 0.03), turn(2, 1, 3, 400, 0.02)],
      providerGenerationCalls: 2,
      livePairComplete: true,
      secondTurnCacheReadObserved: true,
      estimatedPairCurrentRateUsd: entry.estimatedPairCurrentRateUsd,
    };
    const report = buildSupplyTransportComparisonReport({
      candidateResults: [candidateResult],
      currentBaselineResults: [baseline],
      generatedAt: "2026-09-30T00:00:00.000Z",
    });
    assert.equal(report.providerGenerationCalls, 4);
    assert.ok(
      report.providerGenerationCalls <= MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS
    );
    assert.equal(report.currentBaselineGenerationCalls, 2);
    assert.equal(report.rows[0]!.currentProvider, "openrouter");
    assert.equal(report.rows[0]!.currentBaselineAverageTtftSeconds, 1.25);
    assert.match(report.notes.join("\n"), /actual current production procurement route/i);
    assert.doesNotMatch(JSON.stringify(report), /qualityScore|winner|ranking/i);
  });

  it("runner no longer globally requires a CI credential for OpenRouter-current models", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/main-rp-supply-live-qualification.ts"),
      "utf8"
    );
    assert.match(source, /runCurrentBaselinePair/);
    assert.doesNotMatch(
      source,
      /!ciCredential\s*\?\s*"missing_cheaper_inference_benchmark_credential"/
    );
    assert.match(source, /currentProvider === "cheaperinference"/);
    assert.match(source, /if \(result\.livePairComplete\) break;/);
  });
});
