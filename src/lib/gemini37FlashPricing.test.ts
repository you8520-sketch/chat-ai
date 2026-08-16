import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeGemini37FlashInputSurchargePoints,
  computeGemini37FlashOutputSurchargePoints,
  computeGemini37FlashUserChargeBreakdown,
  computeGemini37FlashUserChargePoints,
  formatGemini37FlashAdminPricingLines,
  resolveGemini37FlashBilledOutputTokens,
} from "@/lib/gemini37FlashPricing";

describe("Gemini 3.7 Flash user price formula", () => {
  it("competitor fixture 22947 / 3897 => 60P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 22_947,
        billedOutputTokens: 3_897,
      }),
      60
    );
  });

  it("20K / 2K => 45P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 20_000,
        billedOutputTokens: 2_000,
      }),
      45
    );
  });

  it("30K / 3K => 65P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 30_000,
        billedOutputTokens: 3_000,
      }),
      65
    );
  });

  it("40K / 3K => 70P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 40_000,
        billedOutputTokens: 3_000,
      }),
      70
    );
  });

  it("50K / 3K => 75P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 50_000,
        billedOutputTokens: 3_000,
      }),
      75
    );
  });

  it("53823 / 4444 => 85P", () => {
    const breakdown = computeGemini37FlashUserChargeBreakdown({
      inputTokens: 53_823,
      billedOutputTokens: 4_444,
    });
    assert.equal(breakdown.basePoints, 45);
    assert.equal(breakdown.inputSurchargePoints, 15);
    assert.equal(breakdown.outputSurchargePoints, 25);
    assert.equal(breakdown.totalPoints, 85);
  });

  it("70K / 4K => 85P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 70_000,
        billedOutputTokens: 4_000,
      }),
      85
    );
  });

  it("100K / 6K grows continuously without a hard cap", () => {
    const breakdown = computeGemini37FlashUserChargeBreakdown({
      inputTokens: 100_000,
      billedOutputTokens: 6_000,
    });
    assert.equal(breakdown.inputSurchargePoints, 40);
    assert.equal(breakdown.outputSurchargePoints, 35);
    assert.equal(breakdown.totalPoints, 120);
  });

  it("input surcharge is a continuous 10k / 5P function", () => {
    assert.equal(computeGemini37FlashInputSurchargePoints(25_000), 0);
    assert.equal(computeGemini37FlashInputSurchargePoints(25_001), 5);
    assert.equal(computeGemini37FlashInputSurchargePoints(35_000), 5);
    assert.equal(computeGemini37FlashInputSurchargePoints(35_001), 10);
    assert.equal(computeGemini37FlashInputSurchargePoints(95_000), 35);
    assert.equal(computeGemini37FlashInputSurchargePoints(95_001), 40);
    assert.equal(computeGemini37FlashInputSurchargePoints(115_000), 45);
  });

  it("output surcharge uses billed completion tokens, not RP chars", () => {
    assert.equal(computeGemini37FlashOutputSurchargePoints(2_500), 0);
    assert.equal(computeGemini37FlashOutputSurchargePoints(2_501), 15);
    assert.equal(computeGemini37FlashOutputSurchargePoints(4_000), 15);
    assert.equal(computeGemini37FlashOutputSurchargePoints(4_001), 25);
    assert.equal(computeGemini37FlashOutputSurchargePoints(9_000), 45);
    assert.equal(computeGemini37FlashOutputSurchargePoints(9_001), 55);
    assert.equal(computeGemini37FlashOutputSurchargePoints(10_500), 55);
    assert.equal(computeGemini37FlashOutputSurchargePoints(10_501), 65);
  });

  it("uses completion_tokens when reasoning is already included", () => {
    assert.equal(
      resolveGemini37FlashBilledOutputTokens({
        completionTokens: 3_897,
        reasoningTokens: 2_172,
        contentTokens: 1_725,
      }),
      3_897
    );
  });

  it("adds separately billed reasoning without double-counting", () => {
    assert.equal(
      resolveGemini37FlashBilledOutputTokens({
        completionTokens: 1_725,
        reasoningTokens: 2_172,
        contentTokens: 1_725,
      }),
      3_897
    );
  });

  it("formats the admin receipt breakdown", () => {
    const lines = formatGemini37FlashAdminPricingLines(
      computeGemini37FlashUserChargeBreakdown({
        inputTokens: 53_823,
        billedOutputTokens: 4_444,
      })
    );
    assert.deepEqual(lines, [
      "Gemini 3.7 pricing:",
      "- base: 45P",
      "- api input: 53,823",
      "- input surcharge: 15P",
      "- billed output: 4,444",
      "- output surcharge: 25P",
      "- main charge: 85P",
    ]);
  });
});
