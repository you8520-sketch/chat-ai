import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import {
  computeOpenRouterTurnBilling,
  computeOpenRouterTurnCost,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";
import { openRouterUsdCostDetailed } from "@/lib/billingRawCost";
import {
  _clearLegacyExchangeRateCacheForTest,
  _setLegacyExchangeRateCacheForTest,
  getEffectiveKrwPerUsd,
} from "./exchangeRate";

const LEGACY_BASE_FX = 1530;
const LEGACY_EFFECTIVE_FX = LEGACY_BASE_FX * 1.02;

function roundCostIntermediate(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

function ceilFractional(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number.isInteger(n) ? n : Math.ceil(n - 1e-9);
}

function expectedDeepSeekCharge(inputTokens: number, outputTokens: number, effectiveFx: number): number {
  const rates = resolveOpenRouterReasoningPointRates(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, effectiveFx)!;
  assert.ok(rates);
  const rawCostKrw =
    inputTokens * (rates.inputUsdPerMillion / 1_000_000) * rates.effectiveKrwPerUsd +
    outputTokens * (rates.outputUsdPerMillion / 1_000_000) * rates.effectiveKrwPerUsd;
  return ceilFractional(rawCostKrw / (1 - rates.grossMargin));
}

describe("legacy production billing regression vs main fixtures", () => {
  beforeEach(() => {
    _clearLegacyExchangeRateCacheForTest();
    _setLegacyExchangeRateCacheForTest({
      dateKey: "2026-08-28",
      usdToKrw: LEGACY_BASE_FX,
      source: "api",
    });
    process.env.EXCHANGE_RATE_MODE = "daily_kst";
  });

  afterEach(() => {
    _clearLegacyExchangeRateCacheForTest();
  });

  it("legacy effective FX matches main formula (base × 1.02)", () => {
    assert.equal(getEffectiveKrwPerUsd(), LEGACY_EFFECTIVE_FX);
  });

  it("applyOverseasCardFee matches legacy base × 1.02", async () => {
    const { applyOverseasCardFee } = await import("./billingFxPolicy");
    assert.equal(applyOverseasCardFee(LEGACY_BASE_FX), LEGACY_EFFECTIVE_FX);
  });

  it("DeepSeek token-cost path uses legacy FX per turn", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const expected = expectedDeepSeekCharge(inputTokens, outputTokens, getEffectiveKrwPerUsd());
    const actual = computeOpenRouterTurnCost(inputTokens, outputTokens, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(actual, expected);
  });

  it("generic OpenRouter fallback path uses legacy FX for charge", () => {
    const inputTokens = 10_000;
    const outputTokens = 2_000;
    const modelId = "openai/gpt-4o-mini";
    const usd = openRouterUsdCostDetailed({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
    });
    const expected = chargePoints(roundCostIntermediate(usd * LEGACY_EFFECTIVE_FX));
    const actual = computeOpenRouterTurnCost(inputTokens, outputTokens, modelId);
    assert.equal(actual, expected);
  });

  it("Opus cheaper-inference billing path uses legacy FX margin charge", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      inputTokens: 200_000,
      outputTokens: 100_000,
      cacheReadTokens: 100_000,
      apiPromptTokens: 200_000,
      apiCompletionTokens: 100_000,
    });
    const rawUsd = (100_000 * 3.5 + 100_000 * 0.35 + 100_000 * 17.5) / 1_000_000;
    const expected = Math.ceil((rawUsd * LEGACY_EFFECTIVE_FX) / (1 - 0.45) - 1e-9);
    assert.equal(billing.total, expected);
  });
});
