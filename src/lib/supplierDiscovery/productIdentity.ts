import type { SupplierProductKind, SupplierPublicProfile } from "./types";

export function selectProductProfile(
  profiles: readonly SupplierPublicProfile[],
  productId: string
): SupplierPublicProfile {
  const matches = profiles.filter((profile) => profile.productId === productId);
  if (matches.length !== 1) {
    throw new Error(`product profile ${productId} must be unique, found ${matches.length}`);
  }
  const selected = matches[0];
  if (!selected) {
    throw new Error(`product profile ${productId} missing`);
  }
  return selected;
}

function blankProfile(input: {
  supplierId: string;
  companyName: string;
  productId: string;
  productKind: SupplierProductKind;
  canonicalOrigin: string;
  website: string;
  companyIdentityEvidence: string | null;
  observedOfferFacts: readonly string[];
  credentialState: string;
}): SupplierPublicProfile {
  return {
    supplierId: input.supplierId,
    companyName: input.companyName,
    productId: input.productId,
    productKind: input.productKind,
    canonicalOrigin: input.canonicalOrigin,
    advertisedApiBaseUrl: null,
    observedOfferFacts: input.observedOfferFacts,
    credentialState: input.credentialState,
    website: input.website,
    apiDocsUrl: null,
    pricingUrl: input.canonicalOrigin,
    statusUrl: null,
    privacyPolicyUrl: null,
    termsUrl: null,
    retentionZdr: "unknown",
    openaiCompatible: "unknown",
    chatCompletionsAdvertised: null,
    streamingAdvertised: null,
    usageReportingAdvertised: "unknown",
    waitlist: null,
    supportedActiveModelIds: [],
    modelProvenanceEvidence: null,
    companyIdentityEvidence: input.companyIdentityEvidence,
    inputUsdPerMillion: null,
    outputUsdPerMillion: null,
    cacheReadUsdPerMillion: null,
    cachePricing: "unknown",
    contextLimitTokens: null,
    longContextTierPricing: "unknown",
    publicStabilityEvidence: null,
    priceUnit: "unknown",
    betaLimitation: null,
  };
}

/**
 * Hosted token-inference offers. GPU hourly prices and "instant access" copy
 * from a sibling compute product cannot set priceUnit or clear waitlist.
 */
export function parseHostedTokenInferenceOffer(input: {
  supplierId: string;
  companyName: string;
  productId: string;
  canonicalOrigin: string;
  pageText: string;
  companyIdentityEvidence: string | null;
  advertisedApiBaseUrl: string | null;
  observedOfferFacts: readonly string[];
  credentialState: string;
}): SupplierPublicProfile {
  const text = input.pageText;
  const tokenPriceDisplay = /per token|openrouter|in\$[0-9.]|out\$[0-9.]/i.test(text);
  const waitlist = /waitlist|invites in waves|signup order/i.test(text) ? true : null;
  const profile = blankProfile({
    supplierId: input.supplierId,
    companyName: input.companyName,
    productId: input.productId,
    productKind: "hosted_token_inference",
    canonicalOrigin: input.canonicalOrigin,
    website: input.canonicalOrigin,
    companyIdentityEvidence: input.companyIdentityEvidence,
    observedOfferFacts: input.observedOfferFacts,
    credentialState: input.credentialState,
  });
  return {
    ...profile,
    advertisedApiBaseUrl: input.advertisedApiBaseUrl,
    pricingUrl: input.canonicalOrigin,
    retentionZdr: /zero data retention|\bzdr\b/i.test(text) ? "advertised" : "unknown",
    openaiCompatible: /openai-compatible|openai format|new openai\(/i.test(text) ? "yes" : "unknown",
    chatCompletionsAdvertised: /chat\/completions/i.test(text) ? true : null,
    waitlist,
    longContextTierPricing: /long-context rate/i.test(text) ? "published" : "unknown",
    priceUnit: tokenPriceDisplay ? "usd_per_million_tokens" : "unknown",
    betaLimitation: waitlist ? "invite_wave" : null,
  };
}

/**
 * GPU compute marketplace offers. This parser does not read hosted token tables.
 */
export function parseGpuComputeMarketplaceOffer(input: {
  supplierId: string;
  companyName: string;
  productId: string;
  canonicalOrigin: string;
  website: string;
  apiDocsUrl: string | null;
  pricingUrl: string | null;
  pageText: string;
  customerRuntimeText: string;
  companyIdentityEvidence: string | null;
}): SupplierPublicProfile {
  const text = input.pageText;
  const gpuHourly = /\$\s*[0-9.]+\s*\/?\s*per\s*hr|\/per\s*hr/i.test(text);
  const waitlist = /waitlist/i.test(text)
    ? true
    : /instant access/i.test(text)
      ? false
      : null;
  const customerRuntimeOnly =
    /vllm/i.test(input.customerRuntimeText) &&
    /openai-compatible/i.test(input.customerRuntimeText) &&
    !/openai-compatible/i.test(text);
  const profile = blankProfile({
    supplierId: input.supplierId,
    companyName: input.companyName,
    productId: input.productId,
    productKind: "gpu_compute_marketplace",
    canonicalOrigin: input.canonicalOrigin,
    website: input.website,
    companyIdentityEvidence: input.companyIdentityEvidence,
    observedOfferFacts: ["gpu_compute_marketplace"],
    credentialState: "not_the_hosted_inference_candidate",
  });
  return {
    ...profile,
    apiDocsUrl: input.apiDocsUrl,
    pricingUrl: input.pricingUrl,
    openaiCompatible: customerRuntimeOnly ? "customer_runtime_only" : "unknown",
    chatCompletionsAdvertised: /chat\/completions/i.test(text) ? true : false,
    waitlist,
    priceUnit: gpuHourly ? "gpu_hourly" : "unknown",
  };
}
