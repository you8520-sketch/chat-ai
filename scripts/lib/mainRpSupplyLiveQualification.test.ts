import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS, type SelectedAI } from "@/lib/chatModels";
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

function endpoint(modelId: SelectedAI, providerName = "FixtureProvider"): SupplyEndpointEvidence {
  return {
    modelId,
    providerName,
    providerTag: "fixture",
    quantization: modelId.startsWith("deepseek") ? "fp8" : null,
    contextLength: 200_000,
    maxPromptTokens: 190_000,
    maxCompletionTokens: 8_192,
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.3,
    cacheReadUsdPerMillion: 0.01,
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
    ],
    provider: {
      name: providerName,
      slug: "fixture-provider",
      headquarters: "US",
      privacyPolicyUrl: "https://example.com/privacy",
      termsOfServiceUrl: "https://example.com/terms",
      statusPageUrl: "https://example.com/status",
      datacenters: ["US"],
    },
  };
}

function radarReport() {
  const endpointsByModel = Object.fromEntries(
    MAIN_RP_MODEL_IDS.map((id) => [id, [endpoint(id)]])
  );
  const ci = Object.fromEntries(
    MAIN_RP_MODEL_IDS.map((id) => [id, catalog(id)])
  );
  return buildMainRpSupplyRadarReport({
    endpointsByModel: endpointsByModel as Parameters<
      typeof buildMainRpSupplyRadarReport
    >[0]["endpointsByModel"],
    ciCatalogByModel: ci,
    credentialSource: "fixture",
    generatedAt: "2026-09-28T00:00:00.000Z",
  });
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

    const missingProbe = resolveOptInOpenRouterSupplyBenchmarkApiKey({
      REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
      OPENROUTER_SUPPLY_BENCHMARK_API_KEY: "benchmark",
    } as NodeJS.ProcessEnv);
    assert.equal(missingProbe.ok, false);

    const resolved = resolveOptInOpenRouterSupplyBenchmarkApiKey({
      REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
      MAIN_RP_SUPPLY_LIVE_QUALIFICATION: "1",
      OPENROUTER_SUPPLY_BENCHMARK_API_KEY: " benchmark ",
      OPENROUTER_API_KEY: "production",
    } as NodeJS.ProcessEnv);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.apiKey, "benchmark");

    const source = readFileSync(
      resolve(
        process.cwd(),
        "scripts/lib/mainRpSupplyLiveQualificationCredential.ts"
      ),
      "utf8"
    );
    assert.doesNotMatch(source, /process\.env\.OPENROUTER_API_KEY/);
    assert.doesNotMatch(source, /env\[["']OPENROUTER_API_KEY["']\]/);
  });

  it("redacts both benchmark and accidental production-key assignments", () => {
    const sanitized = sanitizeSupplyBenchmarkCredentialText(
      "OPENROUTER_SUPPLY_BENCHMARK_API_KEY=abc OPENROUTER_API_KEY=def Bearer ghi"
    );
    assert.doesNotMatch(sanitized, /abc|def|ghi/);
    assert.match(sanitized, /\[REDACTED\]/);
  });
});

describe("Main RP supply live candidate selection", () => {
  it("derives candidates from the current radar and skips Opus until control parity is proven", () => {
    const selection = selectMainRpSupplyLiveCandidates(radarReport());
    assert.ok(selection.candidates.length > 0);
    assert.ok(selection.candidates.length <= 5);
    assert.ok(selection.candidates.length * 2 <= MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS);
    assert.equal(
      selection.candidates.some((row) => row.modelId === "claude-opus-5.5"),
      false
    );
    assert.ok(
      selection.skipped.some(
        (row) =>
          row.modelId === "claude-opus-5.5" &&
          row.reason.includes("control_parity_unproven")
      )
    );
    assert.equal(
      new Set(selection.candidates.map((row) => row.modelId)).size,
      selection.candidates.length
    );
    assert.ok(selection.estimatedRawEndpointRateUsd <= 5);
  });

  it("skips a cheaper endpoint that cannot accept the actual production request parameters and selects the next compatible endpoint", () => {
    const report = radarReport();
    const model = report.models.find(
      (row) => row.modelId === "gemini-3.7-flash"
    )!;
    const base = model.comparisons[0]!;
    model.comparisons = [
      {
        ...base,
        providerName: "Google",
        provider: {
          ...base.provider!,
          name: "Google",
          slug: "google-vertex",
        },
        supportedParameters: [
          "reasoning",
          "include_reasoning",
          "max_tokens",
        ],
      },
      {
        ...base,
        providerName: "Google AI Studio",
        provider: {
          ...base.provider!,
          name: "Google AI Studio",
          slug: "google-ai-studio",
        },
        supportedParameters: [
          "reasoning",
          "include_reasoning",
          "max_tokens",
          "temperature",
        ],
      },
    ];

    const selection = selectMainRpSupplyLiveCandidates(report);
    const chosen = selection.candidates.find(
      (row) => row.modelId === "gemini-3.7-flash"
    );
    assert.equal(chosen?.providerSlug, "google-ai-studio");
    assert.ok(
      selection.skipped.some(
        (row) =>
          row.modelId === "gemini-3.7-flash" &&
          row.providerName === "Google" &&
          row.reason ===
            "required_request_parameters_not_advertised:temperature"
      )
    );
  });

  it("does not pay-test endpoints without factual savings/uptime/performance evidence", () => {
    const report = radarReport();
    const first = report.models[0]!;
    first.comparisons[0] = {
      ...first.comparisons[0]!,
      uptimeLast1dPercent: 98,
    };
    const selection = selectMainRpSupplyLiveCandidates(report);
    assert.equal(
      selection.candidates.some((row) => row.modelId === first.modelId),
      false
    );
    assert.ok(
      selection.skipped.some(
        (row) =>
          row.modelId === first.modelId &&
          row.reason === "uptime_1d_below_99_or_missing"
      )
    );
  });
});

