import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI_38_FLASH_MODEL,
  GEMINI_4_ARGON_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
  OPENROUTER_GEMINI_4_ARGON_MODEL,
} from "@/lib/chatModels";
import { computeOpenRouterTurnBilling } from "@/lib/points";
import { getTargetMargin } from "@/lib/publishedModelPricing";
import {
  ceilPublishedChargePoints,
  convertUsdToKrwPure,
  roundKrwTenths,
} from "@/lib/publishedChargeRounding";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import {
  openRouterUsdCostFromRates,
  resolveOpenRouterModelRates,
  resolveTrpgGmOpenRouterModelRates,
  resolveTrpgOpenRouterFlexFallbackRates,
  TRPG_GEMINI_38_FLASH_FLEX_POST_INTRO_AT,
  TRPG_GEMINI_4_ARGON_FLEX_POST_INTRO_AT,
} from "@/lib/openRouterModelPricing";
import {
  computeTrpgRoundPoints,
  TRPG_BOT_USAGE_FALLBACK,
  TRPG_GM_USAGE_FALLBACK,
  type TrpgModelUsage,
} from "./billing";
import { resolveTrpgProviderCost } from "./roundEconomics";
import { isTrpgGmBillableModel } from "./trpgGmModelIdentity";
import {
  computeTrpgPublishedMarginChargePoints,
  explainTrpgPublishedMarginCharge,
  resolveTrpgCallUpstreamCostUsd,
} from "./trpgPublishedMarginCharge";

const INTRO_AT = new Date("2026-10-26T12:00:00.000Z");
const ARGON_POST_AT = new Date(TRPG_GEMINI_4_ARGON_FLEX_POST_INTRO_AT);
const ARGON_LAST_INTRO_AT = new Date(Date.parse(TRPG_GEMINI_4_ARGON_FLEX_POST_INTRO_AT) - 1);
const FLASH_POST_AT = new Date(TRPG_GEMINI_38_FLASH_FLEX_POST_INTRO_AT);
const FLASH_LAST_INTRO_AT = new Date(Date.parse(TRPG_GEMINI_38_FLASH_FLEX_POST_INTRO_AT) - 1);

const SAMPLE: Pick<TrpgModelUsage, "inputTokens" | "outputTokens"> = {
  inputTokens: 10_000,
  outputTokens: 2_000,
};

function flexUsd(call: TrpgModelUsage, now: Date = INTRO_AT): number {
  return openRouterUsdCostFromRates(
    {
      promptTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cacheReadTokens: call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      modelId: call.modelId,
    },
    resolveTrpgOpenRouterFlexFallbackRates(call.modelId, now)
  ).usdCost;
}

function expectedPublishedPoints(upstreamUsd: number, modelId: string): number {
  const margin = getTargetMargin(modelId);
  const fx = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
  const rawKrw = roundKrwTenths(convertUsdToKrwPure(upstreamUsd, fx));
  return ceilPublishedChargePoints(roundKrwTenths(rawKrw / (1 - margin)));
}

