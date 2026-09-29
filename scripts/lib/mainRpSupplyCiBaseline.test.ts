import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS, type SelectedAI } from "@/lib/chatModels";
import type { CatalogPricingEvidence } from "./mainRpMonthlyCacheAudit";
import {
  applyCurrentCiBaselineBudgetGuard,
  buildCurrentCiBaselineProbeRequest,
  buildSupplyTransportComparisonReport,
  MAIN_RP_SUPPLY_CI_BASELINE_MAX_ESTIMATED_USD,
  MAIN_RP_SUPPLY_CI_BASELINE_MAX_PROVIDER_CALLS,
  MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS,
} from "./mainRpSupplyCiBaseline";
import {
  buildMainRpSupplyRadarReport,
  type SupplyEndpointEvidence,
} from "./mainRpSupplyRadar";
import {
  buildDeterministicSupplyProbeTurns,
  buildSupplyProbeRequestBody,
  selectMainRpSupplyLiveCandidates,
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
    pricing_checked_at: "2026-09-28T00:00:00Z",
    pricing_updated_at: "2026-09-28T00:00:00Z",
  };
}

function endpoint(modelId: SelectedAI): SupplyEndpointEvidence {
  return {
    modelId,
    providerName: "FixtureProvider",
    providerTag: "fixture",
    quantization: null,
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
    supportedParameters: ["reasoning", "include_reasoning", "max_tokens", "temperature"],
    provider: {
      name: "FixtureProvider",
      slug: "fixture-provider",
      headquarters: "US",
      privacyPolicyUrl: "https://example.com/privacy",
      termsOfServiceUrl: "https://example.com/terms",
      statusPageUrl: "https://example.com/status",
      datacenters: ["US"],
    },
  };
}

