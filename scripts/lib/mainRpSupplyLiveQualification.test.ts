import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  type SelectedAI,
} from "@/lib/chatModels";
import type { CatalogPricingEvidence } from "./mainRpMonthlyCacheAudit";
import {
  buildMainRpSupplyRadarReport,
  type SupplyEndpointEvidence,
} from "./mainRpSupplyRadar";
import {
  MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS,
  applyCandidateControlAndProviderPin,
  buildDeterministicSupplyProbeTurns,
  buildSupplyLiveReport,
  buildSupplyLiveRequestHeaders,
  processOpenRouterSupplySseLine,
  resolveSupplyLiveRequiredProviderParameterKeys,
  selectMainRpSupplyLiveCandidates,
  type SupplyLiveCandidate,
} from "./mainRpSupplyLiveQualification";
import {
  resolveOptInOpenRouterSupplyBenchmarkApiKey,
  sanitizeSupplyBenchmarkCredentialText,
} from "./mainRpSupplyLiveQualificationCredential";
import { loadCanonicalRpQualificationFixture } from "./rpModelQualificationFixture";

function catalog(id: string): CatalogPricingEvidence {
  return {
    id,
    input_per_million: 0.3,
    output_per_million: 1.2,
    cache_read_input_per_million: 0.03,
    cache_write_input_per_million: null,
    cacheCapabilityAdvertised: true,
    pricing_version: "fixture-v1",
    pricing_checked_at: "2026-09-28T00:00:00Z",
    pricing_updated_at: "2026-09-28T00:00:00Z",
  };
}

function endpoint(
  modelId: SelectedAI,
  providerName = "FixtureProvider",
  providerSlug = "fixture-provider",
  input = 0.1,
  output = 0.3
): SupplyEndpointEvidence {
  return {
    modelId,
    providerName,
    providerTag: providerSlug,
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
        endpoint(option.id, "Google AI Studio", "google-ai-studio", 0.4, 1.2),
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
    generatedAt: "2026-09-28T00:00:00.000Z",
  });

  // Keep the fixture coupled to the actual production request contract instead
  // of maintaining a second hand-written supported-parameter list.
  const gemini = report.models.find((row) => row.modelId === "gemini-3.7-flash");
  const alternate = gemini?.comparisons.find(
    (row) => row.provider?.slug === "fixture-provider"
  );
  if (gemini && alternate?.provider?.slug) {
    const candidate: SupplyLiveCandidate = {
      modelId: gemini.modelId,
      openRouterSlug: gemini.openRouterSlug,
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
      estimatedPairRawEndpointRateUsd: 0.01,
    };
    alternate.supportedParameters =
      resolveSupplyLiveRequiredProviderParameterKeys(candidate);
  }
  return report;
}

function isolateCheaperAlternate(
  report: ReturnType<typeof radarReport>,
  modelId: SelectedAI
) {
  for (const model of report.models) {
    model.comparisons = model.comparisons.map((row) => {
      const isTargetAlternate =
        model.modelId === modelId && row.provider?.slug === "fixture-provider";
      return {
        ...row,
        lowerRawEndpointRateThanCurrentProcurement: isTargetAlternate,
        rawEndpointRateDeltaVsCurrentProcurementPercent: isTargetAlternate ? -0.5 : 0,
      };
    });
  }
  return report;
}

describe("Main RP supply live qualification credential", () => {
  it("requires triple opt-in and never falls back to production OpenRouter key", () => {
    assert.deepEqual(
      resolveOptInOpenRouterSupplyBenchmarkApiKey({
        OPENROUTER_API_KEY: "production-key-must-not-count",
      } as NodeJS.ProcessEnv),
      {
        ok: false,
        status: "NOT_RUN",
        reason: "global_real_provider_opt_in_missing",
        providerGenerationCalls: 0,
      }
    );
    const resolved = resolveOptInOpenRouterSupplyBenchmarkApiKey({
      REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
      MAIN_RP_SUPPLY_LIVE_QUALIFICATION: "1",
      OPENROUTER_SUPPLY_BENCHMARK_API_KEY: " benchmark ",
      OPENROUTER_API_KEY: "production",
    } as NodeJS.ProcessEnv);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.apiKey, "benchmark");

    const source = readFileSync(
      resolve(process.cwd(), "scripts/lib/mainRpSupplyLiveQualificationCredential.ts"),
      "utf8"
    );
    assert.doesNotMatch(source, /process\.env\.OPENROUTER_API_KEY/);
  });

  it("redacts benchmark and accidental production-key assignments", () => {
    const sanitized = sanitizeSupplyBenchmarkCredentialText(
      "OPENROUTER_SUPPLY_BENCHMARK_API_KEY=abc OPENROUTER_API_KEY=def Bearer ghi"
    );
    assert.doesNotMatch(sanitized, /abc|def|ghi/);
  });
});