describe("TRPG published-margin billing", () => {
  it("charges wire and canonical Gemini 4 GM at 55% on Flex-estimated cost", () => {
    for (const modelId of [GEMINI_4_ARGON_MODEL, OPENROUTER_GEMINI_4_ARGON_MODEL] as const) {
      const call: TrpgModelUsage = { modelId, ...SAMPLE };
      const upstream = flexUsd(call, INTRO_AT);
      const points = computeTrpgPublishedMarginChargePoints(call, INTRO_AT);
      assert.equal(points, expectedPublishedPoints(upstream, modelId));
      const explained = explainTrpgPublishedMarginCharge(call);
      assert.ok(explained);
      assert.equal(explained.targetMargin, 0.55);
      assert.equal(explained.upstreamSource, "estimated");
    }
  });

  it("prefers provider usage.cost for GM wire rows", () => {
    const upstreamCostUsd = 0.0123;
    const call: TrpgModelUsage = {
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
      ...SAMPLE,
      upstreamCostUsd,
    };
    assert.equal(resolveTrpgCallUpstreamCostUsd(call).upstreamSource, "provider");
    assert.equal(computeTrpgRoundPoints([call]), expectedPublishedPoints(upstreamCostUsd, call.modelId));
    const economics = resolveTrpgProviderCost([call]);
    assert.equal(economics.providerCostUsd, upstreamCostUsd);
    assert.equal(economics.costSource, "actual");
  });

  it("separates GM Flex cost from Main RP Standard list fallback", () => {
    const call: TrpgModelUsage = { modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, ...SAMPLE };
    const flex = flexUsd(call, INTRO_AT);
    const standard = openRouterUsdCostFromRates({
      promptTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
    }).usdCost;
    assert.ok(flex < standard);
    assert.equal(resolveTrpgGmOpenRouterModelRates(call.modelId, INTRO_AT).inputUsdPerM, 1);
    assert.equal(resolveOpenRouterModelRates(OPENROUTER_GEMINI_4_ARGON_MODEL).inputUsdPerM, 2);
    assert.equal(resolveOpenRouterModelRates(OPENROUTER_GEMINI_4_ARGON_MODEL).outputUsdPerM, 10);
  });

  it("applies published 55% to bot Gemini 3.8 Flash", () => {
    const call: TrpgModelUsage = { modelId: GEMINI_38_FLASH_MODEL, ...SAMPLE };
    const upstream = resolveTrpgCallUpstreamCostUsd(call, INTRO_AT).upstreamCostUsd;
    assert.equal(
      computeTrpgPublishedMarginChargePoints(call, INTRO_AT),
      expectedPublishedPoints(upstream, call.modelId)
    );
    assert.equal(getTargetMargin(GEMINI_38_FLASH_MODEL), 0.55);
  });

  it("estimates bot canonical and wire ids at the same OpenRouter 3.8 Flex fallback rates", () => {
    for (const modelId of [GEMINI_38_FLASH_MODEL, OPENROUTER_GEMINI_38_FLASH_MODEL] as const) {
      const call: TrpgModelUsage = { modelId, ...SAMPLE };
      const upstream = resolveTrpgCallUpstreamCostUsd(call, INTRO_AT).upstreamCostUsd;
      const intro = resolveTrpgOpenRouterFlexFallbackRates(OPENROUTER_GEMINI_38_FLASH_MODEL, INTRO_AT);
      assert.equal(intro.inputUsdPerM, 0.375);
      assert.equal(intro.outputUsdPerM, 1.875);
      assert.equal(intro.cacheReadUsdPerM, 0.0375);
      const flexDirect = openRouterUsdCostFromRates(
        {
          promptTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          modelId: OPENROUTER_GEMINI_38_FLASH_MODEL,
        },
        intro
      ).usdCost;
      assert.equal(upstream, flexDirect);
      const mainRpList = openRouterUsdCostFromRates(
        {
          promptTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          modelId: OPENROUTER_GEMINI_38_FLASH_MODEL,
        },
        resolveOpenRouterModelRates(OPENROUTER_GEMINI_38_FLASH_MODEL)
      ).usdCost;
      assert.ok(flexDirect < mainRpList);
      const genericCanonical = openRouterUsdCostFromRates({
        promptTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        modelId: GEMINI_38_FLASH_MODEL,
      }).usdCost;
      assert.ok(
        flexDirect > genericCanonical,
        "billing must use 3.8 Flex fallback, not generic OpenRouter rates on canonical slug"
      );
    }
  });

  it("charges TRPG_BOT_USAGE_FALLBACK with 3.8 Flex estimate, not generic OpenRouter rates", () => {
    const upstream = resolveTrpgCallUpstreamCostUsd(TRPG_BOT_USAGE_FALLBACK, INTRO_AT).upstreamCostUsd;
    const flex = openRouterUsdCostFromRates(
      {
        promptTokens: TRPG_BOT_USAGE_FALLBACK.inputTokens,
        outputTokens: TRPG_BOT_USAGE_FALLBACK.outputTokens,
        modelId: OPENROUTER_GEMINI_38_FLASH_MODEL,
      },
      resolveTrpgOpenRouterFlexFallbackRates(OPENROUTER_GEMINI_38_FLASH_MODEL, INTRO_AT)
    ).usdCost;
    assert.equal(upstream, flex);
    assert.equal(
      computeTrpgPublishedMarginChargePoints(TRPG_BOT_USAGE_FALLBACK, INTRO_AT),
      expectedPublishedPoints(upstream, TRPG_BOT_USAGE_FALLBACK.modelId)
    );
    const economics = resolveTrpgProviderCost([TRPG_BOT_USAGE_FALLBACK]);
    assert.equal(economics.providerCostUsd, Math.round(upstream * 1e6) / 1e6);
    assert.equal(economics.costSource, "estimated");
  });

  it("honors cache-read tokens in GM Flex estimates", () => {
    const call: TrpgModelUsage = {
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
      inputTokens: 20_000,
      outputTokens: 1_000,
      cacheReadTokens: 15_000,
    };
    const withoutCache = flexUsd({ ...call, cacheReadTokens: undefined });
    const withCache = flexUsd(call);
    assert.ok(withCache < withoutCache);
    assert.equal(
      computeTrpgPublishedMarginChargePoints(call, INTRO_AT),
      expectedPublishedPoints(withCache, call.modelId)
    );
  });

  it("returns zero points for failed calls with no tokens", () => {
    assert.equal(
      computeTrpgRoundPoints([{ modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, inputTokens: 0, outputTokens: 0 }]),
      0
    );
  });

  it("mixed GM wire + bot round sums per-call published charges", () => {
    const gm: TrpgModelUsage = { modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, ...SAMPLE };
    const bot: TrpgModelUsage = { modelId: GEMINI_38_FLASH_MODEL, inputTokens: 2500, outputTokens: 400 };
    const mixed = computeTrpgRoundPoints([gm, bot]);
    assert.equal(mixed, computeTrpgRoundPoints([gm]) + computeTrpgRoundPoints([bot]));
    assert.equal(
      computeTrpgRoundPoints([TRPG_GM_USAGE_FALLBACK, TRPG_BOT_USAGE_FALLBACK]),
      computeTrpgRoundPoints([TRPG_GM_USAGE_FALLBACK]) + computeTrpgRoundPoints([TRPG_BOT_USAGE_FALLBACK])
    );
  });

  it("switches GM and bot Flex fallbacks on the published intro end instants", () => {
    for (const modelId of [GEMINI_4_ARGON_MODEL, OPENROUTER_GEMINI_4_ARGON_MODEL] as const) {
      const intro = resolveTrpgOpenRouterFlexFallbackRates(modelId, ARGON_LAST_INTRO_AT);
      const post = resolveTrpgOpenRouterFlexFallbackRates(modelId, ARGON_POST_AT);
      assert.equal(intro.inputUsdPerM, 1);
      assert.equal(intro.outputUsdPerM, 5);
      assert.equal(intro.cacheReadUsdPerM, 0.05);
      assert.equal(post.inputUsdPerM, 2);
      assert.equal(post.outputUsdPerM, 10);
      assert.equal(post.cacheReadUsdPerM, 0.1);
      const call: TrpgModelUsage = { modelId, ...SAMPLE, cacheReadTokens: 4_000 };
      const introUsd = resolveTrpgCallUpstreamCostUsd(call, ARGON_LAST_INTRO_AT).upstreamCostUsd;
      const postUsd = resolveTrpgCallUpstreamCostUsd(call, ARGON_POST_AT).upstreamCostUsd;
      assert.ok(postUsd > introUsd);
      assert.equal(
        computeTrpgPublishedMarginChargePoints(call, ARGON_POST_AT),
        expectedPublishedPoints(postUsd, modelId)
      );
    }
    for (const modelId of [GEMINI_38_FLASH_MODEL, OPENROUTER_GEMINI_38_FLASH_MODEL] as const) {
      const intro = resolveTrpgOpenRouterFlexFallbackRates(modelId, FLASH_LAST_INTRO_AT);
      const post = resolveTrpgOpenRouterFlexFallbackRates(modelId, FLASH_POST_AT);
      assert.equal(intro.inputUsdPerM, 0.375);
      assert.equal(intro.outputUsdPerM, 1.875);
      assert.equal(intro.cacheReadUsdPerM, 0.0375);
      assert.equal(post.inputUsdPerM, 0.75);
      assert.equal(post.outputUsdPerM, 3.75);
      assert.equal(post.cacheReadUsdPerM, 0.075);
      const call: TrpgModelUsage = { modelId, inputTokens: 8_000, outputTokens: 500, cacheReadTokens: 2_000 };
      const introUsd = resolveTrpgCallUpstreamCostUsd(call, FLASH_LAST_INTRO_AT).upstreamCostUsd;
      const postUsd = resolveTrpgCallUpstreamCostUsd(call, FLASH_POST_AT).upstreamCostUsd;
      assert.equal(postUsd, introUsd * 2);
      assert.equal(explainTrpgPublishedMarginCharge(call, FLASH_POST_AT)?.targetMargin, 0.55);
    }
    const priced: TrpgModelUsage = {
      modelId: OPENROUTER_GEMINI_38_FLASH_MODEL,
      inputTokens: 1_000,
      outputTokens: 100,
      upstreamCostUsd: 0.004,
    };
    assert.equal(resolveTrpgCallUpstreamCostUsd(priced, FLASH_POST_AT).upstreamSource, "provider");
    assert.equal(resolveTrpgCallUpstreamCostUsd(priced, FLASH_POST_AT).upstreamCostUsd, 0.004);
    assert.equal(resolveOpenRouterModelRates(OPENROUTER_GEMINI_38_FLASH_MODEL).inputUsdPerM, 0.75);
    assert.equal(resolveOpenRouterModelRates(OPENROUTER_GEMINI_4_ARGON_MODEL).inputUsdPerM, 2);
  });

  it("documents effective margin near published target on estimated GM cost", () => {
    const call: TrpgModelUsage = { modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, inputTokens: 5000, outputTokens: 800 };
    const explained = explainTrpgPublishedMarginCharge(call)!;
    const effectiveMargin = 1 - explained.rawCostKrw / explained.chargeKrw;
    assert.ok(Math.abs(effectiveMargin - 0.55) < 0.001);
  });

  it("does not change Main RP legacy OpenRouter billing path", () => {
    const legacy = computeOpenRouterTurnBilling({
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
      inputTokens: 5000,
      outputTokens: 800,
      upstreamCostUsd: 0.01,
    }).total;
    const legacyAgain = computeOpenRouterTurnBilling({
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
      inputTokens: 5000,
      outputTokens: 800,
      upstreamCostUsd: 0.01,
    }).total;
    assert.equal(legacy, legacyAgain);
    const trpg = computeTrpgRoundPoints([
      { modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, inputTokens: 5000, outputTokens: 800, upstreamCostUsd: 0.01 },
    ]);
    assert.notEqual(trpg, legacy, "TRPG uses published margin; Main RP legacy path unchanged but different");
  });
});

describe("TRPG GM Flex billing identity (canonical vs wire)", () => {
  it("treats canonical and wire Gemini 4 Argon as TRPG GM", () => {
    assert.equal(isTrpgGmBillableModel(GEMINI_4_ARGON_MODEL), true);
    assert.equal(isTrpgGmBillableModel(OPENROUTER_GEMINI_4_ARGON_MODEL), true);
    assert.equal(isTrpgGmBillableModel(GEMINI_38_FLASH_MODEL), false);
  });
});
