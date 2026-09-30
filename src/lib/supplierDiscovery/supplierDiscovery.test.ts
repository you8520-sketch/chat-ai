import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAIN_RP_USER_SELECTABLE_OPTIONS, type SelectedAI } from "@/lib/chatModels";
import { DIRECT_SUPPLIER_PUBLIC_RADAR_IDS } from "./directSupplierTargets";
import {
  buildIndependentSupplierCandidate,
  buildSupplierDiscoveryReport,
  supplierDiscoveryNotificationTargets,
} from "./discoverSuppliers";
import {
  FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
  parseFluencePublicPages,
  fluenceObservedPublicProfile,
} from "./fluencePublicEvidence";
import { INDEPENDENT_SUPPLIER_QUALIFICATION_CHECKS } from "./qualificationContract";
import { screenSupplierPublicProfile } from "./publicScreen";
import type { SupplierPublicProfile } from "./types";

function completeTokenProfile(overrides: Partial<SupplierPublicProfile> = {}): SupplierPublicProfile {
  const base: SupplierPublicProfile = {
    supplierId: "example-supplier",
    companyName: "Example Supplier",
    website: "https://example.test",
    apiDocsUrl: "https://example.test/docs",
    pricingUrl: "https://example.test/pricing",
    statusUrl: "https://status.example.test",
    privacyPolicyUrl: "https://example.test/privacy",
    termsUrl: "https://example.test/terms",
    retentionZdr: "advertised",
    openaiCompatible: "yes",
    chatCompletionsAdvertised: true,
    streamingAdvertised: true,
    usageReportingAdvertised: "token_usage",
    waitlist: false,
    supportedActiveModelIds: ["gpt-5.6-terra"] as readonly SelectedAI[],
    modelProvenanceEvidence: "vendor_model_id_published",
    companyIdentityEvidence: "legal_name_published",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4,
    cacheReadUsdPerMillion: 0.01,
    cachePricing: "published",
    contextLimitTokens: 128000,
    longContextTierPricing: "published",
    publicStabilityEvidence: "status_page_30d",
    priceUnit: "usd_per_million_tokens",
    betaLimitation: null,
  };
  return { ...base, ...overrides };
}

