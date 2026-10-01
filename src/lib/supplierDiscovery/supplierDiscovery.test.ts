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
  FLUENCE_GPU_COMPUTE_PRODUCT_ID,
  FLUENCE_GPU_CONSOLE_ACCESS_FIXTURE,
  FLUENCE_GPU_INFERENCE_PAGE_FIXTURE,
  FLUENCE_HOSTED_INFERENCE_ADVERTISED_API_BASE,
  FLUENCE_HOSTED_INFERENCE_FIXTURE,
  FLUENCE_HOSTED_INFERENCE_ORIGIN,
  FLUENCE_HOSTED_INFERENCE_PRODUCT_ID,
  FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
  fluenceGpuComputeProfile,
  fluenceHostedInferenceProfile,
  fluenceObservedPublicProfile,
} from "./fluencePublicEvidence";
import { selectProductProfile } from "./productIdentity";
import { INDEPENDENT_SUPPLIER_QUALIFICATION_CHECKS } from "./qualificationContract";
import { screenSupplierPublicProfile } from "./publicScreen";
import type { SupplierPublicProfile } from "./types";

function completeTokenProfile(overrides: Partial<SupplierPublicProfile> = {}): SupplierPublicProfile {
  const base: SupplierPublicProfile = {
    supplierId: "example-supplier",
    companyName: "Example Supplier",
    productId: "example-hosted-inference",
    productKind: "hosted_token_inference",
    canonicalOrigin: "https://example.test",
    advertisedApiBaseUrl: null,
    observedOfferFacts: [],
    credentialState: "unspecified",
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

  it("records the hosted inference product as WAITLIST and does not call providers", () => {
    const profile = fluenceObservedPublicProfile();
    assert.equal(profile.supplierId, "fluence");
    assert.equal(profile.companyName, "Fluence");
    assert.equal(profile.productId, FLUENCE_HOSTED_INFERENCE_PRODUCT_ID);
    assert.equal(profile.productKind, "hosted_token_inference");
    assert.equal(profile.canonicalOrigin, FLUENCE_HOSTED_INFERENCE_ORIGIN);
    assert.equal(profile.advertisedApiBaseUrl, FLUENCE_HOSTED_INFERENCE_ADVERTISED_API_BASE);
    assert.equal(profile.waitlist, true);
    assert.equal(profile.priceUnit, "usd_per_million_tokens");
    assert.equal(profile.inputUsdPerMillion, null);
    assert.equal(profile.outputUsdPerMillion, null);
    assert.equal(profile.retentionZdr, "advertised");
    assert.equal(profile.credentialState, "founding_seat_reserved_without_api_credential");
    assert.equal(profile.streamingAdvertised, null);
    assert.equal(profile.usageReportingAdvertised, "unknown");
    assert.deepEqual([...profile.supportedActiveModelIds], []);

    const report = buildSupplierDiscoveryReport({
      generatedAt: FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
    });
    assert.equal(report.providerGenerationCalls, 0);
    assert.equal(report.candidates.length, 1);
    const fluence = report.candidates[0]!;
    assert.equal(fluence.productId, FLUENCE_HOSTED_INFERENCE_PRODUCT_ID);
    assert.equal(fluence.discoverySource, "independent_candidate_registry");
    assert.equal(fluence.publicScreenStatus, "WAITLIST");
    assert.equal(fluence.status, "WAITLIST");
    assert.equal(fluence.publicScreenReasons[0], "waitlist");
    assert.ok(fluence.publicScreenReasons.includes("canonical_token_pricing_incomplete"));
    assert.equal(fluence.publicScreenReasons.includes("canonical_token_pricing_absent"), false);
    assert.equal(fluence.priceAdvantage, "unknown");
    assert.equal(fluence.credentialRequirement, "waitlist_credential_not_requested");
    assert.equal(fluence.liveQualification.status, "NOT_RUN");
    assert.equal(fluence.liveQualification.reason, "waitlist");
    assert.equal(fluence.liveQualification.providerGenerationCalls, 0);
    assert.equal(fluence.liveQualification.outputQualityScored, false);
    assert.equal(fluence.liveQualification.checks.length, INDEPENDENT_SUPPLIER_QUALIFICATION_CHECKS.length);
    assert.equal(fluence.promotion.draftRoutePrEligible, false);
    assert.equal(fluence.promotion.automaticMergeEligible, false);
    assert.equal(fluence.promotion.transitionKind, "CROSS_PROVIDER_PROCUREMENT");
    assert.deepEqual(supplierDiscoveryNotificationTargets(report), []);
  });

  it("keeps GPU compute evidence from overwriting the hosted inference candidate", () => {
    const gpu = fluenceGpuComputeProfile();
    assert.equal(gpu.productId, FLUENCE_GPU_COMPUTE_PRODUCT_ID);
    assert.equal(gpu.productKind, "gpu_compute_marketplace");
    assert.equal(gpu.canonicalOrigin, "https://fluence.ai");
    assert.equal(gpu.waitlist, false);
    assert.equal(gpu.priceUnit, "gpu_hourly");
    assert.equal(gpu.openaiCompatible, "customer_runtime_only");

    const poisoned = fluenceHostedInferenceProfile(
      [
        FLUENCE_HOSTED_INFERENCE_FIXTURE,
        FLUENCE_GPU_CONSOLE_ACCESS_FIXTURE,
        FLUENCE_GPU_INFERENCE_PAGE_FIXTURE,
      ].join("\n")
    );
    assert.equal(poisoned.productId, FLUENCE_HOSTED_INFERENCE_PRODUCT_ID);
    assert.equal(poisoned.waitlist, true);
    assert.equal(poisoned.priceUnit, "usd_per_million_tokens");
    assert.equal(poisoned.inputUsdPerMillion, null);
    assert.notEqual(poisoned.canonicalOrigin, gpu.canonicalOrigin);

    const selected = selectProductProfile(
      [gpu, poisoned],
      FLUENCE_HOSTED_INFERENCE_PRODUCT_ID
    );
    assert.equal(selected.productId, poisoned.productId);
    assert.equal(selected.waitlist, true);
    assert.equal(selected.priceUnit, "usd_per_million_tokens");
    assert.equal(fluenceObservedPublicProfile().productId, FLUENCE_HOSTED_INFERENCE_PRODUCT_ID);
  });

  it("does not treat a GPU hourly price, or a token price alone, as ready", () => {
    const gpuOnly = screenSupplierPublicProfile(fluenceGpuComputeProfile());
    assert.equal(gpuOnly.status, "PUBLIC_SCREEN_HOLD");
    assert.equal(gpuOnly.reasons.includes("public_gates_passed"), false);
    const hosted = screenSupplierPublicProfile(fluenceHostedInferenceProfile());
    assert.equal(hosted.status, "WAITLIST");
    assert.equal(hosted.reasons.includes("public_gates_passed"), false);

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
    const profile = fluenceHostedInferenceProfile();
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