describe("Main RP supply live candidate selection", () => {
  it("derives candidates from current-procurement deltas and skips Opus until control parity is proven", () => {
    const selection = selectMainRpSupplyLiveCandidates(radarReport());
    assert.ok(selection.candidates.length > 0);
    assert.ok(selection.candidates.length <= 5);
    assert.ok(selection.candidates.length * 2 <= MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS);
    assert.equal(
      selection.candidates.some((row) => row.modelId === "claude-opus-5.5"),
      false
    );
    assert.equal(
      new Set(selection.candidates.map((row) => row.modelId)).size,
      selection.candidates.length
    );
  });

  it("preserves current Gemini 3.8 low-reasoning parity on an alternate OpenRouter candidate", () => {
    const report = isolateCheaperAlternate(radarReport(), "gemini-3.8-flash");
    const selection = selectMainRpSupplyLiveCandidates(report);
    const gemini = selection.candidates.find((row) => row.modelId === "gemini-3.8-flash");
    assert.ok(gemini);
    assert.equal(gemini.controlEffort, "low");
    const body = applyCandidateControlAndProviderPin(
      { model: gemini.openRouterSlug, messages: [], stream: true },
      gemini
    );
    assert.deepEqual(body.reasoning, { effort: "low", exclude: true });
  });

  it("skips an endpoint missing an actual production parameter before any paid call", () => {
    const report = isolateCheaperAlternate(radarReport(), "gemini-3.8-flash");
    const model = report.models.find((row) => row.modelId === "gemini-3.8-flash")!;
    const cheaper = model.comparisons.find((row) => row.provider?.slug === "fixture-provider")!;
    const productionCandidate: SupplyLiveCandidate = {
      modelId: model.modelId,
      openRouterSlug: model.openRouterSlug,
      providerName: cheaper.providerName,
      providerSlug: cheaper.provider!.slug!,
      quantization: cheaper.quantization,
      rawEndpointRateDeltaVsCurrentProcurementPercent: -0.5,
      inputUsdPerMillion: cheaper.inputUsdPerMillion ?? 0.1,
      outputUsdPerMillion: cheaper.outputUsdPerMillion ?? 0.3,
      cacheReadUsdPerMillion: cheaper.cacheReadUsdPerMillion,
      marketLatencyP50SecondsLast30m: cheaper.latencyP50SecondsLast30m ?? 1.2,
      marketThroughputP50TokensPerSecondLast30m:
        cheaper.throughputP50TokensPerSecondLast30m ?? 70,
      marketUptimeLast1dPercent: cheaper.uptimeLast1dPercent ?? 99.9,
      marketUptimeLast30mPercent: cheaper.uptimeLast30mPercent ?? 100,
      controlEffort: "low",
      excludeReasoning: true,
      estimatedPairRawEndpointRateUsd: 0.01,
    };
    const required =
      resolveSupplyLiveRequiredProviderParameterKeys(productionCandidate);
    assert.ok(required.includes("reasoning"), "production request must require reasoning");
    model.comparisons = [
      {
        ...cheaper,
        providerName: "Missing Reasoning",
        provider: { ...cheaper.provider!, name: "Missing Reasoning", slug: "missing-reasoning" },
        inputUsdPerMillion: (cheaper.inputUsdPerMillion ?? 0.1) / 2,
        outputUsdPerMillion: (cheaper.outputUsdPerMillion ?? 0.3) / 2,
        lowerRawEndpointRateThanCurrentProcurement: true,
        rawEndpointRateDeltaVsCurrentProcurementPercent: -0.75,
        supportedParameters: required.filter((key) => key !== "reasoning"),
      },
      {
        ...cheaper,
        providerName: "Compatible Alternative",
        provider: { ...cheaper.provider!, name: "Compatible Alternative", slug: "compatible" },
        lowerRawEndpointRateThanCurrentProcurement: true,
        rawEndpointRateDeltaVsCurrentProcurementPercent: -0.5,
        supportedParameters: required,
      },
    ];

    const selection = selectMainRpSupplyLiveCandidates(report);
    const chosen = selection.candidates.find((row) => row.modelId === "gemini-3.8-flash");
    assert.equal(chosen?.providerSlug, "compatible");
    assert.ok(
      selection.skipped.some(
        (row) =>
          row.modelId === "gemini-3.8-flash" &&
          row.providerName === "Missing Reasoning" &&
          row.reason.startsWith("required_request_parameters_not_advertised:") &&
          row.reason.split(":")[1]?.split(",").includes("reasoning") === true
      )
    );
  });

  it("does not pay-test endpoints without factual uptime evidence", () => {
    const report = radarReport();
    const first = report.models[0]!;
    first.comparisons[0] = { ...first.comparisons[0]!, uptimeLast1dPercent: 98 };
    const selection = selectMainRpSupplyLiveCandidates(report);
    assert.equal(
      selection.candidates.some((row) => row.modelId === first.modelId),
      false
    );
  });
});

