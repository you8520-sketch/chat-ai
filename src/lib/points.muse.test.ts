import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MUSE_WAIVER_SUCCESS_MIN_COST,
  OPENROUTER_MUSE_GROSS_MARGIN,
  OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,
  OPENROUTER_MUSE_INPUT_USD_PER_MILLION,
  OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,
  OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION,
  OPENROUTER_SIMPLE_POINT_INPUT_PRICES,
  OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  computeOpenRouterTurnCost,
  explainOpenRouterMuseTurnCost,
  resolveMuseWaiverMinimumCharge,
  resolveOpenRouterMusePointRates,
} from "@/lib/points";
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "@/lib/chatModels";

function ceilFractional(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number.isInteger(n) ? n : Math.ceil(n - 1e-9);
}

function expectedMusePointCost(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  effectiveKrwPerUsd?: number
): number {
  const rates = resolveOpenRouterMusePointRates(effectiveKrwPerUsd);
  return ceilFractional(
    inputTokens * rates.inputPointsPerToken +
      (outputTokens + reasoningTokens) * rates.outputPointsPerToken
  );
}

describe("Muse Spark 1.1 exact 60% token-margin billing", () => {
  const modelId = OPENROUTER_MUSE_SPARK_11_MODEL;

  it("derives input and output rates from list USD prices, exchange rate, and 60% margin", () => {
    const rates = resolveOpenRouterMusePointRates(1530);
    assert.equal(OPENROUTER_MUSE_INPUT_USD_PER_MILLION, 1.25);
    assert.equal(OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION, 4.25);
    assert.equal(OPENROUTER_MUSE_GROSS_MARGIN, 0.6);
    assert.equal(rates.inputPointsPerToken, 0.00478125);
    assert.equal(rates.outputPointsPerToken, 0.01625625);
  });

  it("keeps the exported rate tables on the same current-process snapshot", () => {
    assert.equal(
      OPENROUTER_SIMPLE_POINT_INPUT_PRICES[modelId],
      OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN
    );
    assert.equal(
      OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES[modelId],
      OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN
    );
    assert.equal(MUSE_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("charges only input tokens and output-plus-thinking tokens", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const reasoningTokens = 500;
    const expected = expectedMusePointCost(
      inputTokens,
      outputTokens,
      reasoningTokens
    );
    const explain = explainOpenRouterMuseTurnCost(
      inputTokens,
      outputTokens,
      modelId,
      undefined,
      undefined,
      reasoningTokens
    );

    assert.ok(explain.rawCostKrw > 0);
    assert.equal(explain.charFloorKrw, 0);
    assert.ok(explain.costPlusMarginKrw > explain.rawCostKrw);
    assert.equal(explain.applied, "cost_plus_margin");
    assert.equal(explain.total, expected);
    assert.equal(
      computeOpenRouterTurnCost(inputTokens, outputTokens, modelId, undefined, {
        reasoningTokens,
      }),
      expected
    );
  });

  it("does not add a 10k large-context surcharge", () => {
    const belowThreshold = computeOpenRouterTurnCost(9_999, 0, modelId);
    const atThreshold = computeOpenRouterTurnCost(10_000, 0, modelId);

    assert.equal(belowThreshold, expectedMusePointCost(9_999, 0, 0));
    assert.equal(atThreshold, expectedMusePointCost(10_000, 0, 0));
    assert.ok(atThreshold - belowThreshold <= 1);
  });

  it("keeps the 2,070-token billing basis and yields 107P at ₩1,530/USD", () => {
    const inputTokens = 15_233;
    const billedOutputTokensExcludingThinking = 1_863;
    const thinkingTokens = 207;
    assert.equal(billedOutputTokensExcludingThinking + thinkingTokens, 2_070);

    const fallbackRateTotal = expectedMusePointCost(
      inputTokens,
      billedOutputTokensExcludingThinking,
      thinkingTokens,
      1530
    );
    assert.equal(fallbackRateTotal, 107);

    const currentRateTotal = computeOpenRouterTurnCost(
      inputTokens,
      billedOutputTokensExcludingThinking,
      modelId,
      undefined,
      { reasoningTokens: thinkingTokens }
    );
    assert.equal(
      currentRateTotal,
      expectedMusePointCost(
        inputTokens,
        billedOutputTokensExcludingThinking,
        thinkingTokens
      )
    );
  });

  it("does not discount cache hits", () => {
    const inputTokens = 50_000;
    const outputTokens = 2000;
    const noCache = computeOpenRouterTurnCost(inputTokens, outputTokens, modelId);
    const cacheHit = computeOpenRouterTurnCost(inputTokens, outputTokens, modelId, {
      cacheReadTokens: 18_000,
    });
    assert.equal(cacheHit, noCache);
  });

  it("uses actual thinking tokens at the output-token rate", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const reasoningTokens = 500;
    const withoutThinking = computeOpenRouterTurnCost(
      inputTokens,
      outputTokens,
      modelId
    );
    const withThinking = computeOpenRouterTurnCost(
      inputTokens,
      outputTokens,
      modelId,
      undefined,
      { reasoningTokens }
    );

    assert.equal(
      withThinking,
      expectedMusePointCost(inputTokens, outputTokens, reasoningTokens)
    );
    assert.ok(withThinking > withoutThinking);
  });

  it("does not fall back to a fixed turn price for Muse", () => {
    const previous = process.env.OPENROUTER_BILLING_MODE;
    process.env.OPENROUTER_BILLING_MODE = "fixed";
    try {
      assert.equal(
        computeOpenRouterTurnCost(15_233, 1_863, modelId, undefined, {
          reasoningTokens: 207,
        }),
        expectedMusePointCost(15_233, 1_863, 207)
      );
    } finally {
      if (previous == null) delete process.env.OPENROUTER_BILLING_MODE;
      else process.env.OPENROUTER_BILLING_MODE = previous;
    }
  });

  it("waiver with meaningful text charges minimum 50P", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    const min = resolveMuseWaiverMinimumCharge(prose, "forced_abort");
    assert.equal(min, 50);
  });
});
