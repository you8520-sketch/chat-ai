import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBillingReceiptText,
  resolveMainRpApiCostPartsKrw,
  type BillingReceipt,
} from "@/lib/billingDisplay";
import type { Usage } from "@/lib/chatUsage";

function baseUsage(over: Partial<Usage> = {}): Usage {
  return {
    input: 10000,
    output: 500,
    model: "meta/muse-spark-1.1",
    provider: "openrouter",
    route: "nsfw",
    cost: 48,
    apiInputTokens: 10000,
    apiOutputTokens: 800,
    apiContentOutputTokens: 500,
    apiReasoningOutputTokens: 300,
    apiRawCostKrw: 26.1,
    mainApiRawCostKrw: 23.1,
    exchangeRateKrwPerUsd: 1492,
    exchangeRateDateKey: "2026-07-26",
    exchangeRateMode: "daily_kst",
    exchangeRateSource: "api",
    breakdown: [],
    ...over,
  };
}

describe("resolveMainRpApiCostPartsKrw", () => {
  it("splits main RP cost into input / output / thinking", () => {
    const parts = resolveMainRpApiCostPartsKrw(baseUsage());
    assert.ok(parts);
    assert.ok(parts!.inputKrw > 0);
    assert.ok(parts!.outputKrw > 0);
    assert.ok(parts!.thinkingKrw > 0);
    assert.equal(parts!.inputTokens, 10000);
    assert.equal(parts!.outputContentTokens, 500);
    assert.equal(parts!.thinkingTokens, 300);
    const sum = parts!.inputKrw + parts!.outputKrw + parts!.thinkingKrw;
    assert.ok(Math.abs(sum - 23.1) < 0.15);
  });

  it("shows 0 thinking cost when no reasoning tokens", () => {
    const parts = resolveMainRpApiCostPartsKrw(
      baseUsage({
        apiReasoningOutputTokens: 0,
        apiContentOutputTokens: 800,
        apiOutputTokens: 800,
        mainApiRawCostKrw: 20,
        apiRawCostKrw: 20,
      })
    );
    assert.ok(parts);
    assert.equal(parts!.thinkingTokens, 0);
    assert.equal(parts!.thinkingKrw, 0);
  });
});

describe("formatBillingReceiptText main cost parts", () => {
  it("includes split cost lines for admin copy", () => {
    const receipt: BillingReceipt = {
      modelLabel: "Muse Spark 1.1",
      inputTokens: 10000,
      outputTokens: 500,
      baseCost: 48,
      surchargeAmount: 0,
      totalCost: 48,
      hasSurcharge: false,
    };
    const parts = resolveMainRpApiCostPartsKrw(baseUsage())!;
    const text = formatBillingReceiptText(receipt, {
      apiRawCostKrw: 26.1,
      mainApiRawCostKrw: 23.1,
      mainRpCostParts: parts,
    });
    assert.match(text, /입력 토큰 원가/);
    assert.match(text, /출력 토큰 원가/);
    assert.match(text, /thinking 토큰 원가/);
  });
});
