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
} from "@/lib/points";
import { openRouterNormalizedUsdCostFromRates } from "@/lib/openRouterModelPricing";

describe("Opus billing defaults", () => {
  it("uses 45% gross margin and 0.142P per char cap", () => {
    assert.equal(OPENROUTER_OPUS_GROSS_MARGIN, 0.45);
    assert.equal(OPENROUTER_OPUS_POINTS_PER_CHAR, 0.142);
  });
});

describe("Opus billing — no first-turn flat", () => {
  const modelId = "anthropic/claude-opus-4.5";

  it("first turn uses min(char cap, actual-cost margin 45%)", () => {
    const first = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 8000,
      outputTokens: 1500,
      cacheWriteTokens: 5176,
      savedTextChars: 1800,
      completedTurnsBeforeRequest: 0,
    });
    assert.ok(!("opusFirstTurnFlat" in first));
    assert.equal(first.total, 234);
  });

  it("second turn matches same rules as first", () => {
    const second = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 8000,
      outputTokens: 1500,
      cacheWriteTokens: 5176,
      savedTextChars: 1800,
      completedTurnsBeforeRequest: 1,
    });
    assert.equal(second.total, 234);
  });
});

describe("Opus billing with actual-cost margin", () => {
  const modelId = "anthropic/claude-opus-4.5";

  it("normalized USD treats all prompt tokens at cache-read rate", () => {
    const inputTokens = 8000;
    const outputTokens = 1500;
    const normalized = openRouterNormalizedUsdCostFromRates({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
    });
    assert.equal(normalized.virtualInputTokens, inputTokens);
    assert.equal(normalized.cacheHitRateUsdPerM, 0.5);
    assert.equal(normalized.outputRateUsdPerM, 25);
    const expectedUsd =
      (inputTokens / 1_000_000) * 0.5 + (outputTokens / 1_000_000) * 25;
    assert.equal(normalized.usdCost, expectedUsd);
  });

  it("margin charge uses actual API cost, not normalized cache-hit cost", () => {
    const explain = explainOpenRouterOpusTurnCost(8000, 1500, modelId, 1800, {
      cacheWriteTokens: 5176,
      cacheReadTokens: 0,
    });
    assert.ok(explain.normalizedRawCostKrw != null);
    assert.ok(explain.rawCostKrw > explain.normalizedRawCostKrw!);
    const marginDivisor = 1 - OPENROUTER_OPUS_GROSS_MARGIN;
    assert.equal(
      explain.costPlusMarginKrw,
      Math.ceil(explain.rawCostKrw / marginDivisor - 1e-9)
    );
  });

  it("uses (API cost + char cap)/2 when API cost exceeds char cap", () => {
    const explain = explainOpenRouterOpusTurnCost(8000, 1500, modelId, 100, {
      cacheWriteTokens: 5176,
    });
    const blend = opusCostCharCapBlendPoints(explain.rawCostKrw, 100);
    assert.equal(explain.applied, "cost_blend");
    assert.equal(explain.total, blend);
    assert.equal(explain.coldStartCostFloorPoints, blend);
    assert.ok(explain.total > (explain.uncappedChargePoints ?? 0));
  });

  it("caps at char rate when margin exceeds char cap and API cost is below char cap", () => {
    const outputChars = 200;
    const charCap = Math.ceil(outputChars * OPENROUTER_OPUS_POINTS_PER_CHAR);
    const actualApiCost = 25;
    const resolved = resolveOpenRouterOpusTurnCharge(actualApiCost, outputChars);
    assert.equal(resolved.charCapPoints, charCap);
    assert.ok(resolved.marginChargePoints > charCap);
    assert.equal(resolved.applied, "char_floor");
    assert.equal(resolved.total, charCap);
  });

  it("1984 chars cold start uses min(char cap, margin) when API cost is below char cap", () => {
    const outputChars = 1984;
    const explain = explainOpenRouterOpusTurnCost(8000, 1500, modelId, outputChars, {
      cacheWriteTokens: 5176,
    });
    const charCap = Math.ceil(outputChars * OPENROUTER_OPUS_POINTS_PER_CHAR);
    assert.ok(explain.rawCostKrw < charCap);
    assert.equal(explain.total, Math.min(charCap, explain.costPlusMarginKrw));
    assert.equal(explain.total, 234);
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
  });
});

describe("Opus cost blend", () => {
  const modelId = "anthropic/claude-opus-4.5";

  it("detects cold start when cache_write exceeds threshold", () => {
    assert.equal(isOpusColdStartCacheMiss(3000), false);
    assert.equal(isOpusColdStartCacheMiss(3001), true);
  });

  it("long output with API cost below char cap uses margin path", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId,
      inputTokens: 8000,
      outputTokens: 1500,
      cacheWriteTokens: 5176,
      outputChars: 1800,
      messageCount: 2,
    });
    assert.equal(billing.total, 234);
    assert.ok(!billing.coldStartShieldApplied);
  });

  it("short output blends API cost with char cap", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId,
      inputTokens: 8000,
      outputTokens: 1500,
      cacheWriteTokens: 5176,
      outputChars: 100,
      messageCount: 1,
    });
    assert.ok(billing.coldStartShieldApplied);
    assert.equal(
      billing.total,
      opusCostCharCapBlendPoints(128.5, 100)
    );
  });
});

describe("Opus cost blend formula", () => {
  it("ceil (API cost points + chars×0.135P) / 2", () => {
    assert.equal(opusCostCharCapBlendPoints(128.5, 100), 72);
    assert.equal(opusCostCharCapBlendPoints(323, 1984), 296);
  });

  it("resolveOpenRouterOpusTurnCharge picks blend when actual exceeds 0.142 char cap", () => {
    const resolved = resolveOpenRouterOpusTurnCharge(323, 1984);
    const charCap = Math.ceil(1984 * OPENROUTER_OPUS_POINTS_PER_CHAR);
    assert.equal(resolved.charCapPoints, charCap);
    assert.ok(resolved.costBlendApplied);
    assert.equal(resolved.total, 296);
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

  it("recovery turn final charge unchanged by inflated token count (char cap wins)", () => {
    const modelId = "anthropic/claude-opus-4.5";
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
    assert.equal(correct.total, 343);
  });
});
