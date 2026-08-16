import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_OPUS_GROSS_MARGIN,
  OPENROUTER_OPUS_POINTS_PER_CHAR,
  computeOpenRouterTurnBilling,
  computeTurnBilling,
  explainOpenRouterOpusTurnCost,
  isOpusColdStartCacheMiss,
  opusCostCharCapBlendPoints,
  resolveOpenRouterOpusTurnCharge,
  sumOpenRouterStageOutputTokens,
} from "./points";
import { openRouterNormalizedUsdCostFromRates } from "@/lib/openRouterModelPricing";

describe("Opus billing defaults", () => {
  it("keeps rolling 45% target and legacy per-char constant", () => {
    assert.equal(OPENROUTER_OPUS_GROSS_MARGIN, 0.45);
    assert.equal(OPENROUTER_OPUS_POINTS_PER_CHAR, 0.142);
  });
});

describe("Opus billing — no first-turn flat", () => {
  const modelId = "claude-opus-5";

  it("first and later turns use the same output-tier price", () => {
    const first = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 8000,
      outputTokens: 1500,
      cacheWriteTokens: 5176,
      savedTextChars: 1800,
      completedTurnsBeforeRequest: 0,
    });
    const second = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 8000,
      outputTokens: 1500,
      cacheWriteTokens: 5176,
      savedTextChars: 1800,
      completedTurnsBeforeRequest: 1,
    });
    assert.ok(!("opusFirstTurnFlat" in first));
    assert.equal(first.total, 380);
    assert.equal(second.total, first.total);
  });
});

describe("Opus billing admin cost vs user tier", () => {
  const modelId = "claude-opus-5";

  it("normalized USD treats all prompt tokens at cache-read rate", () => {
    const inputTokens = 8000;
    const outputTokens = 1500;
    const normalized = openRouterNormalizedUsdCostFromRates({
      promptTokens: inputTokens,
      outputTokens,
      modelId: "anthropic/claude-opus-4.5",
    });
    assert.equal(normalized.virtualInputTokens, inputTokens);
    assert.equal(normalized.cacheHitRateUsdPerM, 0.5);
    assert.equal(normalized.outputRateUsdPerM, 25);
    const expectedUsd =
      (inputTokens / 1_000_000) * 0.5 + (outputTokens / 1_000_000) * 25;
    assert.equal(normalized.usdCost, expectedUsd);
  });

  it("admin raw cost still differs by cache, user total does not", () => {
    const cold = explainOpenRouterOpusTurnCost(8000, 1500, modelId, 1800, {
      cacheWriteTokens: 5176,
      cacheReadTokens: 0,
    });
    const warm = explainOpenRouterOpusTurnCost(8000, 1500, modelId, 1800, {
      cacheWriteTokens: 0,
      cacheReadTokens: 5176,
    });
    assert.equal(cold.applied, "output_tier");
    assert.equal(cold.total, 380);
    assert.equal(warm.total, 380);
    assert.ok(cold.rawCostKrw > warm.rawCostKrw);
    assert.equal(cold.costPlusMarginKrw, 0);
  });

  it("computeOpenRouterTurnBilling matches explain total", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId,
      inputTokens: 8000,
      outputTokens: 1500,
      cacheWriteTokens: 5176,
      outputChars: 1800,
      messageCount: 1,
    });
    const explain = explainOpenRouterOpusTurnCost(8000, 1500, modelId, 1800, {
      cacheWriteTokens: 5176,
    });
    assert.equal(billing.total, explain.total);
    assert.equal(billing.total, 380);
  });
});

describe("Opus cost helpers remain diagnostic-only", () => {
  it("detects cold start when cache_write exceeds threshold", () => {
    assert.equal(isOpusColdStartCacheMiss(3000), false);
    assert.equal(isOpusColdStartCacheMiss(3001), true);
  });

  it("legacy blend helper is unused by user charge", () => {
    assert.equal(opusCostCharCapBlendPoints(128.5, 100), 72);
    const resolved = resolveOpenRouterOpusTurnCharge(323, 1984, 8000);
    assert.equal(resolved.applied, "output_tier");
    assert.equal(resolved.total, 380);
    assert.equal(resolved.costBlendApplied, false);
  });
});

describe("sumOpenRouterStageOutputTokens — recovery turns", () => {
  it("sums primary and recovery once each (no double-count)", () => {
    const stages = [
      { stage: "primary", model: "anthropic/claude-opus-4.5", input: 5000, output: 1589, apiOutputTokens: 1589 },
      {
        stage: "under-length-recovery",
        model: "anthropic/claude-opus-4.5",
        input: 6000,
        output: 1445,
        apiOutputTokens: 1445,
      },
    ];
    assert.equal(sumOpenRouterStageOutputTokens(stages), 3034);
  });

  it("inflated primary apiOutputTokens would over-sum if recovery stage also present", () => {
    const buggyStages = [
      { stage: "primary", model: "anthropic/claude-opus-4.5", input: 5000, output: 1589, apiOutputTokens: 3034 },
      {
        stage: "under-length-recovery",
        model: "anthropic/claude-opus-4.5",
        input: 6000,
        output: 1445,
        apiOutputTokens: 1445,
      },
    ];
    assert.equal(sumOpenRouterStageOutputTokens(buggyStages), 4479);
  });

  it("recovery turn final charge is unchanged by inflated token count", () => {
    const modelId = "claude-opus-5";
    const inputTokens = 12000;
    const savedTextChars = 2413;
    const correct = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens,
      outputTokens: 3034,
      savedTextChars,
      completedTurnsBeforeRequest: 0,
    });
    const inflated = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens,
      outputTokens: 4479,
      savedTextChars,
      completedTurnsBeforeRequest: 0,
    });
    assert.equal(correct.total, inflated.total);
    assert.equal(correct.total, 380);
  });
});
