import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminReceiptTurnSummary,
  formatAdminReceiptTurnSummaryLines,
  resolveAdminReceiptSettledPoints,
} from "@/lib/adminBillingReceiptTurnSummary";
import { buildAdminBillingReceiptV2 } from "@/lib/adminBillingReceiptV2";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";
import { formatAdminBillingReceiptV3Text } from "@/lib/adminBillingReceiptV3Shared";
import type { Usage } from "@/lib/chatUsage";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";

const FX = {
  dateKey: "2026-08-30",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
};

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 9000,
    output: 2500,
    model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    modelLabel: "Gemini 3.7 Flash",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 28,
    baseCost: 28,
    breakdown: [],
    ...overrides,
  };
}

function buildReceiptFromUsage(u: Usage) {
  return buildAdminBillingReceiptV3({
    usage: u,
    assistantMessageId: 1,
    chatId: 1,
    suggestedRepliesRecord: null,
    statusMetaRecord: null,
    ledgerRows: [],
  });
}

describe("adminBillingReceiptTurnSummary", () => {
  it("billingContract=null still exposes deducted + Main RP tokens", () => {
    const u = usage({ cost: 42, billingContractDispatch: undefined });
    const receipt = buildReceiptFromUsage(u);
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.equal(summary.deductedPoints, 42);
    assert.equal(summary.inputTokens, 9000);
    assert.equal(summary.outputTokens, 2500);
    assert.equal(receipt.syncReceipt.userCharge.billingContract, undefined);
  });

  it("missing shadowPricing keeps summary visible with margin unavailable", () => {
    const u = usage({ cost: 55, shadowPricing: undefined });
    const receipt = buildReceiptFromUsage(u);
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.equal(summary.deductedPoints, 55);
    assert.equal(summary.inputTokens, 9000);
    assert.equal(summary.outputTokens, 2500);
    assert.equal(summary.marginPercent, null);
    assert.match(summary.marginUnavailableReason ?? "", /unavailable/i);
    assert.equal(receipt.wholeTurn.contributionMarginPercent, null);
  });

  it("settledDeductedPoints preferred over deductedPoints", () => {
    const u = usage({
      cost: 99,
      billingContractDispatch: {
        billingContract: "published_phase1",
        billingContractReason: "phase1_live_grade",
        settledDeductedPoints: 28,
        publishedFinalPoints: 28,
        pricingVersion: 1,
      },
    });
    const receipt = buildReceiptFromUsage(u);
    assert.equal(resolveAdminReceiptSettledPoints(receipt), 28);
  });

  it("clipboard includes turn summary parity with UI fields", () => {
    const u = usage({ cost: 33, shadowPricing: undefined });
    const receipt = buildReceiptFromUsage(u);
    const text = formatAdminBillingReceiptV3Text(receipt);
    assert.match(text, /\[Turn Summary\]/);
    assert.match(text, /deducted: 33 P/);
    assert.match(text, /input tokens \(Main RP\): 9,000/);
    assert.match(text, /output tokens \(Main RP\): 2,500/);
    assert.match(text, /margin: unavailable/);
  });

  it("does not fabricate margin from partial provider subset", () => {
    const u = usage({
      cost: 80,
      shadowPricing: {
        pricingVersion: 1,
        billingReferenceInputUsdPerMillion: 1,
        billingReferenceOutputUsdPerMillion: 2,
        billingReferenceCostKrw: 10,
        billingReferenceCostUsd: 0.01,
        fxSnapshot: FX,
        providerListCostStatus: "complete",
        reserveStatus: "complete",
        actualTurnCostCoverage: "partial",
        actualProviderCostKrw: 0,
        actualCostUsd: 0.002334,
        actualCostSource: "cheaper_inference_billed",
        providerListCostKrw: 35,
        inputCostKrw: 5,
        outputCostKrw: 5,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.5,
        minimumMarginFloor: 0.3,
        standardUserChargeKrw: 80,
        promoPercent: 0,
        finalShadowChargeKrw: 80,
        finalShadowPoints: 80,
        providerSavingsKrw: null,
        providerOverrunKrw: null,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: null,
        actualGrossProfitKrw: 50,
        actualRealizedMargin: 0.625,
        worstCasePromoMargin: null,
        marginFloorViolated: null,
        modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        provider: "cheaperinference",
      },
    });
    const v2 = buildAdminBillingReceiptV2(u);
    assert.equal(v2.mainRp.marginPercent, null);
    const summary = buildAdminReceiptTurnSummary(buildReceiptFromUsage(u));
    assert.equal(summary.marginPercent, null);
  });

  for (const [label, modelId] of [
    ["G31", CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL],
    ["G37", CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL],
    ["Opus5", CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL],
    ["DeepSeek", CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
  ] as const) {
    it(`${label} boundary — basic summary always present`, () => {
      const u = usage({ model: modelId, cost: 12 });
      const summary = buildAdminReceiptTurnSummary(buildReceiptFromUsage(u));
      assert.ok(summary.deductedPoints > 0);
      assert.ok(summary.inputTokens > 0);
      assert.ok(summary.outputTokens > 0);
      const ko = formatAdminReceiptTurnSummaryLines(summary).join("\n");
      assert.match(ko, /\[턴 요약\]/);
    });
  }
});
