import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from "@/lib/openRouterConfig";
import type { SelectedAI } from "@/lib/chatModels";
import {
  applyCurrentBaselineBudgetGuard,
  buildCurrentBaselineProbeRequest,
  buildSupplyTransportComparisonReport,
  MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_ESTIMATED_USD,
  MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS,
  MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS,
  runCurrentBaselinePair,
  type CurrentBaselinePlanEntry,
} from "./mainRpSupplyCurrentBaseline";
import type {
  MainRpSupplyRadarReport,
  SupplyComparison,
} from "./mainRpSupplyRadar";
import {
  buildDeterministicSupplyProbeTurns,
  type SupplyLiveCandidate,
  type SupplyLiveCandidateResult,
  type SupplyLiveSelection,
  type SupplyLiveTurnResult,
} from "./mainRpSupplyLiveQualification";

const DEEPSEEK: SelectedAI = "deepseek-v4.1-flash";
const GEMINI: SelectedAI = "gemini-3.7-flash";

function candidate(
  modelId: SelectedAI,
  providerSlug = "wafer",
  providerName = "Wafer"
): SupplyLiveCandidate {
  return {
    modelId,
    openRouterSlug:
      modelId === GEMINI
        ? "google/gemini-3.7-flash"
        : "deepseek/deepseek-v4.1-flash",
    providerName,
    providerSlug,
    quantization: null,
    rawEndpointRateDeltaVsCurrentProcurementPercent: -0.2,
    inputUsdPerMillion: 0.08,
    outputUsdPerMillion: 0.5,
    cacheReadUsdPerMillion: 0.02,
    marketLatencyP50SecondsLast30m: 1,
    marketThroughputP50TokensPerSecondLast30m: 50,
    marketUptimeLast1dPercent: 99.9,
    marketUptimeLast30mPercent: 100,
    controlEffort: "none",
    excludeReasoning: true,
    estimatedPairRawEndpointRateUsd: 0.01,
  };
}

function endpoint(input: {
  modelId: SelectedAI;
  providerName: string;
  providerSlug: string;
  providerTag?: string | null;
  inputPerM: number;
  outputPerM: number;
}): SupplyComparison {
  return {
    modelId: input.modelId,
    providerName: input.providerName,
    providerTag: input.providerTag ?? null,
    quantization: null,
    contextLength: 200_000,
    maxPromptTokens: 190_000,
    maxCompletionTokens: 8_192,
    inputUsdPerMillion: input.inputPerM,
    outputUsdPerMillion: input.outputPerM,
    cacheReadUsdPerMillion: 0.03,
    cacheWriteUsdPerMillion: null,
    supportsImplicitCaching: true,
    latencyP50SecondsLast30m: 1,
    throughputP50TokensPerSecondLast30m: 60,
    uptimeLast1dPercent: 99.95,
    uptimeLast30mPercent: 100,
    status: 0,
    supportedParameters: ["reasoning", "temperature"],
    provider: {
      name: input.providerName,
      slug: input.providerSlug,
      headquarters: "US",
      privacyPolicyUrl: "https://example.test/privacy",
      termsOfServiceUrl: "https://example.test/terms",
      statusPageUrl: "https://example.test/status",
      datacenters: ["US"],
    },
    rawEndpointRepresentativeUncachedRateUsd: 0.02,
    currentRepresentativeUncachedProcurementUsd: 0.03,
    rawEndpointRateDeltaVsCurrentProcurementPercent: -0.2,
    inputPriceDeltaPercent: -0.2,
    outputPriceDeltaPercent: -0.2,
    cacheReadPriceDeltaPercent: null,
    lowerRawEndpointRateThanCurrentProcurement: true,
    evidenceFlags: [],
  };
}

