import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI_38_FLASH_MODEL,
  GEMINI_4_ARGON_MODEL,
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
  explainTrpgPublishedMarginCharge,
  resolveTrpgCallUpstreamCostUsd,
} from "./trpgPublishedMarginCharge";

const SAMPLE: Pick<TrpgModelUsage, "inputTokens" | "outputTokens"> = {
  inputTokens: 10_000,
  outputTokens: 2_000,
};

function flexUsd(call: TrpgModelUsage): number {
  return openRouterUsdCostFromRates(
    {
      promptTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cacheReadTokens: call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      modelId: call.modelId,
    },
    resolveTrpgGmOpenRouterModelRates(call.modelId)
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
      const upstream = flexUsd(call);
      const points = computeTrpgRoundPoints([call]);
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
    const flex = flexUsd(call);
    const standard = openRouterUsdCostFromRates({
      promptTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
    }).usdCost;
    assert.ok(flex < standard);
    assert.equal(resolveTrpgGmOpenRouterModelRates(call.modelId).inputUsdPerM, 1);
    assert.equal(resolveOpenRouterModelRates(OPENROUTER_GEMINI_4_ARGON_MODEL).inputUsdPerM, 2);
  });

  it("applies published 55% to bot Gemini 3.8 Flash", () => {
    const call: TrpgModelUsage = { modelId: GEMINI_38_FLASH_MODEL, ...SAMPLE };
    const upstream = resolveTrpgCallUpstreamCostUsd(call).upstreamCostUsd;
    assert.equal(computeTrpgRoundPoints([call]), expectedPublishedPoints(upstream, call.modelId));
    assert.equal(getTargetMargin(GEMINI_38_FLASH_MODEL), 0.55);
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
    assert.equal(computeTrpgRoundPoints([call]), expectedPublishedPoints(withCache, call.modelId));
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
