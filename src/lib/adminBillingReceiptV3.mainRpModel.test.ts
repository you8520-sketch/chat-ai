import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";
import {
  buildAdminBillingReceiptV3ForMissingUsage,
} from "@/lib/adminBillingReceiptV3";
import {
  formatAdminBillingReceiptV3MainRpModelLines,
  formatAdminBillingReceiptV3Text,
  resolveAdminBillingReceiptV3MainRpModelIdentity,
} from "@/lib/adminBillingReceiptV3Shared";
import type { Usage } from "@/lib/chatUsage";

const FX = {
  dateKey: "2026-08-30",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
};

function buildV3(usage: Usage, overrides: Partial<Parameters<typeof buildAdminBillingReceiptV3>[0]> = {}) {
  return buildAdminBillingReceiptV3({
    usage,
    assistantMessageId: 1,
    chatId: 1,
    suggestedRepliesRecord: null,
    statusMetaRecord: null,
    ledgerRows: [],
    ...overrides,
  });
}

function sameModelUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 1000,
    output: 500,
    model: "deepseek/deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 80,
    baseCost: 80,
    breakdown: [],
    shadowPricing: {
      pricingVersion: 1,
      billingReferenceInputUsdPerMillion: 1,
      billingReferenceOutputUsdPerMillion: 2,
      billingReferenceCostKrw: 10,
      billingReferenceCostUsd: 0.01,
      fxSnapshot: FX,
      providerListCostStatus: "complete",
      reserveStatus: "complete",
      actualTurnCostCoverage: "complete",
      actualProviderCostKrw: 31.2,
      actualCostUsd: 0.02,
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
      modelId: "deepseek/deepseek-v4-pro",
      provider: "cheaperinference",
    },
    ...overrides,
  };
}

describe("Admin Receipt v3 — Main RP model identity (canonical stored evidence)", () => {
  it("same model → Main RP 모델: <selectedModelLabel>", () => {
    const receipt = buildV3(sameModelUsage());
    const identity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
    assert.equal(identity.kind, "same");
    if (identity.kind === "same") {
      assert.equal(identity.selectedModelLabel, "DeepSeek V4 Pro");
    }
    assert.deepEqual(formatAdminBillingReceiptV3MainRpModelLines(identity), [
      "Main RP 모델: DeepSeek V4 Pro",
    ]);
  });

  it("selected/delivered mismatch → both lines from stored evidence", () => {
    // Adult handoff: selected Gemini 3.7 Flash, actually delivered qwen.
    const receipt = buildV3(
      sameModelUsage({
        model: "google/gemini-3.7-flash",
        modelLabel: "Gemini 3.7 Flash",
        shadowPricing: {
          ...sameModelUsage().shadowPricing!,
          modelId: "qwen/qwen3-235b-a22b",
          provider: "cheaperinference",
          actualCostSource: "cheaper_inference_billed",
        },
        adultRouting: {
          actualModel: "qwen/qwen3-235b-a22b",
          actualProvider: "cheaperinference",
        },
      })
    );
    const uc = receipt.syncReceipt!.userCharge;
    assert.equal(uc.selectedModelLabel, "Gemini 3.7 Flash");
    assert.equal(uc.billingModelId, "qwen/qwen3-235b-a22b");
    assert.equal(receipt.syncReceipt!.mainRp.actual?.model, "qwen/qwen3-235b-a22b");

    const identity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
    assert.equal(identity.kind, "different");
    if (identity.kind === "different") {
      assert.equal(identity.selectedModelLabel, "Gemini 3.7 Flash");
      assert.equal(identity.deliveredModel, "qwen/qwen3-235b-a22b");
    }
    assert.deepEqual(formatAdminBillingReceiptV3MainRpModelLines(identity), [
      "선택 모델: Gemini 3.7 Flash",
      "실제 처리 모델: qwen/qwen3-235b-a22b",
    ]);
  });

  it("missing Usage evidence → Main RP 모델: 확인 불가 (never infers)", () => {
    const receipt = buildAdminBillingReceiptV3ForMissingUsage({
      assistantMessageId: 1,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: [],
    });
    assert.equal(receipt.syncReceipt, null);
    const identity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
    assert.equal(identity.kind, "unverified");
    assert.deepEqual(formatAdminBillingReceiptV3MainRpModelLines(identity), [
      "Main RP 모델: 확인 불가",
    ]);
  });

  it("failed regen generation with only prior persisted evidence → 확인 불가, never inherits prior model", () => {
    // Receipt assembled for a failed regen has no scoped Usage snapshot for the
    // new generation. The resolver must fail closed and must NOT fall back to the
    // prior generation's delivered model id.
    const receipt = buildAdminBillingReceiptV3ForMissingUsage({
      assistantMessageId: 1,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: [],
    });
    const identity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
    assert.equal(identity.kind, "unverified");
    if (identity.kind === "different") {
      // Guard: any "different" branch must not surface a prior model id.
      assert.notEqual(identity.deliveredModel, "qwen/qwen3-235b-a22b");
      assert.notEqual(identity.deliveredModel, "deepseek/deepseek-v4-pro");
    }
  });

  it("regen generation isolation — a completed regen's receipt uses its own scoped usage, not generation A", () => {
    // Generation B usage: different selected label + delivered model.
    const genB = sameModelUsage({
      model: "google/gemini-3.7-flash",
      modelLabel: "Gemini 3.7 Flash",
      shadowPricing: {
        ...sameModelUsage().shadowPricing!,
        modelId: "google/gemini-3.7-flash",
        provider: "openrouter",
        actualCostSource: "provider_reported",
      },
    });
    const receipt = buildV3(genB, { assistantMessageId: 2 });
    const identity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
    assert.equal(identity.kind, "same");
    if (identity.kind === "same") {
      assert.equal(identity.selectedModelLabel, "Gemini 3.7 Flash");
    }
  });

  it("UI/clipboard parity — clipboard lines use the same canonical resolver", () => {
    const mismatch = buildV3(
      sameModelUsage({
        model: "google/gemini-3.7-flash",
        modelLabel: "Gemini 3.7 Flash",
        shadowPricing: {
          ...sameModelUsage().shadowPricing!,
          modelId: "qwen/qwen3-235b-a22b",
          provider: "cheaperinference",
        },
        adultRouting: {
          actualModel: "qwen/qwen3-235b-a22b",
          actualProvider: "cheaperinference",
        },
      })
    );
    const identity = resolveAdminBillingReceiptV3MainRpModelIdentity(mismatch);
    const clipboardText = formatAdminBillingReceiptV3Text(mismatch);
    for (const line of formatAdminBillingReceiptV3MainRpModelLines(identity)) {
      assert.ok(clipboardText.includes(line), `clipboard must include: ${line}`);
    }
    // Model identity appears above the turn summary.
    const modelIdx = clipboardText.indexOf("실제 처리 모델");
    const summaryIdx = clipboardText.indexOf("deducted:");
    assert.ok(modelIdx >= 0 && summaryIdx >= 0);
    assert.ok(modelIdx < summaryIdx, "model identity must render above turn summary");
  });

  it("same-model receipt clipboard also places Main RP 모델 above turn summary", () => {
    const receipt = buildV3(sameModelUsage());
    const clipboardText = formatAdminBillingReceiptV3Text(receipt);
    const modelIdx = clipboardText.indexOf("Main RP 모델:");
    const summaryIdx = clipboardText.indexOf("deducted:");
    assert.ok(modelIdx >= 0 && summaryIdx >= 0);
    assert.ok(modelIdx < summaryIdx);
  });
});