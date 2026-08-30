import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  serializeUsageForPublicClient,
  sanitizeUsageForPublicReceipt,
  stripAdultRoutingForClient,
} from "@/lib/billingReceiptAccess";
import * as adultHandoffDisplay from "@/lib/adultHandoffDisplay";
import {
  assertNoInternalEconomics,
  PUBLIC_USAGE_INTERNAL_STAGE_KEYS,
  PUBLIC_USAGE_INTERNAL_TOP_LEVEL_KEYS,
} from "@/lib/publicUsageEconomicsBoundary";
import type { Usage } from "@/lib/chatUsage";

function baseUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 100,
    output: 200,
    model: "claude-opus-5",
    modelLabel: "Claude Opus 5",
    route: "safe",
    cost: 42,
    savedOutputChars: 1800,
    billingWaived: false,
    breakdown: [{ label: "선택 페르소나", tokens: 80, pct: 40 }],
    apiInputTokens: 120,
    apiOutputTokens: 210,
    apiReasoningOutputTokens: 10,
    ...overrides,
  };
}

describe("public usage economics boundary — T1 top-level provider economics", () => {
  it("strips all top-level provider/internal economics keys", () => {
    const internal = baseUsage({
      apiRawCostKrw: 88,
      apiRawCostSource: "provider_reported",
      mainApiRawCostKrw: 70,
      upstreamCostUsd: 0.012,
      normalizedRawCostKrw: 66,
      cacheDiscountUsd: 0.001,
      exchangeRateKrwPerUsd: 1560,
      exchangeRateDateKey: "2026-08-30",
      exchangeRateMode: "daily_kst",
      exchangeRateSource: "api",
      shadowPricing: {
        pricingVersion: 1,
        billingReferenceInputUsdPerMillion: 5,
        billingReferenceOutputUsdPerMillion: 25,
        billingReferenceCostKrw: 10,
        billingReferenceCostUsd: 0.01,
        fxSnapshot: {
          dateKey: "2026-08-30",
          source: "api_daily",
          baseUsdKrw: 1530,
          overseasFeeRate: 0.02,
          effectiveKrwPerUsd: 1560.6,
        },
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
      statusWidgetExtract: {
        model: "gpt-5.6-luna",
        modelLabel: "GPT-5.6 Luna (공유 초기)",
        input: 50,
        output: 30,
        apiRawCostKrw: 4,
        callCount: 1,
        postTurnSharedInitial: true,
      },
      apiCallCount: 3,
    } as Usage);

    const pub = serializeUsageForPublicClient(internal);
    for (const key of PUBLIC_USAGE_INTERNAL_TOP_LEVEL_KEYS) {
      assert.equal((pub as Record<string, unknown>)[key], undefined, key);
    }
    assertNoInternalEconomics(pub, "T1");
  });
});

describe("public usage economics boundary — T2 nested stage economics", () => {
  it("strips provider/internal stage fields while preserving user-visible stage identity", () => {
    const internal = baseUsage({
      stages: [
        {
          stage: "openRouterAdult",
          model: "claude-opus-5",
          input: 100,
          output: 200,
          cost: 42,
          upstreamCostUsd: 0.01,
          cheaperInferenceBilledCostUsd: 0.009,
          cacheDiscountUsd: 0.001,
          usageReportingEvidence: {
            cacheRead: "reported_valid",
            cacheWrite: "unreported",
            reasoning: "reported_valid",
          },
          providerRequestId: "req_abc",
          debugRawUsage: { prompt_tokens: 100 },
          finishReason: "stop",
          estimated: false,
        } as Usage["stages"] extends (infer S)[] | undefined ? S : never,
      ],
    });

    const pub = serializeUsageForPublicClient(internal);
    const stage = pub.stages?.[0] as Record<string, unknown> | undefined;
    assert.ok(stage);
    for (const key of PUBLIC_USAGE_INTERNAL_STAGE_KEYS) {
      assert.equal(stage[key], undefined, key);
    }
    assert.equal(stage.stage, "openRouterAdult");
    assert.equal(stage.model, "claude-opus-5");
    assert.equal(stage.input, 100);
    assert.equal(stage.output, 200);
    assert.equal(stage.finishReason, "stop");
    assertNoInternalEconomics(pub, "T2");
  });
});

describe("public usage economics boundary — T3/T4 shared post-turn economics", () => {
  it("T3 — pure shared initial aggregate absent on public", () => {
    const internal = baseUsage({
      statusWidgetExtract: {
        model: "gpt-5.6-luna",
        modelLabel: "GPT-5.6 Luna (공유 초기: 상태창 + 추천입력)",
        input: 80,
        output: 40,
        apiRawCostKrw: 5,
        callCount: 1,
        postTurnSharedInitial: true,
        upstreamCostUsd: 0.004,
      },
    });
    const pub = serializeUsageForPublicClient(internal);
    assert.equal(pub.statusWidgetExtract, undefined);
    assertNoInternalEconomics(pub, "T3");
  });

  it("T4 — mixed shared + repair aggregate absent on public; admin input unchanged", () => {
    const internal = baseUsage({
      statusWidgetExtract: {
        model: "gpt-5.6-luna",
        modelLabel: "GPT-5.6 Luna (후처리 · 공유 초기 포함)",
        input: 120,
        output: 60,
        apiRawCostKrw: 8,
        callCount: 2,
        postTurnSharedInitial: true,
        upstreamCostUsd: 0.006,
      },
    });
    const pub = serializeUsageForPublicClient(internal);
    assert.equal(pub.statusWidgetExtract, undefined);

    const admin = serializeUsageForPublicClient(internal, { keepInternal: true });
    assert.ok(admin.statusWidgetExtract);
    assert.equal(admin.statusWidgetExtract?.postTurnSharedInitial, true);
    assert.equal(admin.statusWidgetExtract?.callCount, 2);
  });
});

describe("public usage economics boundary — T5 CI settlement", () => {
  it("strips cheaperInferenceBilledCostUsd from public stages", () => {
    const internal = baseUsage({
      stages: [
        {
          stage: "openRouterAdult",
          model: "claude-opus-5",
          input: 10,
          output: 20,
          cost: 5,
          cheaperInferenceBilledCostUsd: 0.0025,
        } as Usage["stages"] extends (infer S)[] | undefined ? S : never,
      ],
    });
    const pub = serializeUsageForPublicClient(internal);
    assert.equal(
      (pub.stages?.[0] as Record<string, unknown> | undefined)?.cheaperInferenceBilledCostUsd,
      undefined
    );
    assertNoInternalEconomics(pub, "T5");
  });
});

describe("public usage economics boundary — T6 public user-visible contract", () => {
  it("preserves model, tokens, cost, saved chars, breakdown, waiver, reasoning telemetry", () => {
    const internal = baseUsage({
      billingWaived: true,
      billingWaiverReason: "admin_waiver",
      savedOutputChars: 2200,
      apiReasoningOutputTokens: 15,
      apiOutputTokens: 215,
    });
    const pub = serializeUsageForPublicClient(internal);
    assert.equal(pub.model, internal.model);
    assert.equal(pub.modelLabel, internal.modelLabel);
    assert.equal(pub.input, internal.input);
    assert.equal(pub.output, internal.output);
    assert.equal(pub.cost, internal.cost);
    assert.equal(pub.savedOutputChars, 2200);
    assert.equal(pub.billingWaived, true);
    assert.equal(pub.billingWaiverReason, "admin_waiver");
    assert.equal(pub.apiReasoningOutputTokens, 15);
    assert.equal(pub.apiOutputTokens, 215);
    assert.equal(pub.breakdown.length, 1);
  });
});

describe("public usage economics boundary — T7 adult handoff identity", () => {
  it("preserves selected user-facing model identity and strips hidden routing economics", () => {
    const internal = baseUsage({
      model: "qwen-3-8-max",
      modelLabel: "Qwen 3.8 Max",
      selectedAI: "qwen-3-8-max",
      provider: "cheaperinference",
      route: "nsfw",
      adultRouting: {
        activeRoute: "adult",
        actualModel: "qwen-3-8-max",
        actualProvider: "cheaperinference",
        userSelectedModel: "claude-opus-5",
        userSelectedModelLabel: "Claude Opus 5",
        userSelectedProvider: "cheaperinference",
        hiddenFallbackOverheadCostUsd: 0.2,
      },
    });
    const pub = serializeUsageForPublicClient(internal);
    assert.equal(pub.model, "claude-opus-5");
    assert.equal(pub.modelLabel, "Claude Opus 5");
    assert.equal(pub.adultRouting, undefined);
    assertNoInternalEconomics(pub, "T7");
  });
});

describe("public usage economics boundary — T8 admin untouched", () => {
  it("keeps provider economics on admin/full serialization path", () => {
    const internal = baseUsage({
      apiRawCostKrw: 90,
      upstreamCostUsd: 0.02,
      shadowPricing: { pricingVersion: 1 } as Usage["shadowPricing"],
      statusWidgetExtract: {
        model: "gpt-5.6-luna",
        modelLabel: "widget",
        input: 1,
        output: 1,
        apiRawCostKrw: 3,
      },
      stages: [
        {
          stage: "openRouterAdult",
          model: "claude-opus-5",
          input: 10,
          output: 20,
          cost: 42,
          cheaperInferenceBilledCostUsd: 0.01,
        },
      ],
    });
    const admin = serializeUsageForPublicClient(internal, { keepInternal: true });
    assert.equal(admin.apiRawCostKrw, 90);
    assert.equal(admin.upstreamCostUsd, 0.02);
    assert.ok(admin.shadowPricing);
    assert.ok(admin.statusWidgetExtract);
    assert.equal(
      (admin.stages?.[0] as Record<string, unknown> | undefined)?.cheaperInferenceBilledCostUsd,
      0.01
    );
  });
});

describe("public usage economics boundary — T9 legacy row", () => {
  it("sanitizes legacy widgetCostPoints and old FX/internal economics", () => {
    const legacy = {
      ...baseUsage(),
      widgetCostPoints: 5,
      exchangeRateKrwPerUsd: 1400,
      mainApiRawCostKrw: 50,
      apiRawCostKrw: 55,
    } as Usage & { widgetCostPoints: number };
    const pub = serializeUsageForPublicClient(legacy);
    assertNoInternalEconomics(pub, "T9");
  });
});

describe("public usage economics boundary — T10 serialization entrypoint", () => {
  it("serializeUsageForPublicClient is the canonical public path (no bypass)", () => {
    const leakyDbRow = baseUsage({
      apiRawCostKrw: 99,
      upstreamCostUsd: 0.03,
      stages: [
        {
          stage: "openRouterAdult",
          model: "claude-opus-5",
          input: 1,
          output: 2,
          cost: 42,
          cheaperInferenceBilledCostUsd: 0.01,
        },
      ],
    });

    const publicClient = serializeUsageForPublicClient(leakyDbRow, { keepInternal: false });
    assertNoInternalEconomics(publicClient, "T10-public");

    const adminClient = serializeUsageForPublicClient(leakyDbRow, { keepInternal: true });
    assert.equal(adminClient.apiRawCostKrw, 99);
  });

  it("stripAdultRoutingForClient alone does not own economics privacy", () => {
    const usage = baseUsage({
      shadowPricing: { pricingVersion: 1 } as Usage["shadowPricing"],
      apiRawCostKrw: 12,
    });
    const routingOnly = stripAdultRoutingForClient(usage);
    assert.equal(routingOnly.apiRawCostKrw, 12);
    assert.ok((routingOnly as Usage).shadowPricing);

    const canonical = sanitizeUsageForPublicReceipt(usage);
    assert.equal(canonical.apiRawCostKrw, undefined);
    assert.equal((canonical as Usage).shadowPricing, undefined);
  });
});

describe("public usage economics boundary — T11 duplicate owner", () => {
  it("FORBIDDEN_PUBLIC_USAGE_KEYS duplicate export removed", () => {
    assert.equal(
      (adultHandoffDisplay as Record<string, unknown>).FORBIDDEN_PUBLIC_USAGE_KEYS,
      undefined
    );
  });
});

describe("public usage economics boundary — T12 adult handoff canonical serializer", () => {
  it("handoff scenarios use serializeUsageForPublicClient with identity + privacy", () => {
    const usage = baseUsage({
      model: "qwen-3-8-max",
      modelLabel: "Qwen 3.8 Max",
      selectedAI: "qwen-3-8-max",
      provider: "cheaperinference",
      route: "nsfw",
      adultRouting: {
        activeRoute: "adult",
        actualModel: "qwen-3-8-max",
        actualProvider: "cheaperinference",
        userSelectedModel: "claude-opus-5",
        userSelectedModelLabel: "Claude Opus 5",
        userSelectedProvider: "cheaperinference",
        fallbackSucceeded: true,
      },
    });
    const pub = serializeUsageForPublicClient(usage);
    assert.equal(pub.model, "claude-opus-5");
    assert.equal(pub.modelLabel, "Claude Opus 5");
    assert.equal(pub.adultRouting, undefined);
    assertNoInternalEconomics(pub, "T12");
  });
});

describe("public usage economics boundary — T13 operational telemetry", () => {
  it("strips unused top-level provider/cache/recovery telemetry from public", () => {
    const internal = baseUsage({
      cacheReadTokens: 500,
      cacheWriteTokens: 100,
      standardInputTokens: 800,
      lengthRecoveryPasses: 2,
      assembledInputTokens: 12000,
      fallback: "legacy-fallback-model",
    });
    const pub = serializeUsageForPublicClient(internal);
    assert.equal(pub.cacheReadTokens, undefined);
    assert.equal(pub.cacheWriteTokens, undefined);
    assert.equal(pub.standardInputTokens, undefined);
    assert.equal(pub.lengthRecoveryPasses, undefined);
    assert.equal(pub.assembledInputTokens, undefined);
    assert.equal(pub.fallback, undefined);
    assertNoInternalEconomics(pub, "T13-public");

    const admin = serializeUsageForPublicClient(internal, { keepInternal: true });
    assert.equal(admin.cacheReadTokens, 500);
    assert.equal(admin.cacheWriteTokens, 100);
    assert.equal(admin.standardInputTokens, 800);
    assert.equal(admin.lengthRecoveryPasses, 2);
    assert.equal(admin.assembledInputTokens, 12000);
    assert.equal(admin.fallback, "legacy-fallback-model");
  });
});

describe("public usage economics boundary — T14 reasoning contract", () => {
  it("preserves api token fields required by public receipt UI", () => {
    const internal = baseUsage({
      apiInputTokens: 150,
      apiOutputTokens: 220,
      apiContentOutputTokens: 200,
      apiReasoningOutputTokens: 20,
    });
    const pub = serializeUsageForPublicClient(internal);
    assert.equal(pub.apiInputTokens, 150);
    assert.equal(pub.apiOutputTokens, 220);
    assert.equal(pub.apiContentOutputTokens, 200);
    assert.equal(pub.apiReasoningOutputTokens, 20);
  });
});

describe("public usage economics boundary — T15 admin telemetry preserved", () => {
  it("admin path keeps cache/recovery telemetry and provider economics", () => {
    const internal = baseUsage({
      cacheReadTokens: 400,
      cacheWriteTokens: 50,
      standardInputTokens: 700,
      lengthRecoveryPasses: 1,
      assembledInputTokens: 9000,
      apiRawCostKrw: 77,
      upstreamCostUsd: 0.015,
      shadowPricing: { pricingVersion: 2 } as Usage["shadowPricing"],
    });
    const admin = serializeUsageForPublicClient(internal, { keepInternal: true });
    assert.equal(admin.cacheReadTokens, 400);
    assert.equal(admin.cacheWriteTokens, 50);
    assert.equal(admin.standardInputTokens, 700);
    assert.equal(admin.lengthRecoveryPasses, 1);
    assert.equal(admin.assembledInputTokens, 9000);
    assert.equal(admin.apiRawCostKrw, 77);
    assert.equal(admin.upstreamCostUsd, 0.015);
    assert.ok(admin.shadowPricing);
  });
});
