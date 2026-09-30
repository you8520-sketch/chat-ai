import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";
import type {
  MainRpSupplyLiveQualificationReport,
  SupplyLiveCandidate,
  SupplyLiveTurnResult,
} from "./mainRpSupplyLiveQualification";
import type { MainRpSupplyPromotionProposalPacket } from "./mainRpSupplyPromotionProposal";
import {
  planMainRpSupplyAutoDrafts,
  serializeRouteConfig,
  type MainRpOpenRouterRouteConfig,
} from "./mainRpSupplyAutoDraftPr";

const GENERATED_AT = "2026-10-22T03:50:00.000Z";

function packet(): MainRpSupplyPromotionProposalPacket {
  return {
    version: 1,
    generatedAt: GENERATED_AT,
    automaticMergeEligibleCount: 0,
    draftRoutePrEligibleCount: 1,
    crossProviderReviewRequiredCount: 1,
    notes: [],
    proposals: [
      {
        modelId: "gemini-3.7-flash",
        candidateProviderName: "Alternative Studio",
        candidateProviderSlug: "alternative-studio",
        currentProcurementProvider: "openrouter",
        transitionKind: "SAME_OPENROUTER_TRANSPORT",
        draftRoutePrEligible: true,
        automaticMergeEligible: false,
        stopReason: null,
        evidence: {
          qualifyingMarketSnapshots: 4,
          marketObservationSpanDays: 21,
          completeLivePairs: 2,
          liveObservationSpanDays: 21,
          latestSavingsPercent: 18,
          worstCandidateTotalVsBaselineRatio: 0.82,
          worstCandidateTtftVsBaselineRatio: 0.9,
        },
        requiredReviewOwners: [],
      },
      {
        modelId: "deepseek-v4.1-flash",
        candidateProviderName: "Wafer",
        candidateProviderSlug: "wafer",
        currentProcurementProvider: "cheaperinference",
        transitionKind: "CROSS_PROVIDER_PROCUREMENT",
        draftRoutePrEligible: false,
        automaticMergeEligible: false,
        stopReason:
          "provider_call_cost_or_billing_path_changes_require_explicit_review_before_route_mutation",
        evidence: {
          qualifyingMarketSnapshots: 4,
          marketObservationSpanDays: 21,
          completeLivePairs: 2,
          liveObservationSpanDays: 21,
          latestSavingsPercent: 17.3,
          worstCandidateTotalVsBaselineRatio: 0.5,
          worstCandidateTtftVsBaselineRatio: 0.8,
        },
        requiredReviewOwners: [],
      },
    ],
  };
}

function radar(): MainRpSupplyRadarReport {
  return {
    version: 1,
    generatedAt: "2026-10-22T03:47:00.000Z",
    status: "OK",
    providerGenerationCalls: 0,
    activeModelIds: ["deepseek-v4.1-flash", "gemini-3.7-flash"],
    credentialSource: "fixture",
    currentProcurementEvidence: "registry_route_evidence",
    marketEvidence: "openrouter_endpoint_metrics",
    notes: [],
    models: [
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
    ],
  };
}

function candidate(): SupplyLiveCandidate {
  return {
    modelId: "gemini-3.7-flash",
    openRouterSlug: "google/gemini-3.7-flash",
    providerName: "Alternative Studio",
    providerSlug: "alternative-studio",
    quantization: null,
    rawEndpointRateDeltaVsCurrentProcurementPercent: -0.18,
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 1.25,
    cacheReadUsdPerMillion: null,
    marketLatencyP50SecondsLast30m: 1.1,
    marketThroughputP50TokensPerSecondLast30m: 60,
    marketUptimeLast1dPercent: 99.95,
    marketUptimeLast30mPercent: 100,
    controlEffort: "minimal",
    excludeReasoning: true,
    estimatedPairRawEndpointRateUsd: 0.03,
  };
}

function turn(turn: 1 | 2, servedProviderMatch: boolean | null = true): SupplyLiveTurnResult {
  return {
    turn,
    httpStatus: 200,
    generationId: `gen-${turn}`,
    resolvedModel: "google/gemini-3.7-flash",
    finishReason: "stop",
    sawDone: true,
    text: `turn-${turn}`,
    visibleChars: 1500,
    ttftSeconds: 1,
    totalSeconds: 10,
    visibleCharsPerSecondAfterTtft: 166,
    promptTokens: 40_000,
    completionTokens: 2_000,
    reasoningTokens: 0,
    cacheReadTokens: turn === 2 ? 1_000 : 0,
    cacheWriteTokens: 0,
    providerReportedCostUsd: 0.02,
    providerMetadata: null,
    servedProviderMatch,
    error: null,
  };
}

