import assert from "node:assert/strict";
import test from "node:test";
import {
  openRouterUsdCostFromRates,
  resolveOpenRouterModelRates,
} from "./openRouterModelPricing";

test("Claude Opus 5 uses the Cheaper Inference catalog rates", () => {
  const rates = resolveOpenRouterModelRates("claude-opus-5");
  assert.equal(rates.inputUsdPerM, 3.5);
  assert.equal(rates.cacheReadUsdPerM, 0.35);
  assert.equal(rates.cacheWriteUsdPerM, 4.375);
  assert.equal(rates.outputUsdPerM, 17.5);

  const result = openRouterUsdCostFromRates({
    modelId: "claude-opus-5",
    promptTokens: 2_000,
    cacheReadTokens: 1_000,
    cacheWriteTokens: 500,
    outputTokens: 1_000,
  });
  assert.equal(result.standardInputTokens, 500);
  assert.equal(result.usdCost, 0.0217875);
});

test("DeepSeek V4 Flash uses the Cheaper Inference catalog rates", () => {
  const rates = resolveOpenRouterModelRates("deepseek-v4-flash");
  assert.equal(rates.inputUsdPerM, 0.098);
  assert.equal(rates.cacheReadUsdPerM, 0.0196);
  assert.equal(rates.cacheWriteUsdPerM, 0.098);
  assert.equal(rates.outputUsdPerM, 0.196);
});