function radar(): MainRpSupplyRadarReport {
  return {
    version: 1,
    generatedAt: "2026-09-30T00:00:00.000Z",
    status: "OK",
    providerGenerationCalls: 0,
    activeModelIds: [DEEPSEEK, GEMINI],
    credentialSource: "fixture",
    currentProcurementEvidence: "registry_route_evidence",
    marketEvidence: "openrouter_endpoint_metrics",
    notes: [],
    models: [
      {
        modelId: DEEPSEEK,
        label: "DeepSeek V4.1 Flash",
        openRouterSlug: "deepseek/deepseek-v4.1-flash",
        currentProcurement: {
          provider: "cheaperinference",
          evidenceSource: "cheaperinference_catalog",
          modelId: DEEPSEEK,
          inputUsdPerMillion: 0.15,
          outputUsdPerMillion: 0.6,
          cacheReadUsdPerMillion: 0.003,
          cacheWriteUsdPerMillion: null,
          cacheCapabilityAdvertised: true,
          pricingVersion: "fixture",
          pricingCheckedAt: null,
          pricingUpdatedAt: null,
        },
        endpointCount: 1,
        providersDiscovered: ["Wafer"],
        comparisons: [
          endpoint({
            modelId: DEEPSEEK,
            providerName: "Wafer",
            providerSlug: "wafer",
            inputPerM: 0.08,
            outputPerM: 0.5,
          }),
        ],
        lowerRawEndpointRateCount: 1,
        publishedMarginRisk: null,
        evidenceFingerprint: "deepseek",
      },
      {
        modelId: GEMINI,
        label: "Gemini 3.7 Flash",
        openRouterSlug: "google/gemini-3.7-flash",
        currentProcurement: {
          provider: "openrouter",
          evidenceSource: "openrouter_endpoint_market",
          modelId: GEMINI,
          inputUsdPerMillion: 0.75,
          outputUsdPerMillion: 3.75,
          cacheReadUsdPerMillion: 0.075,
          cacheWriteUsdPerMillion: null,
          cacheCapabilityAdvertised: true,
          pricingVersion: null,
          pricingCheckedAt: null,
          pricingUpdatedAt: null,
        },
        endpointCount: 2,
        providersDiscovered: ["Google AI Studio", "Wafer"],
        comparisons: [
          endpoint({
            modelId: GEMINI,
            providerName: "Google AI Studio Flex",
            providerSlug: "google-ai-studio",
            providerTag: "flex",
            inputPerM: 0.75,
            outputPerM: 3.75,
          }),
          endpoint({
            modelId: GEMINI,
            providerName: "Wafer",
            providerSlug: "wafer",
            inputPerM: 0.3,
            outputPerM: 1.5,
          }),
        ],
        lowerRawEndpointRateCount: 1,
        publishedMarginRisk: null,
        evidenceFingerprint: "gemini",
      },
    ],
  };
}

function selection(): SupplyLiveSelection {
  return {
    candidates: [candidate(DEEPSEEK), candidate(GEMINI)],
    skipped: [],
    maxProviderGenerationCalls: 10,
    estimatedRawEndpointRateUsd: 0.02,
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
    generationId: "fixture-generation",
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
    servedProviderMatch: true,
    error: null,
  };
}

describe("current production baseline owner", () => {
  it("keeps both CI-current and OpenRouter-current models instead of dropping Gemini", () => {
    const plan = applyCurrentBaselineBudgetGuard(radar(), selection());
    assert.deepEqual(
      plan.entries.map((entry) => [
        entry.candidate.modelId,
        entry.currentProvider,
        entry.currentProviderSlug,
        entry.currentServiceTier,
      ]),
      [
        [DEEPSEEK, "cheaperinference", null, null],
        [GEMINI, "openrouter", "google-ai-studio", "flex"],
      ]
    );
    assert.equal(plan.entries.length * 2 <= MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS, true);
    assert.equal(
      plan.estimatedCurrentRateUsd <=
        MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_ESTIMATED_USD,
      true
    );
  });

  it("keeps exactly one baseline entry per model even when several candidates are queued", () => {
    const s = selection();
    s.candidates.push(candidate(GEMINI, "backup", "Backup"));
    const plan = applyCurrentBaselineBudgetGuard(radar(), s);
    assert.equal(
      plan.entries.filter((entry) => entry.candidate.modelId === GEMINI).length,
      1
    );
    assert.equal(
      plan.selection.candidates.filter((row) => row.modelId === GEMINI).length,
      2
    );
  });

  it("fails closed when current procurement price evidence is missing", () => {
    const r = radar();
    r.models.find((model) => model.modelId === DEEPSEEK)!.currentProcurement = {
      ...r.models.find((model) => model.modelId === DEEPSEEK)!.currentProcurement!,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
    };
    const plan = applyCurrentBaselineBudgetGuard(r, selection());
    assert.equal(
      plan.selection.candidates.some((row) => row.modelId === DEEPSEEK),
      false
    );
    assert.ok(
      plan.skipped.some(
        (row) =>
          row.modelId === DEEPSEEK &&
          row.reason === "current_procurement_baseline_missing"
      )
    );
  });
});

