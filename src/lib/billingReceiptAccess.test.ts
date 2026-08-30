import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL,
  BILLING_BREAKDOWN_SYSTEM_RULES_LABEL,
  canShowFullBillingReceipt,
  filterUsageBreakdownForReceipt,
  sanitizeUsageForPublicReceipt,
  stripAdultRoutingForClient,
} from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";

describe("canShowFullBillingReceipt", () => {
  it("does not expose operational pricing details to non-admin demo accounts", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: "demo@example.com", is_admin: 0 }),
      false
    );
  });

  it("allows admin flag", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: "user@example.com", is_admin: 1 }),
      true
    );
  });

  it("denies regular users", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: "user@example.com", is_admin: 0 }),
      false
    );
  });

  it("filters system rules from public breakdown", () => {
    const breakdown = [
      { label: "캐릭터 프롬프트", tokens: 100, pct: 50 },
      { label: BILLING_BREAKDOWN_SYSTEM_RULES_LABEL, tokens: 100, pct: 50 },
    ];
    const filtered = filterUsageBreakdownForReceipt(breakdown, false);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.label, "캐릭터 프롬프트");
  });

  it("keeps keyword lorebook line for public receipts", () => {
    const breakdown = [
      { label: BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL, tokens: 40, pct: 20 },
      { label: BILLING_BREAKDOWN_SYSTEM_RULES_LABEL, tokens: 60, pct: 30 },
      { label: "선택 페르소나", tokens: 100, pct: 50 },
    ];
    const filtered = filterUsageBreakdownForReceipt(breakdown, false);
    assert.deepEqual(
      filtered.map((b) => b.label),
      [BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL, "선택 페르소나"]
    );
  });

  it("strips widget and exchange fields for public receipt", () => {
    const usage = {
      input: 1,
      output: 2,
      model: "test",
      route: "safe" as const,
      cost: 10,
      breakdown: [{ label: BILLING_BREAKDOWN_SYSTEM_RULES_LABEL, tokens: 5, pct: 100 }],
      statusWidgetExtract: {
        model: "x",
        modelLabel: "widget",
        input: 1,
        output: 1,
        apiRawCostKrw: 3,
      },
      statusWidgetExtractDiagnostics: {
        exhausted: true,
        usedFallback: false,
        attempts: [
          {
            stage: "initial",
            modelId: "deepseek-v4-flash",
            httpStatus: 503,
            finishReason: null,
            errorCode: "CompatibleCompletionError",
          },
        ],
      },
      widgetCostPoints: 3,
      exchangeRateKrwPerUsd: 1400,
      exchangeRateDateKey: "2026-01-01",
      breakdownAllocation: "estimated_section_allocation",
      assembledPromptChars: {
        system: 100,
        systemRules: 40,
        characterSettings: 30,
        dynamic: 20,
        history: 50,
        currentUser: 10,
        total: 160,
      },
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.assembledPromptChars, undefined);
    assert.equal(sanitized.breakdownAllocation, undefined);
    assert.equal(sanitized.statusWidgetExtract, undefined);
    assert.equal(sanitized.statusWidgetExtractDiagnostics, undefined);
    assert.equal(sanitized.widgetCostPoints, undefined);
    assert.equal(sanitized.exchangeRateKrwPerUsd, undefined);
    assert.equal(sanitized.breakdown.length, 0);
  });

  it("preserves finishReason and smoke max-token telemetry on public sanitize", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "deepseek/deepseek-v4-pro",
      route: "safe" as const,
      cost: 1,
      breakdown: [],
      finishReason: "length",
      requestedMaxTokens: 4096,
      effectiveMaxTokens: 4096,
      targetResponseChars: 2200,
      statusWidgetExtract: {
        model: "x",
        modelLabel: "widget",
        input: 1,
        output: 1,
        apiRawCostKrw: 3,
      },
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.finishReason, "length");
    assert.equal(sanitized.requestedMaxTokens, 4096);
    assert.equal(sanitized.effectiveMaxTokens, 4096);
    assert.equal(sanitized.targetResponseChars, 2200);
    assert.equal(sanitized.statusWidgetExtract, undefined);
  });

  it("strips museAcceptance from public sanitize (defense in depth)", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "meta/muse-spark-1.1",
      route: "nsfw" as const,
      cost: 1,
      breakdown: [],
      museAcceptance: { acceptanceClass: "SHORT_QUALITY_PASS", visibleChars: 1200 },
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.museAcceptance, undefined);
  });

  it("strips English-layer admin metadata from public receipts", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "deepseek-v4-pro-0813",
      route: "safe" as const,
      cost: 1,
      breakdown: [],
      usedEnglishCharacterPrompt: true,
      characterPromptLanguage: "english",
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.usedEnglishCharacterPrompt, undefined);
    assert.equal(sanitized.characterPromptLanguage, undefined);
  });

  it("rewrites handoff identity to the selected model and strips adultRouting for public", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "qwen-3-8-max",
      modelLabel: "Qwen 3.8 Max",
      selectedAI: "qwen-3-8-max",
      provider: "cheaperinference" as const,
      route: "nsfw" as const,
      cost: 12,
      breakdown: [],
      stages: [
        { stage: "adult", model: "qwen-3-8-max", input: 10, output: 20, cost: 12 },
      ],
      adultRouting: {
        activeRoute: "adult" as const,
        actualModel: "qwen-3-8-max",
        actualProvider: "cheaperinference",
        userSelectedModel: "claude-opus-5",
        userSelectedModelLabel: "Claude Opus 5",
        userSelectedProvider: "cheaperinference" as const,
        glmHardFailureReason: "hidden",
        hiddenFallbackOverheadCostUsd: 0.2,
      },
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.model, "claude-opus-5");
    assert.equal(sanitized.modelLabel, "Claude Opus 5");
    assert.equal(sanitized.selectedAI, "claude-opus-5");
    assert.equal(sanitized.adultRouting, undefined);
    assert.equal(sanitized.cost, 12);
    const client = stripAdultRoutingForClient(usage);
    assert.equal(client.selectedAI, "claude-opus-5");
    assert.equal(client.adultRouting, undefined);
    const admin = stripAdultRoutingForClient(usage, { keepInternal: true });
    assert.equal(admin.adultRouting?.actualModel, "qwen-3-8-max");
    assert.equal(admin.modelLabel, "Claude Opus 5");
  });

  it("strips generationKind/canonical from public receipts", () => {
    const usage = {
      input: 1,
      output: 2,
      model: "claude-opus-5",
      route: "safe" as const,
      cost: 4,
      breakdown: [],
      generationKind: "ooc_scene_render" as const,
      canonical: false,
      canonAdopted: true,
      canonAdoptedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.generationKind, undefined);
    assert.equal(sanitized.canonical, undefined);
    assert.equal(sanitized.canonAdopted, undefined);
    assert.equal(sanitized.canonAdoptedAt, undefined);
  });
});

