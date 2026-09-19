import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPublicBillingReceipt } from "@/lib/publicBillingReceipt";
import type { Usage } from "@/lib/chatUsage";

describe("public billing receipt", () => {
  it("shows only allowed summary fields", () => {
    const usage: Usage = {
      input: 100,
      output: 200,
      model: "gemini-test",
      modelLabel: "Gemini Test",
      route: "safe",
      cost: 85,
      provider: "cheaperinference",
      savedOutputChars: 2400,
      apiInputTokens: 1200,
      apiOutputTokens: 900,
      apiContentOutputTokens: 700,
      apiReasoningOutputTokens: 200,
      sitePromotion: {
        baseUserChargePoints: 120,
        siteDiscountPercent: 30,
        siteDiscountPoints: 35,
        finalChargePoints: 85,
        campaignId: 1,
        officialPromotionId: 1,
        episodeKey: "ep",
        provider: "google",
        source: "admin",
        provenance: "verified",
        appliedAt: "2026-09-01T00:00:00.000Z",
      },
      breakdown: [],
    };
    const receipt = buildPublicBillingReceipt(usage);
    assert.ok(receipt);
    assert.equal(receipt.modelLabel, "Gemini Test");
    assert.equal(receipt.responseCharCount, 2400);
    assert.equal(receipt.inputTokens, 1200);
    assert.equal(receipt.outputTokens, 700);
    assert.equal(receipt.reasoningTokens, 200);
    assert.equal(receipt.siteDiscountPercent, 30);
    assert.equal(receipt.finalChargePoints, 85);
  });

  it("omits discount row when site promotion not applied", () => {
    const usage: Usage = {
      input: 50,
      output: 50,
      model: "m",
      modelLabel: "M",
      route: "safe",
      cost: 20,
      savedOutputChars: 500,
      breakdown: [],
    };
    const receipt = buildPublicBillingReceipt(usage);
    assert.ok(receipt);
    assert.equal(receipt.siteDiscountPercent, null);
    assert.equal(receipt.siteDiscountPoints, null);
  });
});
