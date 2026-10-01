import type { SelectedAI } from "@/lib/chatModels";

export const SUPPLIER_DISCOVERY_VERSION = 2;

export type SupplierProductKind =
  | "hosted_token_inference"
  | "gpu_compute_marketplace"
  | "unspecified";

export type SupplierCandidateStatus =
  | "DISCOVERED"
  | "PUBLIC_SCREEN_PASS"
  | "PUBLIC_SCREEN_HOLD"
  | "WAITLIST"
  | "CREDENTIAL_REQUIRED"
  | "READY_FOR_LIVE_QUALIFICATION"
  | "REJECTED";

export type PublicScreenStatus =
  | "PUBLIC_SCREEN_PASS"
  | "PUBLIC_SCREEN_HOLD"
  | "WAITLIST"
  | "REJECTED";

export type OpenAiCompatibility =
  | "yes"
  | "no"
  | "customer_runtime_only"
  | "unknown";

export type UsageReportingAdvertised = "token_usage" | "other" | "unknown";

export type TokenPriceUnit = "usd_per_million_tokens" | "gpu_hourly" | "unknown";

export type EvidencePresence = "published" | "not_offered" | "unknown";

export type SupplierPublicProfile = {
  supplierId: string;
  companyName: string;
  productId: string;
  productKind: SupplierProductKind;
  canonicalOrigin: string;
  advertisedApiBaseUrl: string | null;
  observedOfferFacts: readonly string[];
  credentialState: string;
  website: string;
  apiDocsUrl: string | null;
  pricingUrl: string | null;
  statusUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  retentionZdr: "advertised" | "not_advertised" | "unknown";
  openaiCompatible: OpenAiCompatibility;
  chatCompletionsAdvertised: boolean | null;
  streamingAdvertised: boolean | null;
  usageReportingAdvertised: UsageReportingAdvertised;
  waitlist: boolean | null;
  supportedActiveModelIds: readonly SelectedAI[];
  modelProvenanceEvidence: string | null;
  companyIdentityEvidence: string | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  cachePricing: EvidencePresence;
  contextLimitTokens: number | null;
  longContextTierPricing: EvidencePresence;
  publicStabilityEvidence: string | null;
  priceUnit: TokenPriceUnit;
  betaLimitation: string | null;
};

export type PublicScreenResult = {
  status: PublicScreenStatus;
  reasons: string[];
};

export type SupplierDiscoverySourceId =
  | "independent_candidate_registry"
  | "openrouter_endpoint_radar"
  | "direct_supplier_public_radar"
  | "artificial_analysis_providers"
  | "bounded_web_search";

export type SupplierDiscoverySourceInventoryEntry = {
  id: SupplierDiscoverySourceId;
  implemented: boolean;
  newSecretRequired: boolean;
  owner: string;
  role: string;
};

export type IndependentSupplierLiveQualification = {
  status: "NOT_RUN";
  reason: string;
  providerGenerationCalls: 0;
  canonicalFixtureOwner: string;
  outputQualityScored: false;
  checks: Array<{ id: string; status: "NOT_RUN" }>;
};

export type IndependentSupplierPromotionBoundary = {
  readiness: "NOT_READY";
  transitionKind: "CROSS_PROVIDER_PROCUREMENT";
  draftRoutePrEligible: false;
  automaticMergeEligible: false;
  stopReason: string;
  promotionOwner: string;
};

export type SupplierCandidateRecord = {
  supplierId: string;
  companyName: string;
  productId: string;
  productKind: SupplierProductKind;
  canonicalOrigin: string;
  advertisedApiBaseUrl: string | null;
  observedOfferFacts: readonly string[];
  credentialState: string;
  website: string;
  apiDocsUrl: string | null;
  pricingUrl: string | null;
  statusUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  retentionZdr: SupplierPublicProfile["retentionZdr"];
  openaiCompatible: OpenAiCompatibility;
  chatCompletionsAdvertised: boolean | null;
  streamingAdvertised: boolean | null;
  usageReportingAdvertised: UsageReportingAdvertised;
  discoveredAt: string;
  lastSeenAt: string;
  discoverySource: SupplierDiscoverySourceId;
  supportedActiveModelIds: readonly SelectedAI[];
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  priceUnit: TokenPriceUnit;
  priceAdvantage: "not_comparable" | "lower_token_rates" | "not_lower" | "unknown";
  evidenceFreshness: string;
  publicScreenStatus: PublicScreenStatus;
  publicScreenReasons: string[];
  status: SupplierCandidateStatus;
  publicStabilityEvidence: string | null;
  privacyZdrStatus: string;
  credentialRequirement: string;
  liveQualification: IndependentSupplierLiveQualification;
  promotion: IndependentSupplierPromotionBoundary;
};

export type SupplierDiscoveryReport = {
  version: number;
  generatedAt: string;
  providerGenerationCalls: 0;
  activeModelIdsConsidered: readonly SelectedAI[];
  candidates: SupplierCandidateRecord[];
  knownDirectSupplierIds: readonly string[];
  openRouterFeed: {
    owner: string;
    status: "ATTACHED" | "NOT_ATTACHED";
    providerNameCount: number;
    fluenceNamed: boolean | null;
    independentCandidatesAdded: 0;
    note: string;
  };
  sources: readonly SupplierDiscoverySourceInventoryEntry[];
  notes: string[];
};
