import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Usage } from "@/lib/chatUsage";
import {
  judgeOpus5TierShadow,
  measureOpusShadowVolatility,
  recommendOpusTierAction,
  summarizeOpusShadowWindow,
  usageToOpusShadowTurn,
} from "@/lib/opusShadowReplay";
import { resolveOpusUserTurnCharge } from "@/lib/opusTierPricing";

function paidOpusUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 50000,
    output: 2000,
    model: "claude-opus-5",
    route: "nsfw",
    cost: 716,
    breakdown: [],
    savedOutputChars: 3975,
    apiInputTokens: 62618,
    mainApiRawCostKrw: 392.2,
    cacheReadTokens: 0,
    cacheWriteTokens: 24000,
    statusWidgetExtract: {
      model: "google/gemini-2.5-flash",
      modelLabel: "flash",
      input: 10,
      output: 10,
      apiRawCostKrw: 2,
    },
    ...overrides,
  };
}

describe("Opus historical shadow replay", () => {
  it("applies resolveOpusUserTurnCharge without mutating old charge", () => {
    const usage = paidOpusUsage();
    const turn = usageToOpusShadowTurn(usage);
    const expected = resolveOpusUserTurnCharge({
      outputChars: 3975,
      apiInputTokens: 62618,
    });
    assert.equal(turn?.oldChargedPoints, 716);
    assert.equal(turn?.newShadowPoints, expected.finalChargePoints);
    assert.equal(turn?.coldWarm, "cold");
    assert.equal(turn?.actualApiCostKrw, 394.2);
  });

  it("rejects unknown opus-like models and incomplete receipts", () => {
    assert.equal(usageToOpusShadowTurn(paidOpusUsage({ model: "my-opus-test" })), null);
    assert.equal(usageToOpusShadowTurn(paidOpusUsage({ model: "anthropic/claude-opus-4.5" })), null);
    assert.equal(usageToOpusShadowTurn(paidOpusUsage({ model: "claude-opus" })), null);
    assert.equal(usageToOpusShadowTurn(paidOpusUsage({ savedOutputChars: undefined })), null);
    assert.equal(usageToOpusShadowTurn(paidOpusUsage({ mainApiRawCostKrw: undefined })), null);
    assert.equal(
      usageToOpusShadowTurn(paidOpusUsage({ statusWidgetExtract: undefined })),
      null
    );
  });

  it("marks windows under 20 as AVAILABLE_SAMPLE_ONLY and does not auto-change tiers", () => {
    const turns = [usageToOpusShadowTurn(paidOpusUsage())!];
    const window = summarizeOpusShadowWindow(turns);
    assert.equal(window.sampleTurns, 1);
    assert.equal(window.availableSampleOnly, true);
    assert.equal(recommendOpusTierAction(window.newRealizedGrossMarginPct, window.sampleTurns).action, "AVAILABLE_SAMPLE_ONLY");
    const keep = recommendOpusTierAction(45, 20);
    assert.equal(keep.action, "KEEP");
    assert.equal(recommendOpusTierAction(49, 20).action, "PROPOSE_DECREASE");
    assert.equal(recommendOpusTierAction(41, 20).action, "PROPOSE_INCREASE");
    assert.equal(judgeOpus5TierShadow(null, 0).verdict, "AVAILABLE_SAMPLE_ONLY");
    assert.equal(judgeOpus5TierShadow(45, 20).verdict, "PASS");
    assert.equal(judgeOpus5TierShadow(49, 20).verdict, "PASS_MARGIN_HIGH");
    assert.equal(judgeOpus5TierShadow(41, 20).verdict, "FAIL_MARGIN_LOW");
  });

  it("measures volatility and 620 hard cap", () => {
    const turns = [
      usageToOpusShadowTurn(paidOpusUsage({ cost: 426, savedOutputChars: 2300, apiInputTokens: 30000, cacheWriteTokens: 0 }))!,
      usageToOpusShadowTurn(paidOpusUsage({ cost: 716, savedOutputChars: 9000, apiInputTokens: 200000 }))!,
      usageToOpusShadowTurn(paidOpusUsage({ cost: 438, savedOutputChars: 3000, apiInputTokens: 30000, cacheWriteTokens: 0 }))!,
    ];
    const vol = measureOpusShadowVolatility(turns);
    assert.equal(vol.oldMaxSingleTurnCharge, 716);
    assert.equal(vol.newMaxSingleTurnCharge, 620);
    assert.ok((vol.hardCap620AppliedCount ?? 0) >= 1);
    assert.equal(turns[1]?.newShadowPoints, 620);
    assert.equal(turns[1]?.hardCapApplied, true);
  });
});
