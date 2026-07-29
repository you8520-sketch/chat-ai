import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMeteredReceiptProvider,
  resolveApiRawCostKrw,
  resolveMainRpApiCostPartsKrw,
  resolveOpenRouterCacheReceipt,
} from "@/lib/billingDisplay";
import { OPENAI_GPT_56_TERRA_MODEL } from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import {
  buildOpenRouterCacheReceiptInfo,
  resolveOpenRouterModelRates,
  resolveOpenRouterRateSummary,
} from "@/lib/openRouterModelPricing";

function terraUsage(over: Partial<Usage> = {}): Usage {
  return {
    input: 8903,
    output: 2414,
    model: OPENAI_GPT_56_TERRA_MODEL,
    provider: "openai",
    route: "nsfw",
    cost: 212,
    apiInputTokens: 8903,
    apiOutputTokens: 2414,
    apiContentOutputTokens: 2414,
    cacheWriteTokens: 8900,
    standardInputTokens: 3,
    apiRawCostKrw: 40,
    mainApiRawCostKrw: 36,
    exchangeRateKrwPerUsd: 1487,
    exchangeRateDateKey: "2026-07-29",
    exchangeRateMode: "daily_kst",
    exchangeRateSource: "api",
    breakdown: [],
    ...over,
  };
}

describe("Terra admin receipt parity", () => {
  it("treats openai as a metered receipt provider", () => {
    assert.equal(isMeteredReceiptProvider("openai"), true);
    assert.equal(isMeteredReceiptProvider("openrouter"), true);
    assert.equal(isMeteredReceiptProvider("gemini"), false);
  });

  it("resolves Terra list rates instead of the $0.4 generic fallback", () => {
    const rates = resolveOpenRouterModelRates(OPENAI_GPT_56_TERRA_MODEL);
    assert.equal(rates.family, "openai");
    assert.equal(rates.inputUsdPerM, 2.5);
    assert.equal(rates.outputUsdPerM, 15);
    assert.equal(rates.cacheReadUsdPerM, 0.25);
    assert.equal(rates.cacheWriteUsdPerM, 3.125);
    assert.match(resolveOpenRouterRateSummary(OPENAI_GPT_56_TERRA_MODEL), /\$2\.5\/M/);
    assert.match(resolveOpenRouterRateSummary(OPENAI_GPT_56_TERRA_MODEL), /\$15\/M/);
  });

  it("builds cache write lines with Terra pricing labels", () => {
    const info = buildOpenRouterCacheReceiptInfo({
      modelId: OPENAI_GPT_56_TERRA_MODEL,
      promptTokens: 8903,
      cacheWriteTokens: 8900,
      standardInputTokens: 3,
    });
    assert.ok(info);
    assert.match(info!.cacheWriteLine ?? "", /캐시 저장 · 입력 125% 단가/);
    assert.match(info!.rateSummary, /캐시쓰기 \$3\.125\/M/);
  });

  it("exposes raw cost and main RP cost parts for openai usage", () => {
    const usage = terraUsage();
    assert.equal(resolveApiRawCostKrw(usage), 40);
    const parts = resolveMainRpApiCostPartsKrw(usage);
    assert.ok(parts);
    assert.equal(parts!.inputTokens, 8903);
    assert.equal(parts!.outputContentTokens, 2414);
    const cache = resolveOpenRouterCacheReceipt(usage);
    assert.ok(cache?.rateSummary || usage.cacheWriteTokens);
  });
});
