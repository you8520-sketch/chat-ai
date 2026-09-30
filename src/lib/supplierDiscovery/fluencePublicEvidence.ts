import type { SupplierPublicProfile } from "./types";

/**
 * Fluence public URLs confirmed by direct fetch on 2026-09-30.
 * Common /privacy, /terms, and /pricing paths returned 404. Those URLs are
 * left null instead of being guessed. Status host was not confirmed.
 */
export const FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT = "2026-09-30T23:41:00.000Z";

export const FLUENCE_PUBLIC_URLS = Object.freeze({
  website: "https://fluence.ai",
  apiDocs: "https://fluence.dev/docs/build/api/overview",
  pricing: "https://fluence.ai/solutions/ai-inference",
  status: null,
  privacyPolicy: null,
  terms: null,
});

export const FLUENCE_API_OVERVIEW_FIXTURE = `
The Fluence API provides programmatic access to the decentralized Fluence compute marketplace.
Fluence API endpoints require credentials: an API key in the X-API-KEY header.
GPU Cloud — browse available GPU plans, deploy and manage containers, VMs, and bare metal instances.
`;

export const FLUENCE_INFERENCE_PAGE_FIXTURE = `
Run your own model-serving stack on GPU containers, VMs, or bare metal.
H100 80 GB Price $1.24 /per hr
See GPU pricing before launch and avoid surprise egress charges.
`;

export const FLUENCE_CONSOLE_ACCESS_FIXTURE = `
Fluence Console is now open for instant access. Just sign up with GitHub, Google, or email, fund your balance, and deploy GPU compute directly from the Console.
`;

export const FLUENCE_CUSTOMER_RUNTIME_FIXTURE = `
vLLM serves the model through an OpenAI-compatible API at http://127.0.0.1:8000/v1.
vLLM officially supports the /v1/chat/completions endpoint.
`;

export type FluencePublicPageTexts = {
  apiOverviewText: string;
  inferencePageText: string;
  accessAnnouncementText: string;
  customerRuntimeText: string;
};

function hasTokenRate(text: string): boolean {
  return /per\s*1m\s*tokens|\$\s*[0-9.]+\s*\/\s*1m/i.test(text);
}

function hasGpuHourlyPrice(text: string): boolean {
  return /\$\s*[0-9.]+\s*\/?\s*per\s*hr|\/per\s*hr/i.test(text);
}

function hostedText(pages: FluencePublicPageTexts): string {
  return `${pages.apiOverviewText}\n${pages.inferencePageText}\n${pages.accessAnnouncementText}`;
}

/**
 * Fluence-specific public-page adapter. It does not parse other suppliers.
 * Customer-deployed vLLM copy is not treated as a Fluence-hosted chat API.
 */
export function parseFluencePublicPages(
  pages: FluencePublicPageTexts
): SupplierPublicProfile {
  const hosted = hostedText(pages);
  const marketplace = /compute marketplace/i.test(pages.apiOverviewText);
  const customerRuntimeOnly =
    /vllm/i.test(pages.customerRuntimeText) &&
    /openai-compatible/i.test(pages.customerRuntimeText) &&
    !/openai-compatible/i.test(hosted);
  const waitlist = /waitlist/i.test(hosted)
    ? true
    : /instant access/i.test(hosted)
      ? false
      : null;
  const gpuHourly = hasGpuHourlyPrice(pages.inferencePageText);
  const tokenRates = hasTokenRate(hosted);

  return {
    supplierId: "fluence",
    companyName: "Fluence",
    website: FLUENCE_PUBLIC_URLS.website,
    apiDocsUrl: FLUENCE_PUBLIC_URLS.apiDocs,
    pricingUrl: FLUENCE_PUBLIC_URLS.pricing,
    statusUrl: FLUENCE_PUBLIC_URLS.status,
    privacyPolicyUrl: FLUENCE_PUBLIC_URLS.privacyPolicy,
    termsUrl: FLUENCE_PUBLIC_URLS.terms,
    retentionZdr: /zero[- ]data[- ]retention|\bZDR\b/i.test(hosted) ? "advertised" : "unknown",
    openaiCompatible: customerRuntimeOnly
      ? "customer_runtime_only"
      : /openai-compatible/i.test(hosted)
        ? "yes"
        : "unknown",
    chatCompletionsAdvertised: /chat\/completions/i.test(hosted) ? true : false,
    streamingAdvertised: /streaming/i.test(hosted) ? true : false,
    usageReportingAdvertised: /usage\.prompt_tokens|token usage/i.test(hosted)
      ? "token_usage"
      : gpuHourly
        ? "other"
        : "unknown",
    waitlist,
    supportedActiveModelIds: [],
    modelProvenanceEvidence: null,
    companyIdentityEvidence: marketplace ? "fluence_api_docs_compute_marketplace" : null,
    inputUsdPerMillion: null,
    outputUsdPerMillion: null,
    cacheReadUsdPerMillion: null,
    cachePricing: "unknown",
    contextLimitTokens: null,
    longContextTierPricing: "unknown",
    publicStabilityEvidence: null,
    priceUnit: tokenRates ? "usd_per_million_tokens" : gpuHourly ? "gpu_hourly" : "unknown",
    betaLimitation: null,
  };
}

export function fluenceObservedPublicProfile(): SupplierPublicProfile {
  return parseFluencePublicPages({
    apiOverviewText: FLUENCE_API_OVERVIEW_FIXTURE,
    inferencePageText: FLUENCE_INFERENCE_PAGE_FIXTURE,
    accessAnnouncementText: FLUENCE_CONSOLE_ACCESS_FIXTURE,
    customerRuntimeText: FLUENCE_CUSTOMER_RUNTIME_FIXTURE,
  });
}