describe("Main RP supply live deterministic pair and wire guard", () => {
  it("uses the frozen reference assistant for turn 2 instead of live turn-1 output", () => {
    const fixture = loadCanonicalRpQualificationFixture();
    const [turn1, turn2] = buildDeterministicSupplyProbeTurns();
    assert.equal(turn1.currentUserMessage, fixture.productionTurn1User);
    assert.equal(turn2.currentUserMessage, fixture.productionTurn2User);
    assert.ok(
      turn2.history.some(
        (row) =>
          row.role === "assistant" &&
          row.content === fixture.productionTurn1AssistantReference
      )
    );
  });

  it("pins exactly one provider, disables fallback/response replay, and preserves reasoning parity", () => {
    const selection = selectMainRpSupplyLiveCandidates(radarReport());
    const candidate = selection.candidates[0]!;
    const base = {
      model: candidate.openRouterSlug,
      messages: [{ role: "user", content: "fixture" }],
      stream: true,
    };
    const body = applyCandidateControlAndProviderPin(base, candidate);
    const provider = body.provider as Record<string, unknown>;
    assert.deepEqual(provider.only, [candidate.providerSlug]);
    assert.equal(provider.allow_fallbacks, false);
    assert.equal(provider.data_collection, "deny");
    assert.equal(provider.require_parameters, true);
    assert.equal(body.include_reasoning, false);
    assert.ok(body.reasoning);

    const headers = buildSupplyLiveRequestHeaders("benchmark");
    assert.equal(headers["X-OpenRouter-Cache"], "false");
    assert.equal(headers["X-OpenRouter-Metadata"], "enabled");
    assert.match(headers.Authorization, /^Bearer /);
  });

  it("parses generation/model/visible first delta/usage without treating malformed lines as content", () => {
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
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":40}}}',
      state,
      456
    );
    processOpenRouterSupplySseLine("data: [DONE]", state, 789);
    processOpenRouterSupplySseLine("garbage", state, 999);
    assert.equal(state.generationId, "gen-1");
    assert.equal(state.resolvedModel, "m");
    assert.equal(state.firstDeltaAtMs, 123);
    assert.equal(state.text, "안녕");
    assert.equal(state.finishReason, "stop");
    assert.equal(state.sawDone, true);
    assert.equal((state.usage as Record<string, unknown>).prompt_tokens, 100);
  });
});

describe("Main RP supply live report semantics", () => {
  it("does not create a composite quality winner and enforces provider call cap", () => {
    const selection = selectMainRpSupplyLiveCandidates(radarReport());
    const report = buildSupplyLiveReport({
      selection,
      results: [],
      generatedAt: "2026-09-28T00:00:00.000Z",
      notRunReason: "fixture_not_run",
    });
    assert.equal(report.status, "NOT_RUN");
    assert.equal(report.providerGenerationCalls, 0);
    assert.match(report.notes.join("\n"), /not automatic provider selection/i);
    assert.doesNotMatch(JSON.stringify(report), /qualityScore|winner/i);

    const source = readFileSync(
      resolve(process.cwd(), "scripts/lib/mainRpSupplyLiveQualification.ts"),
      "utf8"
    );
    assert.doesNotMatch(source, /OPENROUTER_API_KEY/);
    assert.match(source, /MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS = 10/);
  });
});
