import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI_38_FLASH_MODEL,
  GEMINI_4_ARGON_MODEL,
  OPENROUTER_GEMINI_4_ARGON_MODEL,
} from "@/lib/chatModels";
import { openRouterUsdCostFromRates, resolveOpenRouterModelRates, resolveTrpgGmOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { computeOpenRouterTurnBilling } from "@/lib/points";
import { convertUsdToKrw, resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import {
  computeTrpgRoundPoints,
  TRPG_BOT_USAGE_FALLBACK,
  TRPG_GM_USAGE_FALLBACK,
  type TrpgModelUsage,
} from "./billing";
import { resolveTrpgProviderCost } from "./roundEconomics";
import { isTrpgGmBillableModel } from "./trpgGmModelIdentity";

const SAMPLE: Pick<TrpgModelUsage, "inputTokens" | "outputTokens"> = {
  inputTokens: 10_000,
  outputTokens: 2_000,
};

function flexUsd(call: TrpgModelUsage): number {
  return openRouterUsdCostFromRates(
    {
      promptTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      modelId: call.modelId,
    },
    resolveTrpgGmOpenRouterModelRates(call.modelId)
  ).usdCost;
}

function standardGemini4Usd(call: TrpgModelUsage): number {
  return openRouterUsdCostFromRates({
    promptTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
  }).usdCost;
}

describe("TRPG GM Flex billing identity (canonical vs wire)", () => {
  it("treats canonical and wire Gemini 4 Argon as TRPG GM", () => {
    assert.equal(isTrpgGmBillableModel(GEMINI_4_ARGON_MODEL), true);
    assert.equal(isTrpgGmBillableModel(OPENROUTER_GEMINI_4_ARGON_MODEL), true);
    assert.equal(isTrpgGmBillableModel(GEMINI_38_FLASH_MODEL), false);
  });

  it("applies Flex fallback rates for canonical Gemini 4 without usage.cost", () => {
    const call: TrpgModelUsage = { modelId: GEMINI_4_ARGON_MODEL, ...SAMPLE };
    const flex = resolveTrpgGmOpenRouterModelRates(call.modelId);
    assert.equal(flex.inputUsdPerM, 1);
    assert.equal(flex.outputUsdPerM, 5);
    assert.ok(flexUsd(call) < standardGemini4Usd(call));
    const points = computeTrpgRoundPoints([call]);
    assert.ok(points > 0);
    const expectedUpstream = flexUsd(call);
    const expected = computeOpenRouterTurnBilling({
      modelId: call.modelId,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      upstreamCostUsd: expectedUpstream,
    }).total;
    assert.equal(points, expected);
  });

  it("applies Flex fallback rates for wire Gemini 4 without usage.cost", () => {
    const call: TrpgModelUsage = { modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, ...SAMPLE };
    assert.ok(flexUsd(call) > 0);
    const canonicalPoints = computeTrpgRoundPoints([
      { modelId: GEMINI_4_ARGON_MODEL, ...SAMPLE },
    ]);
    const wirePoints = computeTrpgRoundPoints([call]);
    assert.equal(wirePoints, canonicalPoints);
  });

  it("prefers provider usage.cost for wire Gemini 4 GM", () => {
    const upstreamCostUsd = 0.0123;
    const call: TrpgModelUsage = {
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
      ...SAMPLE,
      upstreamCostUsd,
    };
    const points = computeTrpgRoundPoints([call]);
    const expected = computeOpenRouterTurnBilling({
      modelId: call.modelId,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      upstreamCostUsd,
    }).total;
    assert.equal(points, expected);
    const economics = resolveTrpgProviderCost([call]);
    assert.equal(economics.providerCostUsd, upstreamCostUsd);
    assert.equal(economics.costSource, "actual");
  });

  it("keeps Main RP Gemini 4 on Standard fallback rates", () => {
    const standard = resolveOpenRouterModelRates(OPENROUTER_GEMINI_4_ARGON_MODEL);
    assert.equal(standard.inputUsdPerM, 2);
    assert.equal(standard.outputUsdPerM, 10);
    const trpgFlex = resolveTrpgGmOpenRouterModelRates(OPENROUTER_GEMINI_4_ARGON_MODEL);
    assert.equal(trpgFlex.inputUsdPerM, 1);
  });

  it("keeps AI companion Gemini 3.8 on non-GM Flex path", () => {
    const bot: TrpgModelUsage = { modelId: GEMINI_38_FLASH_MODEL, ...SAMPLE };
    assert.equal(isTrpgGmBillableModel(bot.modelId), false);
    const gmFlexEstimate = flexUsd({ modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, ...SAMPLE });
    const botPoints = computeTrpgRoundPoints([bot]);
    const gmPoints = computeTrpgRoundPoints([
      { modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, ...SAMPLE },
    ]);
    assert.ok(botPoints > 0);
    assert.ok(gmPoints > 0);
    assert.equal(
      resolveTrpgGmOpenRouterModelRates(GEMINI_38_FLASH_MODEL).inputUsdPerM,
      resolveOpenRouterModelRates(GEMINI_38_FLASH_MODEL).inputUsdPerM
    );
    assert.equal(resolveTrpgGmOpenRouterModelRates(OPENROUTER_GEMINI_4_ARGON_MODEL).inputUsdPerM, 1);
    const mixed = computeTrpgRoundPoints([
      { modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, ...SAMPLE },
      bot,
    ]);
    assert.equal(mixed, gmPoints + botPoints);
    assert.ok(gmFlexEstimate > 0);
  });

  it("mixed GM wire + bot fallback matches sum of parts", () => {
    const mixed = computeTrpgRoundPoints([TRPG_GM_USAGE_FALLBACK, TRPG_BOT_USAGE_FALLBACK]);
    const gmOnly = computeTrpgRoundPoints([TRPG_GM_USAGE_FALLBACK]);
    const botOnly = computeTrpgRoundPoints([TRPG_BOT_USAGE_FALLBACK]);
    assert.equal(mixed, gmOnly + botOnly);
  });
});

describe("TRPG GM charge path vs TRPG_GM_GROSS_MARGIN constant", () => {
  it("documents live OpenRouter Gemini billing uses raw-cost token path, not the 65% constant", () => {
    const fx = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
    const upstream = flexUsd({ modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, inputTokens: 5000, outputTokens: 800 });
    const points = computeTrpgRoundPoints([
      { modelId: OPENROUTER_GEMINI_4_ARGON_MODEL, inputTokens: 5000, outputTokens: 800 },
    ]);
    const rawKrw = convertUsdToKrw(upstream, fx);
    assert.ok(points >= 5);
    assert.equal(points, computeOpenRouterTurnBilling({
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
      inputTokens: 5000,
      outputTokens: 800,
      upstreamCostUsd: upstream,
    }).total);
    const with65Margin = Math.ceil(rawKrw / (1 - 0.65) - 1e-9);
    assert.notEqual(points, with65Margin, "TRPG_GM_GROSS_MARGIN is not applied on this OpenRouter path");
  });
});