describe("supplier discovery gap", () => {
  it("keeps Fluence out of the direct supplier radar and the production model registry", () => {
    assert.deepEqual([...DIRECT_SUPPLIER_PUBLIC_RADAR_IDS], ["onemux", "aireiter", "dit"]);
    assert.equal(
      (DIRECT_SUPPLIER_PUBLIC_RADAR_IDS as readonly string[]).includes("fluence"),
      false
    );
    assert.equal(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((option) => /fluence/i.test(option.id)),
      false
    );
    assert.equal(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((option) =>
        String(option.provider).toLowerCase().includes("fluence")
      ),
      false
    );
  });

  it("records Fluence from public pages and holds it without a generation call", () => {
    const profile = fluenceObservedPublicProfile();
    assert.equal(profile.supplierId, "fluence");
    assert.equal(profile.companyName, "Fluence");
    assert.equal(profile.website, "https://fluence.ai");
    assert.equal(profile.apiDocsUrl, "https://fluence.dev/docs/build/api/overview");
    assert.equal(profile.pricingUrl, "https://fluence.ai/solutions/ai-inference");
    assert.equal(profile.openaiCompatible, "customer_runtime_only");
    assert.equal(profile.chatCompletionsAdvertised, false);
    assert.equal(profile.waitlist, false);
    assert.equal(profile.priceUnit, "gpu_hourly");
    assert.equal(profile.inputUsdPerMillion, null);
    assert.deepEqual([...profile.supportedActiveModelIds], []);

    const report = buildSupplierDiscoveryReport({
      generatedAt: FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
    });
    assert.equal(report.providerGenerationCalls, 0);
    assert.equal(report.candidates.length, 1);
    const fluence = report.candidates[0]!;
    assert.equal(fluence.supplierId, "fluence");
    assert.equal(fluence.discoverySource, "independent_candidate_registry");
    assert.equal(fluence.publicScreenStatus, "PUBLIC_SCREEN_HOLD");
    assert.equal(fluence.status, "PUBLIC_SCREEN_HOLD");
    assert.ok(fluence.publicScreenReasons.includes("canonical_token_pricing_absent"));
    assert.ok(fluence.publicScreenReasons.includes("hosted_openai_compatibility_unproven"));
    assert.ok(fluence.publicScreenReasons.includes("chat_completions_not_advertised"));
    assert.ok(fluence.publicScreenReasons.includes("zdr_unverified"));
    assert.equal(fluence.priceAdvantage, "not_comparable");
    assert.equal(fluence.credentialRequirement, "not_requested_until_public_screen_passes");
    assert.equal(fluence.liveQualification.status, "NOT_RUN");
    assert.equal(fluence.liveQualification.providerGenerationCalls, 0);
    assert.equal(fluence.liveQualification.outputQualityScored, false);
    assert.equal(fluence.liveQualification.checks.length, INDEPENDENT_SUPPLIER_QUALIFICATION_CHECKS.length);
    assert.equal(fluence.promotion.draftRoutePrEligible, false);
    assert.equal(fluence.promotion.automaticMergeEligible, false);
    assert.equal(fluence.promotion.transitionKind, "CROSS_PROVIDER_PROCUREMENT");
    assert.deepEqual(supplierDiscoveryNotificationTargets(report), []);
  });

  it("does not treat a GPU hourly price, or a token price alone, as ready", () => {
    const gpuOnly = screenSupplierPublicProfile(fluenceObservedPublicProfile());
    assert.equal(gpuOnly.status, "PUBLIC_SCREEN_HOLD");
    assert.equal(gpuOnly.reasons.includes("public_gates_passed"), false);

    const priceOnly = screenSupplierPublicProfile(
      completeTokenProfile({
        privacyPolicyUrl: null,
        termsUrl: null,
        retentionZdr: "unknown",
        openaiCompatible: "unknown",
        chatCompletionsAdvertised: null,
        streamingAdvertised: null,
        usageReportingAdvertised: "unknown",
        supportedActiveModelIds: [],
        modelProvenanceEvidence: null,
        companyIdentityEvidence: null,
        publicStabilityEvidence: null,
        contextLimitTokens: null,
        longContextTierPricing: "unknown",
        cachePricing: "unknown",
        waitlist: null,
      })
    );
    assert.equal(priceOnly.status, "PUBLIC_SCREEN_HOLD");
    assert.ok(priceOnly.reasons.length > 1);
  });

  it("classifies a Fluence waitlist announcement as WAITLIST and does not notify", () => {
    const profile = parseFluencePublicPages({
      apiOverviewText: "The Fluence API provides programmatic access to the decentralized Fluence compute marketplace.",
      inferencePageText: "H100 Price $1.24 /per hr",
      accessAnnouncementText: "API access is currently a waitlist.",
      customerRuntimeText: "",
    });
    assert.equal(profile.waitlist, true);
    const candidate = buildIndependentSupplierCandidate({
      profile,
      credentialConfigured: false,
      discoveredAt: FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
      lastSeenAt: FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
      discoverySource: "independent_candidate_registry",
      evidenceFreshness: "fixture",
    });
    assert.equal(candidate.status, "WAITLIST");
    assert.equal(candidate.promotion.draftRoutePrEligible, false);
    assert.deepEqual(
      supplierDiscoveryNotificationTargets({
        ...buildSupplierDiscoveryReport(),
        candidates: [candidate],
      }),
      []
    );
  });

  it("asks for a credential only after every public gate passes, and still blocks route drafts", () => {
    const held = buildIndependentSupplierCandidate({
      profile: completeTokenProfile(),
      credentialConfigured: false,
      discoveredAt: "2026-09-30T00:00:00.000Z",
      lastSeenAt: "2026-09-30T00:00:00.000Z",
      discoverySource: "independent_candidate_registry",
      evidenceFreshness: "fixture",
    });
    assert.equal(held.status, "CREDENTIAL_REQUIRED");
    assert.equal(held.liveQualification.reason, "missing_credential");
    assert.equal(held.promotion.draftRoutePrEligible, false);
    assert.equal(held.promotion.automaticMergeEligible, false);

    const ready = buildIndependentSupplierCandidate({
      profile: completeTokenProfile(),
      credentialConfigured: true,
      discoveredAt: "2026-09-30T00:00:00.000Z",
      lastSeenAt: "2026-09-30T00:00:00.000Z",
      discoverySource: "independent_candidate_registry",
      evidenceFreshness: "fixture",
    });
    assert.equal(ready.status, "READY_FOR_LIVE_QUALIFICATION");
    assert.equal(ready.liveQualification.status, "NOT_RUN");
    assert.equal(ready.liveQualification.providerGenerationCalls, 0);
    assert.equal(ready.promotion.draftRoutePrEligible, false);

    const targets = supplierDiscoveryNotificationTargets({
      ...buildSupplierDiscoveryReport(),
      candidates: [held, ready],
    });
    assert.deepEqual(
      targets.map((target) => target.status),
      ["CREDENTIAL_REQUIRED", "READY_FOR_LIVE_QUALIFICATION"]
    );
  });

  it("reuses attached OpenRouter provider names without creating independent candidates", () => {
    const report = buildSupplierDiscoveryReport({
      openRouterProviderNames: ["DeepInfra", "Fluence", "DeepInfra"],
    });
    assert.equal(report.openRouterFeed.status, "ATTACHED");
    assert.equal(report.openRouterFeed.providerNameCount, 2);
    assert.equal(report.openRouterFeed.fluenceNamed, true);
    assert.equal(report.openRouterFeed.independentCandidatesAdded, 0);
    assert.equal(report.candidates.length, 1);
    assert.equal(report.candidates[0]!.supplierId, "fluence");
    assert.equal(report.providerGenerationCalls, 0);
    assert.equal(
      report.sources.find((source) => source.id === "artificial_analysis_providers")
        ?.implemented,
      false
    );
    assert.equal(
      report.sources.find((source) => source.id === "bounded_web_search")?.newSecretRequired,
      true
    );
  });
});
