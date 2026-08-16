import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeGemini37FlashUserChargePoints } from "@/lib/gemini37FlashPricing";
import {
  aggregateGemini37FlashTelemetry,
  classifyGemini37InputBand,
  classifyUpstreamCostClass,
  resolveGemini37TelemetryVerdict,
  type Gemini37FlashTelemetryReceipt,
} from "@/lib/gemini37FlashPricingTelemetry";

const KRW = 1443.1576743;

function receipt(
  id: string,
  input: number,
  output: number,
  actualApiCostKrw: number
): Gemini37FlashTelemetryReceipt {
  return {
    id,
    apiInputTokens: input,
    billedOutputTokens: output,
    actualApiCostKrw,
    finishReason: "stop",
  };
}

describe("Gemini 3.7 Flash V3 telemetry-only", () => {
  it("does not change V3 price numbers", () => {
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 22_947,
        billedOutputTokens: 3_897,
      }),
      60
    );
    assert.equal(
      computeGemini37FlashUserChargePoints({
        inputTokens: 80_000,
        billedOutputTokens: 4_000,
      }),
      81
    );
  });

  it("classifies input bands at the 75K / 85K / 95K / 105K edges", () => {
    assert.equal(classifyGemini37InputBand(75_000), "le_75k");
    assert.equal(classifyGemini37InputBand(75_001), "75_85k");
    assert.equal(classifyGemini37InputBand(85_000), "75_85k");
    assert.equal(classifyGemini37InputBand(85_001), "85_95k");
    assert.equal(classifyGemini37InputBand(95_000), "85_95k");
    assert.equal(classifyGemini37InputBand(95_001), "95_105k");
    assert.equal(classifyGemini37InputBand(105_000), "95_105k");
    assert.equal(classifyGemini37InputBand(105_001), "gt_105k");
  });

  it("classifies cheap vs expensive upstream against catalog, not user P", () => {
    assert.equal(
      classifyUpstreamCostClass({ actualApiCostKrw: 22, catalogApiCostKrw: 75 }),
      "cheap"
    );
    assert.equal(
      classifyUpstreamCostClass({ actualApiCostKrw: 74, catalogApiCostKrw: 75 }),
      "expensive"
    );
  });

  it("aggregates bands, rolling windows, and >75K share", () => {
    const receipts = [
      receipt("s1", 20_000, 2_000, 10),
      receipt("s2", 80_000, 4_000, 22),
      receipt("s3", 90_000, 4_000, 80),
      receipt("s4", 100_000, 4_000, 24),
      receipt("s5", 110_000, 4_000, 85),
      {
        id: "waived",
        apiInputTokens: 0,
        billedOutputTokens: 0,
        actualApiCostKrw: 0,
        finishReason: null,
        streamIncomplete: true,
      },
    ];
    const report = aggregateGemini37FlashTelemetry(receipts, { krwPerUsd: KRW });
    assert.equal(report.valid.length, 5);
    const byBand = Object.fromEntries(report.bands.map((b) => [b.band, b]));
    assert.equal(byBand["<=75K"]?.validSampleCount, 1);
    assert.equal(byBand["<=75K"]?.revenueP, 35);
    assert.equal(byBand["75K-85K"]?.validSampleCount, 1);
    assert.equal(byBand["75K-85K"]?.revenueP, 81);
    assert.equal(byBand["85K-95K"]?.validSampleCount, 1);
    assert.equal(byBand["85K-95K"]?.revenueP, 97);
    assert.equal(byBand["95K-105K"]?.validSampleCount, 1);
    assert.equal(byBand["95K-105K"]?.revenueP, 113);
    assert.equal(byBand[">105K"]?.validSampleCount, 1);
    assert.equal(byBand[">105K"]?.revenueP, 129);
    assert.equal(byBand["75K-85K"]?.cheapUpstreamCount, 1);
    assert.equal(byBand["85K-95K"]?.expensiveUpstreamCount, 1);
    assert.equal(report.longContext.turnCount, 4);
    assert.equal(report.longContext.turnSharePct, 80);
    assert.equal(report.longContext.revenueP, 81 + 97 + 113 + 129);
    assert.equal(report.overall.revenueP, 35 + 81 + 97 + 113 + 129);
    assert.equal(report.rolling.find((r) => r.window === "last20")?.validSampleCount, 5);
    assert.equal(report.verdict, "INSUFFICIENT_SAMPLES");
  });

  it("uses aggregate rolling margin as the owner verdict", () => {
    assert.equal(
      resolveGemini37TelemetryVerdict({
        overallMarginPct: 56.2,
        sampleCount: 29,
        longContextMarginPct: 49.8,
        longContextTurnSharePct: 34.5,
      }),
      "V3_PRODUCTION_CANDIDATE"
    );
    assert.equal(
      resolveGemini37TelemetryVerdict({
        overallMarginPct: 49.8,
        sampleCount: 29,
        longContextMarginPct: 40,
        longContextTurnSharePct: 40,
      }),
      "LONG_CONTEXT_REVIEW"
    );
    assert.equal(
      resolveGemini37TelemetryVerdict({
        overallMarginPct: 64,
        sampleCount: 29,
        longContextMarginPct: 70,
        longContextTurnSharePct: 20,
      }),
      "PRICE_HIGH_REVIEW"
    );
    assert.equal(
      resolveGemini37TelemetryVerdict({
        overallMarginPct: 56.2,
        sampleCount: 0,
        longContextMarginPct: null,
        longContextTurnSharePct: null,
      }),
      "INSUFFICIENT_SAMPLES"
    );
  });
});
