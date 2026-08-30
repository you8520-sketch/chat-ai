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
const WAIVER_REASON = "degeneration" as const;

function mainOnlyUsage(overrides: Partial<Usage> = {}): Usage {
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
    ...overrides,
  };
}

const widgetUsage = {
  inputTokens: 4252,
  outputTokens: 120,
  estimated: false,
  upstreamCostUsd: 0.002,
};
const widgetMeta = { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 1 };

/** Mirrors route.ts normal-user branch after widget extract (showFullBillingReceipt=false). */
function simulateNormalUserRouteUsageAfterWidget(
  usageRecord: Usage,
  mainBillingCost: number
): { cost: number; dbUsageRecord: Usage } {
  const cost = mainBillingCost;
  const updated = {
    ...usageRecord,
    baseCost: mainBillingCost,
    cost: mainBillingCost,
  };
  const dbUsageRecord = sanitizeUsageForPublicReceipt(updated);
  return { cost, dbUsageRecord };
}

/** Mirrors route.ts admin branch after widget extract (showFullBillingReceipt=true). */
function simulateAdminRouteUsageAfterWidget(
  usageRecord: Usage,
  mainBillingCost: number,
  exchangeRate: ReturnType<typeof resolveBillingExchangeRateSnapshot>
): { cost: number; dbUsageRecord: Usage } {
  const widgetExtract = applyStatusWidgetPlatformFundedExtract(
    usageRecord,
    widgetUsage,
    exchangeRate,
    mainBillingCost,
    widgetMeta
  );
  return {
    cost: widgetExtract.userCost,
    dbUsageRecord: widgetExtract.record,
  };
}

describe("status widget platform-funded billing policy", () => {
  it("golden AFTER: widget ON does not increase user deduction (admin extract helper)", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = applyStatusWidgetPlatformFundedExtract(
      mainOnlyUsage(),
      widgetUsage,
      exchangeRate,
      MAIN_USER_CHARGE,
      widgetMeta
    );

    assert.equal(out.userCost, MAIN_USER_CHARGE);
    assert.equal(out.record.cost, MAIN_USER_CHARGE);

    const receipt = buildStatusWidgetExtractReceipt(widgetUsage, exchangeRate, widgetMeta);
    assert.ok(receipt.apiRawCostKrw > 0);
    assert.equal(out.record.statusWidgetExtract!.apiRawCostKrw, receipt.apiRawCostKrw);
    assert.ok(out.record.apiRawCostKrw! > out.record.mainApiRawCostKrw!);
  });

  it("route contract: normal-user path — main-only settlement input, no widget economics persisted", () => {
    const { cost, dbUsageRecord } = simulateNormalUserRouteUsageAfterWidget(
      mainOnlyUsage(),
      MAIN_USER_CHARGE
    );
    assert.equal(cost, MAIN_USER_CHARGE);
    assert.equal(dbUsageRecord.cost, MAIN_USER_CHARGE);
    assert.equal(dbUsageRecord.statusWidgetExtract, undefined);
    assert.equal(dbUsageRecord.mainApiRawCostKrw, undefined);
  });

  it("route contract: admin/full path — widget provider economics on persisted usage record", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const { cost, dbUsageRecord } = simulateAdminRouteUsageAfterWidget(
      mainOnlyUsage(),
      MAIN_USER_CHARGE,
      exchangeRate
    );
    assert.equal(cost, MAIN_USER_CHARGE);
    assert.ok(dbUsageRecord.statusWidgetExtract!.apiRawCostKrw > 0);
    assert.ok(dbUsageRecord.apiRawCostKrw! > dbUsageRecord.mainApiRawCostKrw!);
  });

  it("billing waiver + widget extract — waived main stays 0, widget does not create paid turn", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const waivedRecord = mainOnlyUsage({
      cost: 0,
      baseCost: 0,
      billingWaived: true,
      billingWaiverReason: WAIVER_REASON,
    });
    const out = applyStatusWidgetPlatformFundedExtract(
      waivedRecord,
      widgetUsage,
      exchangeRate,
      0,
      widgetMeta
    );
    assert.equal(out.userCost, 0);
    assert.equal(out.record.cost, 0);
    assert.equal(out.record.billingWaived, true);
    assert.equal(out.record.billingWaiverReason, WAIVER_REASON);
    assert.ok(out.record.statusWidgetExtract!.apiRawCostKrw > 0);
  });

  it("billing waiver + widget on normal-user route branch — settlement input stays 0", () => {
    const waived = mainOnlyUsage({
      cost: 0,
      baseCost: 0,
      billingWaived: true,
      billingWaiverReason: WAIVER_REASON,
    });
    const { cost, dbUsageRecord } = simulateNormalUserRouteUsageAfterWidget(waived, 0);
    assert.equal(cost, 0);
    assert.equal(dbUsageRecord.cost, 0);
    assert.equal(dbUsageRecord.billingWaived, true);
    assert.equal(dbUsageRecord.billingWaiverReason, WAIVER_REASON);
    assert.equal(dbUsageRecord.statusWidgetExtract, undefined);
  });

  it("creator reward derivation — paidCreatorRewardSpend on main-only slices (not route E2E)", () => {
    const paidOnly = paidCreatorRewardSpend([
      { pointType: "PAID", amount: MAIN_USER_CHARGE },
    ]);
    assert.equal(paidOnly, MAIN_USER_CHARGE);
    // Route passes requestedPoints=mainBillingCost to settlement; widget surcharge removed at route.
    // Full E2E creator reward with widget ON requires route integration test (out of scope here).
  });

  it("public receipt strips widget provider economics (admin-shaped input)", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const admin = applyStatusWidgetPlatformFundedExtract(
      mainOnlyUsage(),
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      exchangeRate,
      MAIN_USER_CHARGE,
      widgetMeta
    ).record;

    const pub = sanitizeUsageForPublicReceipt(admin);
    assert.equal(pub.cost, MAIN_USER_CHARGE);
    assert.equal(pub.statusWidgetExtract, undefined);
    assert.equal((pub as Usage & { widgetCostPoints?: number }).widgetCostPoints, undefined);
  });
});