describe("billingReceiptAccess shadow privacy", () => {
  it("strips shadowPricing from public receipt", () => {
    const usage = {
      input: 100,
      output: 200,
      model: "claude-opus-5",
      route: "safe" as const,
      cost: 100,
      breakdown: [],
      shadowPricing: {
        pricingVersion: 1,
        billingReferenceInputUsdPerMillion: 5,
        billingReferenceOutputUsdPerMillion: 25,
        billingReferenceCostKrw: 10,
        billingReferenceCostUsd: 0.01,
        fxSnapshot: { dateKey: "2026-08-28", source: "api_daily", baseUsdKrw: 1530, overseasFeeRate: 0.02, effectiveKrwPerUsd: 1560.6 },
        providerListCostStatus: "complete",
        reserveStatus: "complete",
        actualProviderCostKrw: 5,
        actualCostSource: "cheaper_inference_billed",
        providerListCostKrw: 8,
        inputCostKrw: 5,
        outputCostKrw: 5,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.2,
        minimumMarginFloor: 0.1,
        standardUserChargeKrw: 12,
        promoPercent: 0,
        finalShadowChargeKrw: 12,
        finalShadowPoints: 12,
        providerSavingsKrw: 3,
        providerOverrunKrw: 0,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: 3,
        actualGrossProfitKrw: 7,
        actualRealizedMargin: 0.5,
        worstCasePromoMargin: 0.3,
        marginFloorViolated: false,
      },
    } as unknown as Usage;
    const pub = sanitizeUsageForPublicReceipt(usage);
    assert.equal((pub as unknown as Record<string, unknown>).shadowPricing, undefined);
  });

  it("strips adminBillingReceipt from public receipt", () => {
    const usage = {
      input: 100,
      output: 50,
      model: "google/gemini-3.7-flash",
      route: "safe" as const,
      cost: 10,
      adminBillingReceipt: {
        schemaVersion: 1,
        userCharge: {
          modelId: "google/gemini-3.7-flash",
          modelLabel: "Gemini",
          inputTokens: 100,
          outputTokens: 50,
          outputChars: 200,
          deductedPoints: 10,
          pricingVersion: 1,
          waived: false,
          waiverReason: null,
        },
        providerActualSettlement: {
          provider: "cheaperinference",
          actualProviderCostUsd: 0.0217,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          fxDateKey: "2026-08-30",
          fxMode: "daily_kst",
          baseUsdKrw: 1377,
          effectiveKrwPerUsd: 1405,
          overseasCardFeeRate: 0.02,
          baseActualKrw: 30.5,
          effectiveProviderCashCostKrw: 31.1,
        },
        providerListReference: {
          providerListCostUsd: 0.0309,
          referenceSource: "cheaper_inference_catalog_reference_rates",
          baseReferenceKrw: 43.4,
        },
        publishedBillingReference: {
          billingReferenceCostUsd: 0.015,
          billingReferenceCostKrw: 21,
          pricingVersion: 1,
        },
        internalEconomics: null,
        providerCalls: [],
      },
    } as unknown as Usage;
    const pub = sanitizeUsageForPublicReceipt(usage);
    assert.equal((pub as unknown as Record<string, unknown>).adminBillingReceipt, undefined);
  });

  it("strips usageReportingEvidence from public receipt stages", () => {
    const usage = {
      input: 100,
      output: 200,
      model: "gemini-3.1-pro-preview",
      route: "safe" as const,
      cost: 10,
      breakdown: [],
      stages: [
        {
          stage: "openRouterAdult",
          model: "gemini-3.1-pro-preview",
          input: 100,
          output: 200,
          cost: 10,
          usageReportingEvidence: {
            cacheRead: "reported_valid",
            cacheWrite: "unreported",
            reasoning: "reported_valid",
          },
        },
      ],
    } as unknown as Usage;
    const pub = sanitizeUsageForPublicReceipt(usage);
    assert.equal(
      (pub.stages?.[0] as Record<string, unknown> | undefined)?.usageReportingEvidence,
      undefined
    );
  });

  it("strips synthetic future published charge snapshot fields from public receipt", () => {
    const usage = {
      input: 100,
      output: 200,
      model: "gemini-3.1-pro-preview",
      route: "safe" as const,
      cost: 229,
      breakdown: [],
      publishedChargeSnapshot: {
        chargeSnapshotSchemaVersion: 1,
        roundingPolicyVersion: "published_points_v1",
        canonicalModelId: "gemini-3.1-pro-preview",
        pricingVersion: 2,
        targetMargin: 0.09,
        minimumMarginFloor: 0.05,
        billingReferenceInputUsdPerMillion: 2,
        billingReferenceOutputUsdPerMillion: 12,
        fxSource: "api_daily",
        usdToKrw: 1530,
        effectiveKrwPerUsd: 1560.6,
        overseasFeeRate: 0.02,
        finalPoints: 229,
      },
    } as unknown as Usage;
    const pub = sanitizeUsageForPublicReceipt(usage);
    const leaked = pub as unknown as Record<string, unknown>;
    assert.equal(leaked.publishedChargeSnapshot, undefined);
    assert.equal(leaked.targetMargin, undefined);
  });

  it("also strips via stripAdultRoutingForClient without keepInternal", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "test",
      route: "safe" as const,
      cost: 1,
      breakdown: [],
      shadowPricing: { pricingVersion: 1 } as unknown as Usage["shadowPricing"],
    } as unknown as Usage;
    const client = stripAdultRoutingForClient(usage);
    assert.equal((client as unknown as Record<string, unknown>).shadowPricing, undefined);
    const admin = stripAdultRoutingForClient(usage, { keepInternal: true });
    assert.ok((admin as unknown as Record<string, unknown>).shadowPricing != null);
  });
});
