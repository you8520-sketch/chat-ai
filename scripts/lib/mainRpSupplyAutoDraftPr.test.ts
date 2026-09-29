import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";
import type { MainRpSupplyPromotionProposalPacket } from "./mainRpSupplyPromotionProposal";
import {
  planMainRpSupplyAutoDrafts,
  serializeRouteConfig,
  type MainRpOpenRouterRouteConfig,
} from "./mainRpSupplyAutoDraftPr";

function packet(): MainRpSupplyPromotionProposalPacket {
  return {
    version: 1,
    generatedAt: "2026-10-22T00:00:00.000Z",
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
        testedRoute: {
          providerSlug: "alternative-studio",
          serviceTier: null,
        },
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
        testedRoute: {
          providerSlug: "wafer",
          serviceTier: null,
        },
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

describe("Main RP supplier auto Draft PR planner", () => {
  it("plans only same-OpenRouter promotion and uses the exact tested no-tier route", () => {
    const result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      routeConfig: routes(),
    });

    assert.equal(result.plans.length, 1);
    assert.equal(result.automaticMergeEligibleCount, 0);

    const plan = result.plans[0]!;
    assert.equal(plan.modelId, "gemini-3.7-flash");
    assert.equal(plan.openRouterSlug, "google/gemini-3.7-flash");
    assert.deepEqual(plan.currentRoute, {
      providerSlug: "google-ai-studio",
      serviceTier: "flex",
    });
    assert.deepEqual(plan.proposedRoute, {
      providerSlug: "alternative-studio",
      serviceTier: null,
    });
    assert.deepEqual(plan.proposedConfig["google/gemini-3.7-flash"], {
      providerSlug: "alternative-studio",
      serviceTier: null,
    });
    assert.deepEqual(plan.proposedConfig["google/gemini-3.1-pro-preview"], {
      providerSlug: "google-ai-studio",
      serviceTier: "flex",
    });
    assert.match(plan.body, /Automatic merge is prohibited/);
    assert.match(plan.body, /Restore/);
    assert.match(plan.body, /proposed service tier: `null`/);

    assert.ok(
      result.skipped.some(
        (row) =>
          row.modelId === "deepseek-v4.1-flash" &&
          row.reason.includes("provider_call_cost_or_billing_path_changes")
      )
    );
  });

  it("fails closed if candidate provider slug drifted from the tested route", () => {
    const value = packet();
    value.proposals[0] = {
      ...value.proposals[0]!,
      testedRoute: {
        providerSlug: "different-provider",
        serviceTier: null,
      },
    };
    const result = planMainRpSupplyAutoDrafts({
      packet: value,
      radar: radar(),
      routeConfig: routes(),
    });
    assert.equal(result.plans.length, 0);
    assert.equal(
      result.skipped[0]?.reason,
      "candidate_provider_slug_invalid_or_drifted"
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
      routeConfig: routes(),
    });
    assert.equal(result.plans.length, 0);
    assert.equal(result.skipped[0]?.reason, "radar_current_procurement_not_openrouter");

    const missing = routes();
    delete missing["google/gemini-3.7-flash"];
    result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      routeConfig: missing,
    });
    assert.equal(result.plans.length, 0);
    assert.equal(result.skipped[0]?.reason, "canonical_route_entry_missing");
  });

  it("does not create another Draft when production already uses the candidate", () => {
    const current = routes();
    current["google/gemini-3.7-flash"] = {
      providerSlug: "alternative-studio",
      serviceTier: null,
    };
    const result = planMainRpSupplyAutoDrafts({
      packet: packet(),
      radar: radar(),
      routeConfig: current,
    });
    assert.equal(result.plans.length, 0);
    assert.equal(result.skipped[0]?.reason, "already_routed_to_candidate");
  });

  it("serializes route config deterministically", () => {
    const text = serializeRouteConfig({
      "z/model": { providerSlug: "z", serviceTier: null },
      "a/model": { providerSlug: "a", serviceTier: "flex" },
    });
    assert.ok(text.indexOf('"a/model"') < text.indexOf('"z/model"'));
    assert.ok(text.endsWith("\n"));
  });

  it("runner has no merge API and scopes write automation to Draft PR creation", () => {
    const source = readFileSync(
      new URL("../main-rp-supply-auto-draft-pr.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(source, /\/merge(?:s|\b)|merge_pull|automaticMerge\s*=\s*true/i);
    assert.match(source, /draft:\s*true/);
    assert.match(source, /STOP_REPOSITORY_PR_CREATION_SETTING/);
    assert.match(source, /deleteAutomationBranch/);
  });
});