function radarReport(opts?: {
  input?: number;
  output?: number;
}) {
  const endpointsByModel = Object.fromEntries(
    MAIN_RP_MODEL_IDS.map((id) => [id, [endpoint(id)]])
  );
  const ci = Object.fromEntries(
    MAIN_RP_MODEL_IDS.map((id) => [
      id,
      catalog(id, opts?.input ?? 0.3, opts?.output ?? 1.2),
    ])
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

const BASE_RADAR = radarReport();
const BASE_SELECTION = selectMainRpSupplyLiveCandidates(BASE_RADAR);

function cloneBaseRadar() {
  return structuredClone(BASE_RADAR);
}

function cloneBaseSelection() {
  return structuredClone(BASE_SELECTION);
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

describe("same-prompt current CI baseline guard", () => {
  it("keeps only radar candidates with a grounded CI catalog baseline and bounded cost", () => {
    const radar = cloneBaseRadar();
    const selection = cloneBaseSelection();
    const plan = applyCurrentCiBaselineBudgetGuard(radar, selection);

    assert.ok(plan.entries.length > 0);
    assert.ok(
      plan.entries.length * 2 <= MAIN_RP_SUPPLY_CI_BASELINE_MAX_PROVIDER_CALLS
    );
    assert.ok(
      plan.estimatedCatalogRateUsd <=
        MAIN_RP_SUPPLY_CI_BASELINE_MAX_ESTIMATED_USD
    );
    const baselineModels = new Set(
      plan.entries.map((row) => row.candidate.modelId)
    );
    assert.equal(baselineModels.size, plan.entries.length);
    assert.ok(
      plan.selection.candidates.every((row) =>
        baselineModels.has(row.modelId)
      )
    );
  });

  it("runs only one current-CI baseline plan entry for multiple candidates of the same model", () => {
    const radar = cloneBaseRadar();
    const selection = cloneBaseSelection();
    const target = selection.candidates.find((candidate) =>
      radar.models.some(
        (row) =>
          row.modelId === candidate.modelId &&
          row.currentProcurement?.provider === "cheaperinference"
      )
    );
    assert.ok(target, "fixture must include a current-CI candidate");

    selection.candidates = [
      ...selection.candidates,
      {
        ...target,
        providerName: `${target.providerName} Backup`,
        providerSlug: `${target.providerSlug}-backup`,
      },
    ];

    const plan = applyCurrentCiBaselineBudgetGuard(radar, selection);
    assert.equal(
      plan.entries.filter(
        (entry) => entry.candidate.modelId === target.modelId
      ).length,
      1
    );
    assert.equal(
      plan.selection.candidates.filter(
        (candidate) => candidate.modelId === target.modelId
      ).length,
      2
    );
  });

  it("fails closed for a current-CI candidate whose catalog baseline is missing", () => {
    const selection = cloneBaseSelection();
    const missing = cloneBaseRadar();
    const targetCandidate = selection.candidates.find((candidate) =>
      missing.models.find(
        (row) =>
          row.modelId === candidate.modelId &&
          row.currentProcurement?.provider === "cheaperinference"
      )
    );
    assert.ok(targetCandidate, "fixture must include at least one current-CI candidate");
    const target = targetCandidate.modelId;

    const targetModel = missing.models.find((row) => row.modelId === target)!;
    assert.equal(targetModel.currentProcurement?.provider, "cheaperinference");
    targetModel.currentProcurement = {
      ...targetModel.currentProcurement!,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
    };
    const plan = applyCurrentCiBaselineBudgetGuard(missing, selection);

    assert.equal(
      plan.selection.candidates.some((row) => row.modelId === target),
      false
    );
    assert.ok(
      plan.skipped.some(
        (row) =>
          row.modelId === target &&
          row.reason === "current_ci_catalog_baseline_missing"
      )
    );
  });

  it("prevents current CI baseline spend from silently exceeding the monthly estimate guard", () => {
    const radar = radarReport({ input: 200, output: 200 });
    const selection = cloneBaseSelection();
    const plan = applyCurrentCiBaselineBudgetGuard(radar, selection);

    assert.ok(
      plan.estimatedCatalogRateUsd <=
        MAIN_RP_SUPPLY_CI_BASELINE_MAX_ESTIMATED_USD
    );
    assert.ok(
      plan.skipped.some(
        (row) => row.reason === "current_ci_baseline_budget_guard"
      )
    );
  });
});

describe("same-prompt current CI request parity", () => {
  it("uses the same frozen two-turn fixture and CI session-affinity owner", () => {
    const radar = cloneBaseRadar();
    const selection = cloneBaseSelection();
    const plan = applyCurrentCiBaselineBudgetGuard(radar, selection);
    const entry = plan.entries[0]!;
    const [turn1] = buildDeterministicSupplyProbeTurns();
    const request = buildCurrentCiBaselineProbeRequest({
      candidate: entry.candidate,
      turn: turn1,
      sessionId: "supply-ci-fixture-session",
    });

    assert.equal(request.body.model, entry.candidate.modelId);
    assert.equal(request.body.stream, true);
    assert.deepEqual(request.body.stream_options, { include_usage: true });
    assert.doesNotMatch(JSON.stringify(request.body), /"provider":\s*\{/);
    assert.match(request.url, /x-ci-prompt-cache-scope=session/);
    assert.match(
      request.url,
      /x-ci-prompt-cache-session=supply-ci-fixture-session/
    );

    const candidateRequest = buildSupplyProbeRequestBody({
      candidate: entry.candidate,
      turn: turn1,
      sessionId: "supply-openrouter-fixture-session",
    });
    assert.deepEqual(
      request.body.messages,
      candidateRequest.messages,
      "candidate and current CI must receive the same assembled prompt messages"
    );
  });

  it("reuses the canonical live target-length owner instead of inventing a second size", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/lib/mainRpSupplyCiBaseline.ts"),
      "utf8"
    );
    assert.match(source, /MAIN_RP_SUPPLY_LIVE_TARGET_CHARS/);
    assert.doesNotMatch(source, /targetResponseChars:\s*1200/);
  });
});

describe("candidate vs current CI comparison semantics", () => {
  it("compares factual transport/cache/cost evidence without a winner or quality score", () => {
    const radar = cloneBaseRadar();
    const selection = cloneBaseSelection();
    const plan = applyCurrentCiBaselineBudgetGuard(radar, selection);
    const candidate = plan.entries[0]!.candidate;
    const candidateResult: SupplyLiveCandidateResult = {
      candidate,
      turns: [turn(1, 1, 3, 0, 0.02), turn(2, 0.8, 2.5, 500, 0.015)],
      providerGenerationCalls: 2,
      livePairComplete: true,
      secondTurnCacheReadObserved: true,
      transportStatus: "PAIR_COMPLETE",
      interpretation: [],
    };
    const report = buildSupplyTransportComparisonReport({
      candidateResults: [candidateResult],
      currentCiResults: [
        {
          modelId: candidate.modelId,
          turns: [turn(1, 1.5, 4, 0, 0.03), turn(2, 1, 3, 400, 0.02)],
          providerGenerationCalls: 2,
          livePairComplete: true,
          secondTurnCacheReadObserved: true,
          estimatedPairCatalogRateUsd:
            plan.entries[0]!.estimatedPairCatalogRateUsd,
        },
      ],
      generatedAt: "2026-09-28T00:00:00.000Z",
    });

    assert.equal(report.providerGenerationCalls, 4);
    assert.ok(
      report.providerGenerationCalls <= MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS
    );
    assert.equal(report.rows[0]!.candidateAverageTtftSeconds, 0.9);
    assert.equal(report.rows[0]!.currentCiAverageTtftSeconds, 1.25);
    assert.match(report.notes.join("\n"), /not an automatic provider selection/i);
    assert.doesNotMatch(JSON.stringify(report), /qualityScore|winner|ranking/i);
  });

  it("runner requires the existing CI benchmark credential before any paid comparison", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/main-rp-supply-live-qualification.ts"),
      "utf8"
    );
    assert.match(
      source,
      /resolveOptInTestCheaperInferenceApiKey\(LIVE_FLAG\)/
    );
    assert.match(
      source,
      /missing_cheaper_inference_benchmark_credential/
    );
    assert.doesNotMatch(source, /CHEAPER_INFERENCE_API_KEY/);
    assert.match(
      source,
      /const modelCandidates = selection\.candidates\.filter/
    );
    assert.match(source, /if \(result\.livePairComplete\) break;/);
  });
});
