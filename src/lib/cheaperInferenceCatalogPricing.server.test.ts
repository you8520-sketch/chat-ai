import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatalogPricing } from "./cheaperInferenceCatalogPricing.server";
import { resolveCatalogRatesForPrompt } from "./cheaperInferenceCatalogPricing";
import {
  GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE,
  GEMINI31_TIERED_CATALOG_FIXTURE,
} from "./fixtures/cheaperInferenceGemini31TierCatalog.fixture";
import { selectCatalogPricingTier } from "./catalogPricingTier";

describe("cheaperInferenceCatalogPricing.server tier parser", () => {
  it("parses input_token_price_threshold and above_threshold from CI schema", () => {
    const parsed = parseCatalogPricing(GEMINI31_TIERED_CATALOG_FIXTURE, Date.now());
    assert.ok(parsed);
    assert.equal(parsed!.inputTokenPriceThreshold, 200_000);
    assert.equal(parsed!.referenceInputUsdPerMillion, 2);
    assert.equal(parsed!.aboveThreshold?.referenceInputUsdPerMillion, 4);
    assert.equal(parsed!.aboveThreshold?.referenceOutputUsdPerMillion, 18);
    assert.equal(parsed!.aboveThreshold?.inputUsdPerMillion, 2.8);
  });

  it("selects base tier at 200,000 prompt tokens and above tier at 200,001", () => {
    const parsed = parseCatalogPricing(GEMINI31_TIERED_CATALOG_FIXTURE, Date.now())!;
    assert.equal(
      selectCatalogPricingTier({ promptTokens: 200_000, inputTokenPriceThreshold: parsed.inputTokenPriceThreshold }),
      "base"
    );
    assert.equal(
      selectCatalogPricingTier({ promptTokens: 200_001, inputTokenPriceThreshold: parsed.inputTokenPriceThreshold }),
      "above_threshold"
    );
    const baseRates = resolveCatalogRatesForPrompt(parsed, 199_999);
    const atThreshold = resolveCatalogRatesForPrompt(parsed, 200_000);
    const aboveRates = resolveCatalogRatesForPrompt(parsed, 200_001);
    assert.equal(baseRates.tier, "base");
    assert.equal(atThreshold.tier, "base");
    assert.equal(aboveRates.tier, "above_threshold");
    assert.equal(baseRates.referenceInputUsdPerMillion, 2);
    assert.equal(aboveRates.referenceInputUsdPerMillion, 4);
  });

  it("keeps effective cache fallback arithmetic while exposing provenance", () => {
    const reported = parseCatalogPricing(
      {
        id: "reported-model",
        pricing: {
          input_per_million: 2,
          output_per_million: 10,
          cache_read_input_per_million: 0.25,
          cache_write_input_per_million: 1.5,
        },
      },
      Date.now()
    )!;
    assert.equal(reported.cacheReadUsdPerMillion, 0.25);
    assert.equal(reported.cacheWriteUsdPerMillion, 1.5);
    assert.equal(reported.cacheReadRateProvenance, "reported");
    assert.equal(reported.cacheWriteRateProvenance, "reported");

    const fallback = parseCatalogPricing(
      {
        id: "fallback-model",
        pricing: {
          input_per_million: 2,
          output_per_million: 10,
        },
      },
      Date.now()
    )!;
    assert.equal(fallback.cacheReadUsdPerMillion, 0.2);
    assert.equal(fallback.cacheWriteUsdPerMillion, 2);
    assert.equal(fallback.cacheReadRateProvenance, "input_rate_fallback");
    assert.equal(fallback.cacheWriteRateProvenance, "input_rate_fallback");
  });

  it("above-threshold without above_threshold block yields no above rates", () => {
    const parsed = parseCatalogPricing(GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE, Date.now())!;
    assert.equal(parsed.inputTokenPriceThreshold, 200_000);
    assert.equal(parsed.aboveThreshold, undefined);
  });
});


describe("CheaperInference catalog capability evidence", () => {
  it("parses documented aliases/type/endpoint/capabilities and catalog version metadata", () => {
    const parsed = parseCatalogPricing(
      {
        id: "next-rp-model",
        type: "text",
        endpoint: "/v1/chat/completions",
        provider: "ExampleAI",
        aliases: ["example/next-rp-model", " example/next-rp-model-v1 "],
        capabilities: {
          streaming: true,
          reasoning: true,
          vision: false,
        },
        pricing: {
          input_per_million: 1,
          output_per_million: 5,
        },
      },
      Date.parse("2026-09-27T00:00:00Z"),
      {
        pricingVersion: "sha256:abc",
        pricingCheckedAt: "2026-09-27T00:00:00Z",
        pricingUpdatedAt: "2026-09-26T23:59:00Z",
      }
    );
    assert.ok(parsed);
    assert.equal(parsed!.catalogType, "text");
    assert.equal(parsed!.catalogEndpoint, "/v1/chat/completions");
    assert.equal(parsed!.catalogProvider, "ExampleAI");
    assert.deepEqual(parsed!.catalogAliases, [
      "example/next-rp-model",
      "example/next-rp-model-v1",
    ]);
    assert.deepEqual(parsed!.catalogCapabilities, {
      streaming: true,
      reasoning: true,
      vision: false,
      video: undefined,
    });
    assert.equal(parsed!.catalogPricingVersion, "sha256:abc");
    assert.equal(parsed!.catalogPricingCheckedAt, "2026-09-27T00:00:00Z");
    assert.equal(parsed!.catalogPricingUpdatedAt, "2026-09-26T23:59:00Z");
  });

  it("accepts top-level capability booleans as a compatibility fallback", () => {
    const parsed = parseCatalogPricing(
      {
        id: "fallback-capability-model",
        type: "text",
        endpoint: "/v1/chat/completions",
        streaming: true,
        reasoning: false,
        pricing: {
          input_per_million: 1,
          output_per_million: 5,
        },
      },
      Date.now()
    )!;
    assert.equal(parsed.catalogCapabilities?.streaming, true);
    assert.equal(parsed.catalogCapabilities?.reasoning, false);
  });
});
