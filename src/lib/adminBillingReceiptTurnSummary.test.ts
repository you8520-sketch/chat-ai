import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildAdminReceiptTurnSummary,
  formatAdminReceiptTurnSummaryLines,
  resolveAdminReceiptSettledPoints,
  resolveWholeTurnMarginUnavailableReason,
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

function buildReceiptFromUsage(u: Usage, mainRpOutputVisibleChars: number | null = null) {
  return buildAdminBillingReceiptV3({
    usage: u,
    assistantMessageId: 1,
    chatId: 1,
    mainRpOutputVisibleChars,
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

  it("completed normal uses persisted visible Main RP text count", () => {
    const summary = buildAdminReceiptTurnSummary(
      buildReceiptFromUsage(usage({ output: 17 }), 3214)
    );
    assert.equal(summary.outputVisibleChars, 3214);
    assert.match(
      formatAdminReceiptTurnSummaryLines(summary).join("\n"),
      /출력 글자수 \(Main RP\)\s+3,214자/
    );
  });

  it("completed regen uses generation B persisted text count", () => {
    const summary = buildAdminReceiptTurnSummary(
      buildReceiptFromUsage(usage({ output: 3480 }), 3480)
    );
    assert.equal(summary.outputVisibleChars, 3480);
  });

  it("missing persisted text evidence stays null and never renders zero", () => {
    const summary = buildAdminReceiptTurnSummary(buildReceiptFromUsage(usage(), null));
    assert.equal(summary.outputVisibleChars, null);
    const lines = formatAdminReceiptTurnSummaryLines(summary).join("\n");
    assert.match(lines, /출력 글자수 \(Main RP\)\s+확인 불가/);
    assert.doesNotMatch(lines, /출력 글자수 \(Main RP\).*0자/);
  });

  it("does not estimate visible chars from output tokens", () => {
    const summary = buildAdminReceiptTurnSummary(
      buildReceiptFromUsage(usage({ output: 1 }), 3214)
    );
    assert.equal(summary.outputVisibleChars, 3214);
  });

  it("missing shadowPricing keeps summary visible with margin unavailable", () => {
    const u = usage({ cost: 55, shadowPricing: undefined });
    const receipt = buildReceiptFromUsage(u);
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.equal(summary.deductedPoints, 55);
    assert.equal(summary.inputTokens, 9000);
    assert.equal(summary.outputTokens, 2500);
    assert.equal(summary.marginPercent, null);
    assert.match(summary.marginUnavailableReason ?? "", /검증 불가|unavailable|coverage/i);
    assert.equal(receipt.wholeTurn.contributionMarginPercent, null);
  });

  it("Y/Z unknown missing-Usage evidence never renders zero", () => {
    const receipt = {
      ...buildReceiptFromUsage(usage()),
      syncReceipt: null,
      forensic: {
        chargeStatus: "unknown" as const,
        chargeEvidenceSettledPoints: null,
      },
    };
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.equal(summary.deductedPoints, null);
    assert.equal(summary.inputTokens, null);
    assert.equal(summary.outputTokens, null);
    const ko = formatAdminReceiptTurnSummaryLines(summary).join("\n");
    const en = formatAdminReceiptTurnSummaryLines(summary, { locale: "en" }).join("\n");
    assert.match(ko, /실제 차감\s+확인 불가/);
    assert.match(ko, /총 입력 토큰.*확인 불가/);
    assert.match(en, /deducted: unavailable/);
    assert.match(en, /input tokens.*unavailable/);
  });

  it("AA proven not-charged missing-Usage evidence renders canonical 0P", () => {
    const receipt = {
      ...buildReceiptFromUsage(usage()),
      syncReceipt: null,
      forensic: {
        chargeStatus: "not_charged" as const,
        chargeEvidenceSettledPoints: 0,
      },
    };
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.equal(summary.deductedPoints, 0);
    assert.match(formatAdminReceiptTurnSummaryLines(summary).join("\n"), /실제 차감\s+0 P/);
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
    const receipt = buildReceiptFromUsage(u, 3421);
    const text = formatAdminBillingReceiptV3Text(receipt);
    assert.match(text, /\[Turn Summary\]/);
    assert.match(text, /deducted: 33 P/);
    assert.match(text, /input tokens \(Main RP\): 9,000/);
    assert.match(text, /output tokens \(Main RP\): 2,500/);
    assert.match(text, /output chars \(Main RP\): 3,421/);
    assert.match(
      formatAdminReceiptTurnSummaryLines(buildAdminReceiptTurnSummary(receipt)).join("\n"),
      /출력 글자수 \(Main RP\)\s+3,421자/
    );
    assert.match(text, /margin: unavailable/);
    const panelSource = readFileSync(
      new URL("../components/AdminBillingReceiptV3Panel.tsx", import.meta.url),
      "utf8"
    );
    assert.match(panelSource, /formatAdminReceiptTurnSummaryLines\(turnSummary/);
  });

  it("uses whole-turn contribution margin, not Main RP margin", () => {
    const receipt = buildReceiptFromUsage(usage({ cost: 80 }));
    const withWholeTurn = {
      ...receipt,
      wholeTurn: {
        ...receipt.wholeTurn,
        coverage: "complete" as const,
        contributionMarginPercent: 61,
      },
      syncReceipt: {
        ...receipt.syncReceipt,
        mainRp: {
          ...receipt.syncReceipt.mainRp,
          marginPercent: 99,
        },
      },
    };
    const summary = buildAdminReceiptTurnSummary(withWholeTurn);
    assert.equal(summary.marginPercent, 61);
  });

  it("Main RP margin alone does not surface as realized margin when whole-turn incomplete", () => {
    const receipt = buildReceiptFromUsage(usage({ cost: 80, shadowPricing: undefined }));
    const withPartialWholeTurn = {
      ...receipt,
      wholeTurn: {
        ...receipt.wholeTurn,
        coverage: "unverifiable" as const,
        contributionMarginPercent: null,
        mainExact: false,
        syncExact: true,
      },
      async: {
        ...receipt.async,
        coverage: "unverifiable" as const,
        byFamily: receipt.async.byFamily.map((family) =>
          family.family === "status_meta"
            ? { ...family, coverage: "unverifiable" as const }
            : family
        ),
      },
      syncReceipt: {
        ...receipt.syncReceipt,
        mainRp: {
          ...receipt.syncReceipt.mainRp,
          marginPercent: 62,
          actual: true,
        },
      },
    };
    const summary = buildAdminReceiptTurnSummary(withPartialWholeTurn);
    assert.equal(summary.marginPercent, null);
    assert.match(summary.marginUnavailableReason ?? "", /Main RP 실제 Provider 원가 미확정/);
    assert.match(summary.marginUnavailableReason ?? "", /Status Meta/);
    assert.doesNotMatch(summary.marginUnavailableReason ?? "", /^Status Meta coverage/);
  });

  it("resolveWholeTurnMarginUnavailableReason uses syncExact evidence", () => {
    const receipt = buildReceiptFromUsage(usage());
    const reason = resolveWholeTurnMarginUnavailableReason({
      ...receipt,
      wholeTurn: {
        ...receipt.wholeTurn,
        mainExact: true,
        syncExact: false,
        syncProvablyNone: false,
        contributionMarginPercent: null,
      },
      async: { ...receipt.async, coverage: "complete" },
    });
    assert.match(reason, /동기 플랫폼 비용 미확정/);
    assert.doesNotMatch(reason, /Status Meta coverage/);
  });

  it("UI formatter omits duplicate heading when includeHeading=false", () => {
    const summary = buildAdminReceiptTurnSummary(buildReceiptFromUsage(usage()));
    const lines = formatAdminReceiptTurnSummaryLines(summary, {
      locale: "ko",
      includeHeading: false,
    });
    assert.equal(lines.some((l) => l.includes("[턴 요약]")), false);
    assert.match(lines.join("\n"), /실제 차감/);
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
