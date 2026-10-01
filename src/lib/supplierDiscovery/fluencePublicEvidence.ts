import {
  parseGpuComputeMarketplaceOffer,
  parseHostedTokenInferenceOffer,
  selectProductProfile,
} from "./productIdentity";
import type { SupplierPublicProfile } from "./types";

/**
 * Public Fluence pages re-read on 2026-10-01.
 * Company Fluence has two product surfaces. The Main RP candidate is only the
 * hosted inference marketplace. GPU compute pages stay a separate product.
 * Advertised API copy is not a credentialled qualification.
 */
export const FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT = "2026-10-01T00:05:00.000Z";

export const FLUENCE_HOSTED_INFERENCE_PRODUCT_ID = "fluence-hosted-inference";
export const FLUENCE_GPU_COMPUTE_PRODUCT_ID = "fluence-gpu-compute";

export const FLUENCE_HOSTED_INFERENCE_ORIGIN = "https://inference.fluence.cloud";
export const FLUENCE_HOSTED_INFERENCE_ADVERTISED_API_BASE = "https://api.fluence.cloud/v1";

export const FLUENCE_GPU_COMPUTE_URLS = Object.freeze({
  website: "https://fluence.ai",
  apiDocs: "https://fluence.dev/docs/build/api/overview",
  pricing: "https://fluence.ai/solutions/ai-inference",
});

export const FLUENCE_GPU_API_OVERVIEW_FIXTURE = `
The Fluence API provides programmatic access to the decentralized Fluence compute marketplace.
Fluence API endpoints require credentials: an API key in the X-API-KEY header.
GPU Cloud — browse available GPU plans, deploy and manage containers, VMs, and bare metal instances.
`;

export const FLUENCE_GPU_INFERENCE_PAGE_FIXTURE = `
Run your own model-serving stack on GPU containers, VMs, or bare metal.
H100 80 GB Price $1.24 /per hr
See GPU pricing before launch and avoid surprise egress charges.
`;

export const FLUENCE_GPU_CONSOLE_ACCESS_FIXTURE = `
Fluence Console is now open for instant access. Just sign up with GitHub, Google, or email, fund your balance, and deploy GPU compute directly from the Console.
`;

export const FLUENCE_GPU_CUSTOMER_RUNTIME_FIXTURE = `
vLLM serves the model through an OpenAI-compatible API at http://127.0.0.1:8000/v1.
vLLM officially supports the /v1/chat/completions endpoint.
`;

export const FLUENCE_HOSTED_INFERENCE_FIXTURE = `
Fluence Inference. AI inference. Up to 89% below OpenRouter.
Each price is a provider's posted offer for the same model, checked against OpenRouter's public rate.
in$0.363 out$1.81
ZDR. Zero data retention. Send zdr: true on a request to require it.
Some models charge a long-context rate.
Pay per token. Each request shows what it cost.
Set the base URL to https://api.fluence.cloud/v1 in any OpenAI-compatible SDK.
curl https://api.fluence.cloud/v1/chat/completions
Requests and responses follow the OpenAI format.
When do I get access? We send invites in waves, in signup order, and you get one email when yours is ready.
`;

const HOSTED_OFFER_FACTS = [
  "hosted_model_offer_ui",
  "token_input_output_price_display",
  "openrouter_public_rate_comparison",
  "zdr_toggle_and_zdr_true_advertised_on_public_page",
  "invite_waitlist_signup_order",
  "founding_seat_reservation_is_not_api_credential",
  "advertised_api_base_not_qualified",
  "chat_completions_path_advertised_not_qualified",
  "exact_active_hav_model_wire_ids_not_recorded",
  "exact_usage_schema_unknown",
  "exact_billed_cost_schema_unknown",
  "exact_provider_pin_syntax_unknown",
  "exact_streaming_wire_unknown",
  "retention_implementation_not_qualified",
] as const;

export function fluenceGpuComputeProfile(): SupplierPublicProfile {
  return parseGpuComputeMarketplaceOffer({
    supplierId: "fluence",
    companyName: "Fluence",
    productId: FLUENCE_GPU_COMPUTE_PRODUCT_ID,
    canonicalOrigin: FLUENCE_GPU_COMPUTE_URLS.website,
    website: FLUENCE_GPU_COMPUTE_URLS.website,
    apiDocsUrl: FLUENCE_GPU_COMPUTE_URLS.apiDocs,
    pricingUrl: FLUENCE_GPU_COMPUTE_URLS.pricing,
    pageText: [
      FLUENCE_GPU_API_OVERVIEW_FIXTURE,
      FLUENCE_GPU_INFERENCE_PAGE_FIXTURE,
      FLUENCE_GPU_CONSOLE_ACCESS_FIXTURE,
    ].join("\n"),
    customerRuntimeText: FLUENCE_GPU_CUSTOMER_RUNTIME_FIXTURE,
    companyIdentityEvidence: "fluence_gpu_compute_marketplace",
  });
}

export function fluenceHostedInferenceProfile(
  pageText: string = FLUENCE_HOSTED_INFERENCE_FIXTURE
): SupplierPublicProfile {
  const advertisesApiBase = pageText.includes(FLUENCE_HOSTED_INFERENCE_ADVERTISED_API_BASE);
  return parseHostedTokenInferenceOffer({
    supplierId: "fluence",
    companyName: "Fluence",
    productId: FLUENCE_HOSTED_INFERENCE_PRODUCT_ID,
    canonicalOrigin: FLUENCE_HOSTED_INFERENCE_ORIGIN,
    pageText,
    companyIdentityEvidence: "fluence_hosted_inference_marketplace",
    advertisedApiBaseUrl: advertisesApiBase ? FLUENCE_HOSTED_INFERENCE_ADVERTISED_API_BASE : null,
    observedOfferFacts: HOSTED_OFFER_FACTS,
    credentialState: "founding_seat_reserved_without_api_credential",
  });
}

export function fluenceCompanyProducts(): readonly SupplierPublicProfile[] {
  return [fluenceGpuComputeProfile(), fluenceHostedInferenceProfile()];
}

/** Main RP discovery candidate: hosted inference only. */
export function fluenceObservedPublicProfile(): SupplierPublicProfile {
  return selectProductProfile(fluenceCompanyProducts(), FLUENCE_HOSTED_INFERENCE_PRODUCT_ID);
}
