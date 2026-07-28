import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_GROSS_MARGIN,
  OPENROUTER_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION,
  OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION,
  OPENROUTER_GEMINI_36_GROSS_MARGIN,
  OPENROUTER_GEMINI_36_INPUT_USD_PER_MILLION,
  OPENROUTER_GEMINI_36_OUTPUT_USD_PER_MILLION,
  OPENROUTER_MUSE_GROSS_MARGIN,
  OPENROUTER_MUSE_INPUT_USD_PER_MILLION,
  OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION,
  computeOpenRouterTurnBilling,
  computeOpenRouterTurnCost,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "@/lib/chatModels";

function assertClose(actual: number, expected: number, epsilon = 1e-12): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${expected}, got ${actual}`
  );
}

function ceilFractional(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number.isInteger(n) ? n : Math.ceil(n - 1e-9);
}

function expectedCost(
  modelId: string,
  inputTokens: number,
  completionTokens: number,
  effectiveKrwPerUsd = 1530
): number {
  const rates = resolveOpenRouterReasoningPointRates(modelId, effectiveKrwPerUsd);
  assert.ok(rates);
  return ceilFractional(
    inputTokens * rates.inputPointsPerToken +
      completionTokens * rates.outputPointsPerToken
  );
}

const MODELS = [
  {
    id: OPENROUTER_MUSE_SPARK_11_MODEL,
    inputUsd: OPENROUTER_MUSE_INPUT_USD_PER_MILLION,
    outputUsd: OPENROUTER_MUSE_OUTPUT_USD_PER_MILLION,
    margin: OPENROUTER_MUSE_GROSS_MARGIN,
    expectedInputRate: 0.00478125,
    expectedOutputRate: 0.01625625,
  },
  {
    id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    inputUsd: OPENROUTER_DEEPSEEK_V4_PRO_INPUT_USD_PER_MILLION,
    outputUsd: OPENROUTER_DEEPSEEK_V4_PRO_OUTPUT_USD_PER_MILLION,
    margin: OPENROUTER_DEEPSEEK_V4_PRO_GROSS_MARGIN,
    expectedInputRate: 0.0019015714285714287,
    expectedOutputRate: 0.0038031428571428574,
  },
  {
    id: OPENROUTER_GEMINI_36_FLASH_MODEL,
    inputUsd: OPENROUTER_GEMINI_36_INPUT_USD_PER_MILLION,
    outputUsd: OPENROUTER_GEMINI_36_OUTPUT_USD_PER_MILLION,
    margin: OPENROUTER_GEMINI_36_GROSS_MARGIN,
    expectedInputRate: 0.00459,
    expectedOutputRate: 0.02295,
  },
] as const;

describe("reasoning models use pure token billing at target margins", () => {
  it("derives every input/output token rate from list price, exchange rate, and target margin", () => {
    for (const model of MODELS) {
      const rates = resolveOpenRouterReasoningPointRates(model.id, 1530);
      assert.ok(rates);
      assert.equal(rates.inputUsdPerMillion, model.inputUsd);
      assert.equal(rates.outputUsdPerMillion, model.outputUsd);
      assert.equal(rates.grossMargin, model.margin);
      assertClose(rates.inputPointsPerToken, model.expectedInputRate);
      assertClose(rates.outputPointsPerToken, model.expectedOutputRate);
    }
  });

  it("uses API prompt/completion totals as the authoritative billing basis", () => {
    for (const model of MODELS) {
      const billing = computeOpenRouterTurnBilling({
        modelId: model.id,
        inputTokens: 15_233,
        outputTokens: 1_159,
        reasoningTokens: 207,
        apiPromptTokens: 15_233,
        apiCompletionTokens: 2_070,
      });
      const liveRates = resolveOpenRouterReasoningPointRates(model.id);
      assert.ok(liveRates);
      const expected = ceilFractional(
        15_233 * liveRates.inputPointsPerToken +
          2_070 * liveRates.outputPointsPerToken
      );
      assert.equal(billing.baseCost, expected);
      assert.equal(billing.total, expected);
    }
  });

  it("adds actual thinking only when API completion totals are absent", () => {
    for (const model of MODELS) {
      const fallback = computeOpenRouterTurnBilling({
        modelId: model.id,
        inputTokens: 10_000,
        outputTokens: 1_800,
        reasoningTokens: 200,
      });
      const liveRates = resolveOpenRouterReasoningPointRates(model.id);
      assert.ok(liveRates);
      const expected = ceilFractional(
        10_000 * liveRates.inputPointsPerToken +
          2_000 * liveRates.outputPointsPerToken
      );
      assert.equal(fallback.total, expected);
    }
  });

  it("does not add a large-context surcharge or cache discount", () => {
    for (const model of MODELS) {
      const below = computeOpenRouterTurnCost(9_999, 500, model.id);
      const at = computeOpenRouterTurnCost(10_000, 500, model.id);
      const cached = computeOpenRouterTurnCost(10_000, 500, model.id, {
        cacheReadTokens: 8_000,
      });
      const liveRates = resolveOpenRouterReasoningPointRates(model.id);
      assert.ok(liveRates);
      assert.equal(
        below,
        ceilFractional(
          9_999 * liveRates.inputPointsPerToken +
            500 * liveRates.outputPointsPerToken
        )
      );
      assert.equal(
        at,
        ceilFractional(
          10_000 * liveRates.inputPointsPerToken +
            500 * liveRates.outputPointsPerToken
        )
      );
      assert.equal(cached, at);
    }
  });

  it("ignores fixed-turn mode for all unified reasoning models", () => {
    const previous = process.env.OPENROUTER_BILLING_MODE;
    process.env.OPENROUTER_BILLING_MODE = "fixed";
    try {
      for (const model of MODELS) {
        const total = computeOpenRouterTurnCost(10_000, 2_000, model.id);
        const liveRates = resolveOpenRouterReasoningPointRates(model.id);
        assert.ok(liveRates);
        assert.equal(
          total,
          ceilFractional(
            10_000 * liveRates.inputPointsPerToken +
              2_000 * liveRates.outputPointsPerToken
          )
        );
      }
    } finally {
      if (previous == null) delete process.env.OPENROUTER_BILLING_MODE;
      else process.env.OPENROUTER_BILLING_MODE = previous;
    }
  });

  it("matches requested point totals at ₩1,530/USD", () => {
    assert.equal(expectedCost(OPENROUTER_MUSE_SPARK_11_MODEL, 15_233, 2_070), 107);
    assert.equal(expectedCost(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 15_233, 2_070), 37);
    assert.equal(expectedCost(OPENROUTER_GEMINI_36_FLASH_MODEL, 15_233, 2_070), 118);
  });
});