describe("current production request parity", () => {
  it("uses CI session-affinity request for a CI-current model", () => {
    const plan = applyCurrentBaselineBudgetGuard(radar(), selection());
    const entry = plan.entries.find((row) => row.candidate.modelId === DEEPSEEK)!;
    const [caseData] = buildDeterministicSupplyProbeTurns();
    const request = buildCurrentBaselineProbeRequest({
      entry,
      turn: caseData,
      sessionId: "current-ci-session",
    });

    assert.equal(request.body.model, DEEPSEEK);
    assert.doesNotMatch(JSON.stringify(request.body), /"provider":\s*\{/);
    assert.match(request.url, /x-ci-prompt-cache-scope=session/);
    assert.match(request.url, /x-ci-prompt-cache-session=current-ci-session/);
  });

  it("uses the exact current OpenRouter provider pin and Flex service tier", () => {
    const plan = applyCurrentBaselineBudgetGuard(radar(), selection());
    const entry = plan.entries.find((row) => row.candidate.modelId === GEMINI)!;
    const [caseData] = buildDeterministicSupplyProbeTurns();
    const request = buildCurrentBaselineProbeRequest({
      entry,
      turn: caseData,
      sessionId: "current-or-session",
    });
    const provider = request.body.provider as Record<string, unknown>;

    assert.equal(request.url, OPENROUTER_CHAT_COMPLETIONS_URL);
    assert.equal(request.body.model, "google/gemini-3.7-flash");
    assert.deepEqual(provider.only, ["google-ai-studio"]);
    assert.equal(provider.allow_fallbacks, false);
    assert.equal(provider.require_parameters, true);
    assert.equal(request.body.service_tier, "flex");
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

describe("OpenRouter current baseline served-provider proof", () => {
  it("rejects a completed stream when metadata says a different provider served it", async () => {
    const plan = applyCurrentBaselineBudgetGuard(radar(), selection());
    const entry = plan.entries.find((row) => row.candidate.modelId === GEMINI)!;
    const sse = [
      'data: {"id":"gen-1","model":"google/gemini-3.7-flash","choices":[{"delta":{"content":"응답"},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(
        JSON.stringify({
          data: {
            provider_name: "Wrong Provider",
            model: "google/gemini-3.7-flash",
            upstream_inference_cost: 0.01,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await runCurrentBaselinePair({
      openRouterApiKey: "test-openrouter",
      entry,
      sessionId: "provider-mismatch",
      fetchImpl: fakeFetch,
    });

    assert.equal(result.currentProvider, "openrouter");
    assert.equal(result.livePairComplete, false);
    assert.equal(result.providerGenerationCalls, 1);
    assert.equal(result.turns[0]!.servedProviderMatch, false);
  });
});

describe("candidate vs current production comparison", () => {
  it("records generic baseline provider, cache, speed and observed cost evidence", () => {
    const plan = applyCurrentBaselineBudgetGuard(radar(), selection());
    const entry = plan.entries.find((row) => row.candidate.modelId === GEMINI)!;
    const candidateResult: SupplyLiveCandidateResult = {
      candidate: candidate(GEMINI),
      turns: [turn(1, 1, 3, 0, 0.02), turn(2, 0.8, 2.5, 500, 0.015)],
      providerGenerationCalls: 2,
      livePairComplete: true,
      secondTurnCacheReadObserved: true,
      transportStatus: "PAIR_COMPLETE",
      interpretation: [],
    };
    const report = buildSupplyTransportComparisonReport({
      candidateResults: [candidateResult],
      currentBaselineResults: [
        {
          modelId: GEMINI,
          currentProvider: "openrouter",
          currentProviderName: "Google AI Studio Flex",
          currentProviderSlug: "google-ai-studio",
          turns: [turn(1, 1.5, 4, 0, 0.03), turn(2, 1, 3, 400, 0.02)],
          providerGenerationCalls: 2,
          livePairComplete: true,
          secondTurnCacheReadObserved: true,
          estimatedPairCurrentRateUsd: entry.estimatedPairCurrentRateUsd,
        },
      ],
      generatedAt: "2026-09-30T00:00:00.000Z",
    });

    assert.equal(report.providerGenerationCalls, 4);
    assert.ok(
      report.providerGenerationCalls <= MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS
    );
    const row = report.rows[0]!;
    assert.equal(row.currentBaselineProvider, "openrouter");
    assert.equal(row.currentBaselineProviderSlug, "google-ai-studio");
    assert.equal(row.candidateAverageTtftSeconds, 0.9);
    assert.equal(row.currentBaselineAverageTtftSeconds, 1.25);
    assert.equal(row.candidateObservedProviderCostUsd, 0.035);
    assert.equal(row.currentBaselineObservedProviderCostUsd, 0.05);
    assert.equal(row.candidateSecondTurnCacheReadObserved, true);
    assert.equal(row.currentBaselineSecondTurnCacheReadObserved, true);
    assert.match(report.notes.join("\n"), /actual production procurement owner/i);
    assert.doesNotMatch(JSON.stringify(report), /qualityScore|winner|ranking/i);
  });

  it("runner keeps CI key optional for OpenRouter-current models and never uses production CI key", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/main-rp-supply-live-qualification.ts"),
      "utf8"
    );
    assert.match(source, /entry\.currentProvider === "cheaperinference"/);
    assert.match(source, /openRouterApiKey: openRouterCredential\.apiKey/);
    assert.match(source, /cheaperInferenceApiKey: ciCredential/);
    assert.doesNotMatch(source, /CHEAPER_INFERENCE_API_KEY/);
    assert.match(source, /if \(result\.livePairComplete\) break;/);
  });
});