describe("Main RP supply live deterministic pair and wire guard", () => {
  it("uses the frozen reference assistant for turn 2", () => {
    const fixture = loadCanonicalRpQualificationFixture();
    const [turn1, turn2] = buildDeterministicSupplyProbeTurns();
    assert.equal(turn1.currentUserMessage, fixture.productionTurn1User);
    assert.equal(turn2.currentUserMessage, fixture.productionTurn2User);
    assert.ok(
      turn2.history.some(
        (row) => row.role === "assistant" && row.content === fixture.productionTurn1AssistantReference
      )
    );
  });

  it("pins one candidate provider and disables fallback/response replay", () => {
    const candidate = selectMainRpSupplyLiveCandidates(radarReport()).candidates[0]!;
    const body = applyCandidateControlAndProviderPin(
      { model: candidate.openRouterSlug, messages: [{ role: "user", content: "fixture" }], stream: true },
      candidate
    );
    const provider = body.provider as Record<string, unknown>;
    assert.deepEqual(provider.only, [candidate.providerSlug]);
    assert.equal(provider.allow_fallbacks, false);
    assert.equal(provider.data_collection, "deny");
    assert.equal(provider.require_parameters, true);

    const headers = buildSupplyLiveRequestHeaders("benchmark");
    assert.equal(headers["X-OpenRouter-Cache"], "false");
    assert.equal(headers["X-OpenRouter-Metadata"], "enabled");
  });

  it("parses generation/model/first delta/usage", () => {
    const state = {
      text: "",
      finishReason: null,
      usage: null,
      resolvedModel: null,
      generationId: null,
      firstDeltaAtMs: null,
      sawDone: false,
    };
    processOpenRouterSupplySseLine(
      'data: {"id":"gen-1","model":"m","choices":[{"delta":{"content":"안녕"}}]}',
      state,
      123
    );
    processOpenRouterSupplySseLine(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":10}}',
      state,
      456
    );
    processOpenRouterSupplySseLine("data: [DONE]", state, 789);
    assert.equal(state.generationId, "gen-1");
    assert.equal(state.firstDeltaAtMs, 123);
    assert.equal(state.text, "안녕");
    assert.equal(state.sawDone, true);
  });
});

describe("Main RP supply live report semantics", () => {
  it("does not create a composite quality winner and enforces provider call cap", () => {
    const report = buildSupplyLiveReport({
      selection: selectMainRpSupplyLiveCandidates(radarReport()),
      results: [],
      generatedAt: "2026-09-28T00:00:00.000Z",
      notRunReason: "fixture_not_run",
    });
    assert.equal(report.status, "NOT_RUN");
    assert.equal(report.providerGenerationCalls, 0);
    assert.match(report.notes.join("\n"), /not automatic provider selection/i);
    assert.doesNotMatch(JSON.stringify(report), /qualityScore|winner/i);
  });
});
