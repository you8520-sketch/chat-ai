/**
 * Fixture shaped like CheaperInference GET /v1/models tiered response.
 * @see https://cheaperinference.com/docs — input_token_price_threshold / pricing.above_threshold
 */
export const GEMINI31_TIERED_CATALOG_FIXTURE = {
  id: "gemini-3.1-pro-preview",
  object: "model",
  pricing: {
    currency: "USD",
    input_per_million: "1.400000",
    output_per_million: "8.400000",
    reference_input_per_million: "2.000000",
    reference_output_per_million: "12.000000",
    discount_percent: "30.00",
    input_token_price_threshold: "200000",
    above_threshold: {
      input_per_million: "2.800000",
      output_per_million: "12.600000",
      reference_input_per_million: "4.000000",
      reference_output_per_million: "18.000000",
    },
  },
} as const;

export const GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE = {
  id: "gemini-3.1-pro-preview",
  pricing: {
    input_per_million: "1.400000",
    output_per_million: "8.400000",
    reference_input_per_million: "2.000000",
    reference_output_per_million: "12.000000",
    input_token_price_threshold: "200000",
  },
} as const;
