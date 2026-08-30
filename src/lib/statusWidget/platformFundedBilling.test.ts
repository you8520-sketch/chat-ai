import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paidCreatorRewardSpend } from "@/lib/creatorPoints";
import { sanitizeUsageForPublicReceipt } from "@/lib/billingReceiptAccess";
import {
  applyStatusWidgetPlatformFundedExtract,
  buildStatusWidgetExtractReceipt,
} from "@/lib/statusWidget/receiptUsage";
import type { Usage } from "@/lib/chatUsage";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";

const MAIN_USER_CHARGE = 60;

function mainOnlyUsage(): Usage {
  return {
    input: 10000,
    output: 1000,
    model: "deepseek/deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    provider: "openrouter",
    route: "nsfw",
    cost: MAIN_USER_CHARGE,
    baseCost: MAIN_USER_CHARGE,
    breakdown: [],
    apiInputTokens: 12000,
    apiOutputTokens: 1500,
    apiRawCostKrw: 45,
    mainApiRawCostKrw: 45,
    apiCallCount: 1,
  };
}

describe("status widget platform-funded billing policy", () => {
  it("golden AFTER: widget ON does not increase user deduction", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const widgetUsage = {
      inputTokens: 4252,
      outputTokens: 120,
      estimated: false,
      upstreamCostUsd: 0.002,
    };
    const meta = { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 1 };

    const beforeWidgetOnDeduction = MAIN_USER_CHARGE;
    const out = applyStatusWidgetPlatformFundedExtract(
      mainOnlyUsage(),
      widgetUsage,
      exchangeRate,
      MAIN_USER_CHARGE,
      meta
    );

    assert.equal(out.userCost, MAIN_USER_CHARGE);
    assert.equal(out.record.cost, MAIN_USER_CHARGE);
    assert.equal(beforeWidgetOnDeduction, MAIN_USER_CHARGE);
    assert.equal(out.userCost, beforeWidgetOnDeduction);

    const receipt = buildStatusWidgetExtractReceipt(widgetUsage, exchangeRate, meta);
    assert.ok(receipt.apiRawCostKrw > 0);
    assert.equal(out.record.statusWidgetExtract!.apiRawCostKrw, receipt.apiRawCostKrw);
    assert.ok(out.record.apiRawCostKrw! > out.record.mainApiRawCostKrw!);
  });

  it("creator reward spend excludes platform-funded widget (main-only slices)", () => {
    const paidOnly = paidCreatorRewardSpend([
      { pointType: "PAID", amount: MAIN_USER_CHARGE },
    ]);
    assert.equal(paidOnly, MAIN_USER_CHARGE);
  });

  it("public receipt strips widget provider economics", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const admin = applyStatusWidgetPlatformFundedExtract(
      mainOnlyUsage(),
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      exchangeRate,
      MAIN_USER_CHARGE,
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 1 }
    ).record;

    const pub = sanitizeUsageForPublicReceipt(admin);
    assert.equal(pub.cost, MAIN_USER_CHARGE);
    assert.equal(pub.statusWidgetExtract, undefined);
    assert.equal((pub as Usage & { widgetCostPoints?: number }).widgetCostPoints, undefined);
  });
});
