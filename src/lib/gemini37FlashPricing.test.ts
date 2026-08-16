import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeGemini37FlashInputSurchargePoints,
  computeGemini37FlashLongContextSurchargePoints,
  computeGemini37FlashOutputSurchargePoints,
  computeGemini37FlashUserChargeBreakdown,
  computeGemini37FlashUserChargePoints,
  formatGemini37FlashAdminMarginLines,
  formatGemini37FlashAdminPricingLines,
  resolveGemini37FlashBilledOutputTokens,
} from "@/lib/gemini37FlashPricing";

describe("Gemini 3.7 Flash user price formula V3", () => {
  it("competitor fixture 22947 / 3897 => 60P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 22_947,
        billedOutputTokens: 3_897,
      }),
      60
    );
  });

  it("20K / 2K => 35P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 20_000,
        billedOutputTokens: 2_000,
      }),
      35
    );
  });

  it("30K / 3K => 61P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 30_000,
        billedOutputTokens: 3_000,
      }),
      61
    );
  });

  it("40K / 3K => 62P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 40_000,
        billedOutputTokens: 3_000,
      }),
      62
    );
  });

  it("50K / 3K => 63P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 50_000,
        billedOutputTokens: 3_000,
      }),
      63
    );
  });

  it("53823 / 4444 => 68P", () => {
    const breakdown = computeGemini37FlashUserChargeBreakdown({
      inputTokens: 53_823,
      billedOutputTokens: 4_444,
    });
    assert.equal(breakdown.basePoints, 35);
    assert.equal(breakdown.inputSurchargePoints, 3);
    assert.equal(breakdown.outputSurchargePoints, 30);
    assert.equal(breakdown.totalPoints, 68);
  });

  it("70K / 4K => 65P", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 70_000,
        billedOutputTokens: 4_000,
      }),
      65
    );
  });

  it("100K / 6K keeps V2 components and adds long-context 45P", () => {
    const breakdown = computeGemini37FlashUserChargeBreakdown({
      inputTokens: 100_000,
      billedOutputTokens: 6_000,
    });
    assert.equal(breakdown.inputSurchargePoints, 8);
    assert.equal(breakdown.outputSurchargePoints, 40);
    assert.equal(breakdown.longContextSurchargePoints, 45);
    assert.equal(breakdown.totalPoints, 128);
  });

  it("V3 long-context fixtures lock 80K/90K/100K/110K at 4K output", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 80_000,
        billedOutputTokens: 4_000,
      }),
      81
    );
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 90_000,
        billedOutputTokens: 4_000,
      }),
      97
    );
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 100_000,
        billedOutputTokens: 4_000,
      }),
      113
    );
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 110_000,
        billedOutputTokens: 4_000,
      }),
      129
    );
  });

  it("long-context surcharge boundary is 75,000 exclusive", () => {
    assert.equal(computeGemini37FlashLongContextSurchargePoints(75_000), 0);
    assert.equal(computeGemini37FlashLongContextSurchargePoints(75_001), 15);
    assert.equal(computeGemini37FlashLongContextSurchargePoints(85_000), 15);
    assert.equal(computeGemini37FlashLongContextSurchargePoints(85_001), 30);
    assert.equal(computeGemini37FlashLongContextSurchargePoints(95_000), 30);
    assert.equal(computeGemini37FlashLongContextSurchargePoints(95_001), 45);
  });

  it("T21-T30 recorded inputs lock the expected V3 prices", () => {
    const rows = [
      [75_503, 4_593, 86],
      [80_133, 3_776, 81],
      [83_926, 3_400, 81],
      [87_338, 4_210, 102],
      [91_563, 4_276, 102],
      [95_850, 3_685, 113],
      [99_628, 3_572, 113],
      [103_212, 5_361, 118],
      [108_583, 3_490, 129],
      [112_091, 4_822, 134],
    ] as const;
    for (const [input, output, expected] of rows) {
      assert.equal(
        computeGemini37FlashUserChargePoints({
          inputTokens: input,
          billedOutputTokens: output,
        }),
        expected
      );
    }
  });

  it("<=75K prices stay identical to V2", () => {
    for (const [input, output, expected] of [
      [22_947, 3_897, 60],
      [30_000, 3_000, 61],
      [40_000, 3_000, 62],
      [50_000, 3_000, 63],
      [70_000, 4_000, 65],
      [75_000, 4_000, 65],
    ] as const) {
      const breakdown = computeGemini37FlashUserChargeBreakdown({
        inputTokens: input,
        billedOutputTokens: output,
      });
      assert.equal(breakdown.longContextSurchargePoints, 0);
      assert.equal(breakdown.totalPoints, expected);
    }
  });

  it("input surcharge is a continuous 10k / 1P function", () => {
    assert.equal(computeGemini37FlashInputSurchargePoints(25_000), 0);
    assert.equal(computeGemini37FlashInputSurchargePoints(25_001), 1);
    assert.equal(computeGemini37FlashInputSurchargePoints(35_000), 1);
    assert.equal(computeGemini37FlashInputSurchargePoints(35_001), 2);
    assert.equal(computeGemini37FlashInputSurchargePoints(95_000), 7);
    assert.equal(computeGemini37FlashInputSurchargePoints(95_001), 8);
    assert.equal(computeGemini37FlashInputSurchargePoints(115_000), 9);
  });

  it("output surcharge uses billed completion tokens, not RP chars", () => {
    assert.equal(computeGemini37FlashOutputSurchargePoints(2_500), 0);
    assert.equal(computeGemini37FlashOutputSurchargePoints(2_501), 25);
    assert.equal(computeGemini37FlashOutputSurchargePoints(4_000), 25);
    assert.equal(computeGemini37FlashOutputSurchargePoints(4_001), 30);
    assert.equal(computeGemini37FlashOutputSurchargePoints(5_500), 30);
    assert.equal(computeGemini37FlashOutputSurchargePoints(5_501), 40);
    assert.equal(computeGemini37FlashOutputSurchargePoints(7_000), 40);
    assert.equal(computeGemini37FlashOutputSurchargePoints(7_001), 50);
    assert.equal(computeGemini37FlashOutputSurchargePoints(9_000), 50);
    assert.equal(computeGemini37FlashOutputSurchargePoints(9_001), 60);
    assert.equal(computeGemini37FlashOutputSurchargePoints(10_500), 60);
    assert.equal(computeGemini37FlashOutputSurchargePoints(10_501), 70);
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
      "- base: 35P",
      "- api input: 53,823",
      "- input surcharge: 3P",
      "- billed output: 4,444",
      "- output surcharge: 30P",
      "- long-context surcharge: 0P",
      "- main charge: 68P",
    ]);
  });

  it("separates actual realized margin from catalog-stress margin", () => {
    const lines = formatGemini37FlashAdminMarginLines({
      userPoints: 68,
      actualApiRawCostKrw: 25.993,
      catalogApiRawCostKrw: 58.742,
    });
    assert.deepEqual(lines, [
      "- actual realized margin: 61.8%",
      "- catalog-stress margin: 13.6%",
    ]);
  });
});
