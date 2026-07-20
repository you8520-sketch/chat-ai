import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_KIMI_POINTS_PER_OUTPUT_TOKEN,
  KIMI_WAIVER_SUCCESS_MIN_COST,
  computeOpenRouterTurnCost,
  explainOpenRouterKimiTurnCost,
  resolveKimiWaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_KIMI_K3_MODEL } from "@/lib/chatModels";

describe("Kimi K3 billing", () => {
  const modelId = OPENROUTER_KIMI_K3_MODEL;

  it("uses 0.09P per output token", () => {
    assert.equal(OPENROUTER_KIMI_POINTS_PER_OUTPUT_TOKEN, 0.09);
    assert.equal(KIMI_WAIVER_SUCCESS_MIN_COST, 65);
  });

  it("token floor = outputTokens × 0.09", () => {
    const outputTokens = 2000;
    const explain = explainOpenRouterKimiTurnCost(1000, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.09 - 1e-9));
    assert.equal(explain.costPlusMarginKrw, 0);
  });

  it("charges output token floor only", () => {
    const outputTokens = 2000;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterKimiTurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, explain.total);
  });

  it("waiver with meaningful text charges minimum 65P", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    const min = resolveKimiWaiverMinimumCharge(prose, "forced_abort");
    assert.equal(min, 65);
  });
});