function live(): MainRpSupplyLiveQualificationReport {
  const c = candidate();
  return {
    version: 1,
    generatedAt: GENERATED_AT,
    status: "OK",
    providerGenerationCalls: 2,
    maxProviderGenerationCalls: 10,
    activeModelIds: ["gemini-3.7-flash"],
    selection: {
      candidates: [c],
      skipped: [],
      maxProviderGenerationCalls: 10,
      estimatedRawEndpointRateUsd: 0.03,
    },
    results: [
      {
        candidate: c,
        turns: [turn(1), turn(2)],
        providerGenerationCalls: 2,
        livePairComplete: true,
        secondTurnCacheReadObserved: true,
        transportStatus: "PAIR_COMPLETE",
        interpretation: [],
      },
    ],
    notes: [],
  };
}

function routes(): MainRpOpenRouterRouteConfig {
  return {
    "google/gemini-3.1-pro-preview": {
      providerSlug: "google-ai-studio",
      serviceTier: "flex",
    },
    "google/gemini-3.7-flash": {
      providerSlug: "google-ai-studio",
      serviceTier: "flex",
    },
    "google/gemini-3.8-flash": {
      providerSlug: "google-ai-studio",
      serviceTier: "flex",
    },
  };
}

describe("Main RP supplier auto Draft PR planner v2", () => {
  it("plans only same-OpenRouter promotion with a fresh complete pair and preserves the production service tier", () => {
    const result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      live: live(),
      routeConfig: routes(),
    });

    assert.equal(result.plans.length, 1);
    assert.equal(result.automaticMergeEligibleCount, 0);

    const plan = result.plans[0]!;
    assert.equal(plan.modelId, "gemini-3.7-flash");
    assert.deepEqual(plan.currentRoute, {
      providerSlug: "google-ai-studio",
      serviceTier: "flex",
    });
    assert.deepEqual(plan.proposedRoute, {
      providerSlug: "alternative-studio",
      serviceTier: "flex",
    });
    assert.deepEqual(plan.proposedConfig["google/gemini-3.7-flash"], {
      providerSlug: "alternative-studio",
      serviceTier: "flex",
    });
    assert.match(plan.body, /Automatic merge is prohibited/);
    assert.match(plan.body, /proposed service tier: \`"flex"\`/);
    assert.match(plan.body, /provider pin is the only route-data change/);

    assert.ok(
      result.skipped.some(
        (row) =>
          row.modelId === "deepseek-v4.1-flash" &&
          row.reason.includes("provider_call_cost_or_billing_path_changes")
      )
    );
  });

  it("fails closed when the promotion-ready candidate was not freshly tested in the current monthly run", () => {
    const currentLive = live();
    currentLive.results = [];
    const result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      live: currentLive,
      routeConfig: routes(),
    });
    assert.equal(result.plans.length, 0);
    assert.equal(
      result.skipped.find((row) => row.modelId === "gemini-3.7-flash")?.reason,
      "fresh_live_candidate_not_tested_this_run"
    );
  });

  it("fails closed when the fresh pair is incomplete or provider identity is unproven", () => {
    let currentLive = live();
    currentLive.results[0] = {
      ...currentLive.results[0]!,
      livePairComplete: false,
      transportStatus: "PAIR_INCOMPLETE",
      turns: [turn(1)],
    };
    let result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      live: currentLive,
      routeConfig: routes(),
    });
    assert.equal(
      result.skipped.find((row) => row.modelId === "gemini-3.7-flash")?.reason,
      "fresh_live_pair_incomplete"
    );

    currentLive = live();
    currentLive.results[0] = {
      ...currentLive.results[0]!,
      turns: [turn(1, true), turn(2, null)],
    };
    result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      live: currentLive,
      routeConfig: routes(),
    });
    assert.equal(
      result.skipped.find((row) => row.modelId === "gemini-3.7-flash")?.reason,
      "fresh_live_provider_identity_unproven"
    );
  });

  it("fails closed when live evidence is not from the current radar run window", () => {
    const currentLive = live();
    currentLive.generatedAt = "2026-10-21T00:00:00.000Z";
    const result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      live: currentLive,
      routeConfig: routes(),
    });
    assert.equal(
      result.skipped.find((row) => row.modelId === "gemini-3.7-flash")?.reason,
      "fresh_live_report_missing_or_stale"
    );
  });

  it("fails closed if current procurement or canonical route owner drifted", () => {
    const current = radar();
    current.models[0] = {
      ...current.models[0]!,
      currentProcurement: {
        ...current.models[0]!.currentProcurement!,
        provider: "cheaperinference",
      },
    };
    let result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: current,
      live: live(),
      routeConfig: routes(),
    });
    assert.equal(result.plans.length, 0);
    assert.equal(
      result.skipped.find((row) => row.modelId === "gemini-3.7-flash")?.reason,
      "radar_current_procurement_not_openrouter"
    );

    const missing = routes();
    delete missing["google/gemini-3.7-flash"];
    result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      live: live(),
      routeConfig: missing,
    });
    assert.equal(
      result.skipped.find((row) => row.modelId === "gemini-3.7-flash")?.reason,
      "canonical_route_entry_missing"
    );
  });

  it("does not create another Draft when production already uses the candidate", () => {
    const current = routes();
    current["google/gemini-3.7-flash"] = {
      providerSlug: "alternative-studio",
      serviceTier: "flex",
    };
    const result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      live: live(),
      routeConfig: current,
    });
    assert.equal(result.plans.length, 0);
    assert.equal(
      result.skipped.find((row) => row.modelId === "gemini-3.7-flash")?.reason,
      "already_routed_to_candidate"
    );
  });

  it("serializes route config deterministically", () => {
    const text = serializeRouteConfig({
      "z/model": { providerSlug: "z", serviceTier: null },
      "a/model": { providerSlug: "a", serviceTier: "flex" },
    });
    assert.ok(text.indexOf('"a/model"') < text.indexOf('"z/model"'));
    assert.ok(text.endsWith("\n"));
  });

  it("write-capable job is monthly-only, least-privilege, and never persists the write token in checkout", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/main-rp-supply-radar.yml", import.meta.url),
      "utf8"
    );
    const writeJob = workflow.split("  auto-draft-provider-pr:")[1] ?? "";
    assert.match(
      writeJob,
      /if:\s*github\.event_name == 'schedule' && github\.event\.schedule == '47 3 1 \* \*'/
    );
    assert.match(
      writeJob,
      /permissions:[\s\S]*contents:\s*write[\s\S]*pull-requests:\s*write[\s\S]*actions:\s*read/
    );
    assert.match(
      writeJob,
      /uses:\s*actions\/checkout@v5[\s\S]{0,180}?persist-credentials:\s*false/
    );
  });

  it("runner CLI consumes a no-plan artifact packet and exits without GitHub writes", () => {
    const outDir = mkdtempSync(join(tmpdir(), "supply-auto-draft-noop-"));
    mkdirSync(join(outDir, "live"), { recursive: true });

    try {
      writeFileSync(
        join(outDir, "promotion-proposals.json"),
        JSON.stringify({
          version: 1,
          generatedAt: GENERATED_AT,
          proposals: [],
          draftRoutePrEligibleCount: 0,
          crossProviderReviewRequiredCount: 0,
          automaticMergeEligibleCount: 0,
          notes: [],
        })
      );
      writeFileSync(
        join(outDir, "report.json"),
        JSON.stringify({
          version: 1,
          generatedAt: "2026-10-22T03:47:00.000Z",
          status: "OK",
          providerGenerationCalls: 0,
          activeModelIds: [],
          credentialSource: "fixture",
          currentProcurementEvidence: "registry_route_evidence",
          marketEvidence: "openrouter_endpoint_metrics",
          notes: [],
          models: [],
        })
      );
      writeFileSync(
        join(outDir, "live", "live-qualification.json"),
        JSON.stringify({
          version: 1,
          generatedAt: GENERATED_AT,
          status: "OK",
          providerGenerationCalls: 0,
          maxProviderGenerationCalls: 10,
          activeModelIds: [],
          selection: {
            candidates: [],
            skipped: [],
            maxProviderGenerationCalls: 10,
            estimatedRawEndpointRateUsd: 0,
          },
          results: [],
          notes: [],
        })
      );

      const result = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/main-rp-supply-auto-draft-pr.ts",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR: outDir,
            MAIN_RP_SUPPLY_AUTO_DRAFT_DRY_RUN: "1",
            GITHUB_TOKEN: "",
            GITHUB_REPOSITORY: "",
            GITHUB_SHA: "",
          },
          encoding: "utf8",
          timeout: 30_000,
        }
      );

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = JSON.parse(
        readFileSync(join(outDir, "auto-draft-results.json"), "utf8")
      ) as {
        draftPrCreatedCount: number;
        automaticMergeEligibleCount: number;
        productionMainRouteMutations: number;
        plans: unknown[];
      };
      assert.equal(output.draftPrCreatedCount, 0);
      assert.equal(output.automaticMergeEligibleCount, 0);
      assert.equal(output.productionMainRouteMutations, 0);
      assert.deepEqual(output.plans, []);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("runner contains Draft creation but no merge API or production-main mutation", () => {
    const source = readFileSync(
      new URL("../main-rp-supply-auto-draft-pr.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(source, /\/merge(?:s|\b)|merge_pull|automaticMerge\s*=\s*true/i);
    assert.match(source, /draft:\s*true/);
    assert.match(source, /STOP_REPOSITORY_PR_CREATION_SETTING/);
    assert.match(source, /STOP_MAIN_MOVED/);
    assert.match(source, /deleteAutomationBranch/);
  });
});
