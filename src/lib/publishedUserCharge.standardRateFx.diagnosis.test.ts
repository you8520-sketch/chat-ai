import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
} from "@/lib/chatModels";
import {
  _clearLegacyExchangeRateCacheForTest,
  _setLegacyExchangeRateCacheForTest,
  getEffectiveKrwPerUsd,
} from "@/lib/exchangeRate";
import { resolveMainRpProviderAdmissionRequiredPoints } from "@/lib/mainRpProviderAdmission";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  computePublishedStandardPreviewDisplayPoints,
  computePublishedStandardPreviewPoints,
} from "@/lib/publishedUserCharge";
import { ensureShadowBillingFxTables } from "@/lib/shadowBillingFxPersistence";
import {
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
  resolveShadowBillingExchangeRateSnapshot,
} from "@/lib/shadowBillingExchangeRate";

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const SEQUENTIAL_FX = 1560.6;
const ACTUAL_IN = 17_104;
const ACTUAL_OUT = 2_726;
const PICKER_IN = 19_015;
const PICKER_OUT = 2_726;

function solDisplay(input: {
  promptTokens: number;
  outputTokens?: number;
  fx?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number | null {
  return computePublishedStandardPreviewDisplayPoints({
    modelId: SOL,
    promptTokens: input.promptTokens,
    outputTokens: input.outputTokens ?? ACTUAL_OUT,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
    effectiveKrwPerUsd: input.fx ?? SEQUENTIAL_FX,
  });
}

function solCeil(input: {
  promptTokens: number;
  outputTokens?: number;
  fx?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number | null {
  return computePublishedStandardPreviewPoints({
    modelId: SOL,
    promptTokens: input.promptTokens,
    outputTokens: input.outputTokens ?? ACTUAL_OUT,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
    effectiveKrwPerUsd: input.fx ?? SEQUENTIAL_FX,
  });
}

function findFxForDisplay(promptTokens: number, targetPoints: number): number | null {
  for (let fx = 1200; fx <= 1700; fx += 0.1) {
    if (solDisplay({ promptTokens, fx }) === targetPoints) return Math.round(fx * 10) / 10;
  }
  return null;
}

describe("Sol 174P vs 162P standard-rate / FX diagnosis", () => {
  it("records official Sol Standard rates and 45% margin", () => {
    const pricing = getPublishedPricing(SOL);
    assert.equal(pricing.billingReferenceInputUsdPerMillion, 2);
    assert.equal(pricing.billingReferenceOutputUsdPerMillion, 10);
    assert.equal(pricing.billingReferenceCacheReadUsdPerMillion, 0.1);
    assert.equal(pricing.billingReferenceCacheWriteUsdPerMillion, 2.5);
    assert.equal(pricing.targetMargin, 0.45);
    assert.equal(pricing.pricingVersion, 1);
  });

  it("17104/2726 Standard-only at sequential FX 1560.6 is 174 display / 175 ceil", () => {
    assert.equal(solDisplay({ promptTokens: ACTUAL_IN }), 174);
    assert.equal(solCeil({ promptTokens: ACTUAL_IN }), 175);
  });

  it("19015/2726 Standard-only at the same FX is 185 display, not 162", () => {
    assert.equal(solDisplay({ promptTokens: PICKER_IN }), 185);
    assert.notEqual(solDisplay({ promptTokens: PICKER_IN }), 162);
    assert.ok((solDisplay({ promptTokens: PICKER_IN }) ?? 0) > 174);
  });

  it("162P at 19015/2726 Standard-only requires a much lower FX than 1560.6", () => {
    const fxFor162 = findFxForDisplay(PICKER_IN, 162);
    const fxFor174 = findFxForDisplay(ACTUAL_IN, 174);
    assert.ok(fxFor162 != null, "19015/2726 can reproduce 162P at some FX");
    assert.ok(fxFor174 != null, "17104/2726 can reproduce 174P at some FX");
    assert.ok(fxFor162! < 1400, `162P FX should be far below settlement FX, got ${fxFor162}`);
    assert.ok(fxFor174! > 1500, `174P Standard FX should be near 1560, got ${fxFor174}`);
    assert.ok(fxFor174! - fxFor162! > 150);
    console.log(
      JSON.stringify({
        fxFor162At19015: fxFor162,
        fxFor174At17104: fxFor174,
        sequentialFx: SEQUENTIAL_FX,
        sameFxPicker: solDisplay({ promptTokens: PICKER_IN }),
        sameFxActualDisplay: solDisplay({ promptTokens: ACTUAL_IN }),
        sameFxActualCeil: solCeil({ promptTokens: ACTUAL_IN }),
      })
    );
  });

  it("cache read/write/miss keep the same Sol user P at the same prompt/output", () => {
    const miss = solDisplay({ promptTokens: ACTUAL_IN, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const hit = solDisplay({
      promptTokens: ACTUAL_IN,
      cacheReadTokens: 8_000,
      cacheWriteTokens: 0,
    });
    const write = solDisplay({
      promptTokens: ACTUAL_IN,
      cacheReadTokens: 0,
      cacheWriteTokens: 8_000,
    });
    assert.equal(miss, 174);
    assert.equal(hit, miss);
    assert.equal(write, miss);
  });

  it("provider cache cost still differs while Sol user P stays Standard-only", () => {
    const missUsd = openRouterUsdCostFromRates({
      modelId: SOL,
      promptTokens: ACTUAL_IN,
      outputTokens: ACTUAL_OUT,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }).usdCost;
    const hitUsd = openRouterUsdCostFromRates({
      modelId: SOL,
      promptTokens: ACTUAL_IN,
      outputTokens: ACTUAL_OUT,
      cacheReadTokens: 8_000,
      cacheWriteTokens: 0,
    }).usdCost;
    const writeUsd = openRouterUsdCostFromRates({
      modelId: SOL,
      promptTokens: ACTUAL_IN,
      outputTokens: ACTUAL_OUT,
      cacheReadTokens: 0,
      cacheWriteTokens: 8_000,
    }).usdCost;
    assert.ok(hitUsd < missUsd);
    assert.ok(writeUsd > missUsd);
    assert.equal(solDisplay({ promptTokens: ACTUAL_IN }), 174);
    assert.equal(solDisplay({ promptTokens: ACTUAL_IN, cacheReadTokens: 8_000 }), 174);
    assert.equal(solDisplay({ promptTokens: ACTUAL_IN, cacheWriteTokens: 8_000 }), 174);
  });

  it("picker and settlement both lock the daily shadow FX owner", () => {
    const estimateSource = readFileSync(
      path.join(process.cwd(), "src/lib/mainRpNextTurnEstimate.ts"),
      "utf8"
    );
    const serviceSource = readFileSync(
      path.join(process.cwd(), "src/services/mainRpNextTurnEstimate.ts"),
      "utf8"
    );
    const routeSource = readFileSync(
      path.join(process.cwd(), "src/app/api/chat/route.ts"),
      "utf8"
    );
    assert.match(estimateSource, /cacheReadTokens: 0/);
    assert.match(estimateSource, /cacheWriteTokens: 0/);
    assert.match(serviceSource, /resolveShadowBillingExchangeRateSnapshot/);
    assert.doesNotMatch(serviceSource, /getEffectiveKrwPerUsd/);
    assert.match(routeSource, /resolveShadowBillingExchangeRateSnapshot/);
    assert.match(routeSource, /publishedBillingFx/);
  });

  it("Gemini 3.8 / DeepSeek V4.1 / Opus 5.5 official Standard rates stay unchanged", () => {
    const gemini = getPublishedPricing(GEMINI_38_FLASH_MODEL);
    assert.equal(gemini.billingReferenceInputUsdPerMillion, 0.375);
    assert.equal(gemini.billingReferenceOutputUsdPerMillion, 1.875);
    assert.equal(gemini.targetMargin, 0.55);

    const flash = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(flash.billingReferenceInputUsdPerMillion, 0.3);
    assert.equal(flash.billingReferenceOutputUsdPerMillion, 1.2);
    assert.equal(flash.billingReferenceCacheReadUsdPerMillion, 0.006);
    assert.equal(flash.targetMargin, 0.6);

    const opus = getPublishedPricing(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    assert.equal(opus.targetMargin, 0.45);
    assert.equal(
      opus.billingReferenceCacheReadUsdPerMillion,
      opus.billingReferenceInputUsdPerMillion
    );
    assert.equal(
      opus.billingReferenceCacheWriteUsdPerMillion,
      opus.billingReferenceInputUsdPerMillion
    );
  });

  it("×3 admission and 80P floor stay derived from the displayed estimate", () => {
    const display = solDisplay({ promptTokens: PICKER_IN });
    assert.equal(display, 185);
    assert.equal(resolveMainRpProviderAdmissionRequiredPoints(display!), Math.max(80, 185 * 3));
    assert.equal(resolveMainRpProviderAdmissionRequiredPoints(80), 240);
    assert.equal(resolveMainRpProviderAdmissionRequiredPoints(20), 80);
  });
});

describe("same-KST-day published FX lock", () => {
  let db: Database.Database;

  afterEach(() => {
    _clearLegacyExchangeRateCacheForTest();
    _setShadowBillingFxTestDb(null);
    _clearShadowBillingFxMemoryForTest();
    db?.close();
  });

  it("picker and settlement share the locked daily FX even when legacy API diverges", () => {
    db = new Database(":memory:");
    ensureShadowBillingFxTables(db);
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T01:00:00.000Z"));
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-10-08",
      baseUsdKrw: 1530,
      source: "api_daily",
    });
    _setLegacyExchangeRateCacheForTest({
      dateKey: "2026-10-08",
      usdToKrw: 1339.092519,
      source: "api",
    });

    const first = resolveShadowBillingExchangeRateSnapshot();
    const afterRestart = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(first.dateKey, "2026-10-08");
    assert.equal(first.locked, true);
    assert.equal(first.usdToKrw, 1530);
    assert.equal(afterRestart.effectiveKrwPerUsd, first.effectiveKrwPerUsd);
    assert.notEqual(getEffectiveKrwPerUsd(), first.effectiveKrwPerUsd);

    assert.equal(solDisplay({ promptTokens: ACTUAL_IN, fx: first.effectiveKrwPerUsd }), 174);
    assert.equal(solDisplay({ promptTokens: PICKER_IN, fx: first.effectiveKrwPerUsd }), 185);
    assert.equal(solCeil({ promptTokens: ACTUAL_IN, fx: first.effectiveKrwPerUsd }), 175);
    assert.equal(
      solDisplay({ promptTokens: PICKER_IN, fx: getEffectiveKrwPerUsd() }),
      162
    );
  });
});
