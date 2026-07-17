import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendStatusWidgetExtractToUsageRecord,
  applyStatusWidgetBillingCharge,
  buildStatusWidgetExtractReceipt,
  mergeStatusWidgetExtractUsages,
  statusWidgetApiCostChargePoints,
  statusWidgetExtractModelLabel,
  type StatusWidgetExtractBillingMeta,
} from "./receiptUsage";
import type { Usage } from "@/lib/chatUsage";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { openRouterRawCostKrw } from "@/lib/billingRawCost";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import {
  OPENROUTER_CLAUDE_DEFAULT,
  OPENROUTER_DEEPSEEK_V3_MODEL,
  OPENROUTER_GEMINI_25_FLASH_MODEL,
} from "@/lib/chatModels";

const FLASH: StatusWidgetExtractBillingMeta = {
  modelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
  callCount: 1,
};
const V3: StatusWidgetExtractBillingMeta = {
  modelId: OPENROUTER_DEEPSEEK_V3_MODEL,
  callCount: 1,
};

function baseUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 10000,
    output: 1000,
    model: OPENROUTER_CLAUDE_DEFAULT,
    modelLabel: "Claude Opus",
    provider: "openrouter",
    route: "nsfw",
    cost: 48,
    baseCost: 48,
    breakdown: [],
    apiInputTokens: 17970,
    apiOutputTokens: 1500,
    apiRawCostKrw: 33,
    mainApiRawCostKrw: 33,
    apiCallCount: 1,
    ...overrides,
  };
}

describe("statusWidget receiptUsage", () => {
  it("mergeStatusWidgetExtractUsages sums token fields", () => {
    const merged = mergeStatusWidgetExtractUsages([
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      { inputTokens: 800, outputTokens: 40, estimated: true, upstreamCostUsd: 0.01 },
    ]);
    assert.equal(merged?.inputTokens, 1800);
    assert.equal(merged?.outputTokens, 90);
    assert.equal(merged?.estimated, true);
    assert.equal(merged?.upstreamCostUsd, 0.01);
  });

  it("Flash billing meta never records Opus as extract model", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = appendStatusWidgetExtractToUsageRecord(
      baseUsage(),
      { inputTokens: 4252, outputTokens: 120, estimated: false },
      exchangeRate,
      FLASH
    );
    assert.equal(out.statusWidgetExtract!.model, OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.match(out.statusWidgetExtract!.modelLabel, /Gemini 2\.5 Flash/);
    assert.doesNotMatch(out.statusWidgetExtract!.model, /opus|claude/i);
    assert.doesNotMatch(out.statusWidgetExtract!.modelLabel, /Opus|Claude/i);
    assert.equal(out.model, OPENROUTER_CLAUDE_DEFAULT);
  });

  it("character initial callCount=1 adds +1 to apiCallCount", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = appendStatusWidgetExtractToUsageRecord(
      baseUsage({ apiCallCount: 1 }),
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      exchangeRate,
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 1 }
    );
    assert.equal(out.statusWidgetExtract!.callCount, 1);
    assert.equal(out.apiCallCount, 2);
  });

  it("initial+repair callCount=2 adds +2 to apiCallCount", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = appendStatusWidgetExtractToUsageRecord(
      baseUsage({ apiCallCount: 1 }),
      { inputTokens: 1800, outputTokens: 90, estimated: false },
      exchangeRate,
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 2 }
    );
    assert.equal(out.statusWidgetExtract!.callCount, 2);
    assert.equal(out.apiCallCount, 3);
  });

  it("dual initial callCount=2", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = appendStatusWidgetExtractToUsageRecord(
      baseUsage({ apiCallCount: 1 }),
      { inputTokens: 2000, outputTokens: 100, estimated: false },
      exchangeRate,
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 2 }
    );
    assert.equal(out.statusWidgetExtract!.callCount, 2);
    assert.equal(out.apiCallCount, 3);
  });

  it("dual both repair callCount=4 → apiCallCount +4", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = appendStatusWidgetExtractToUsageRecord(
      baseUsage({ apiCallCount: 1 }),
      { inputTokens: 4000, outputTokens: 200, estimated: false },
      exchangeRate,
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 4 }
    );
    assert.equal(out.statusWidgetExtract!.callCount, 4);
    assert.equal(out.apiCallCount, 5);
  });

  it("preserves prior apiCallCount from length recovery", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = appendStatusWidgetExtractToUsageRecord(
      baseUsage({ apiCallCount: 3 }),
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      exchangeRate,
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 2 }
    );
    assert.equal(out.apiCallCount, 5);
  });

  it("stage is 상태창 추출 without V3", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = appendStatusWidgetExtractToUsageRecord(
      baseUsage(),
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      exchangeRate,
      FLASH
    );
    const stage = out.stages?.find((s) => s.model === OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.ok(stage);
    assert.equal(stage!.stage, "상태창 추출");
    assert.equal(stage!.stage.includes("V3"), false);
  });

  it("upstreamCostUsd wins over model rate estimate", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const upstream = 0.0123;
    const withUpstream = buildStatusWidgetExtractReceipt(
      { inputTokens: 5000, outputTokens: 200, estimated: false, upstreamCostUsd: upstream },
      exchangeRate,
      FLASH
    );
    const flashEstimate = buildStatusWidgetExtractReceipt(
      { inputTokens: 5000, outputTokens: 200, estimated: true },
      exchangeRate,
      FLASH
    );
    assert.equal(withUpstream.upstreamCostUsd, upstream);
    assert.ok(Math.abs(withUpstream.apiRawCostKrw - openRouterRawCostKrw({
      promptTokens: 5000,
      outputTokens: 200,
      modelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      upstreamCostUsd: upstream,
      exchangeRate,
    })) < 1e-9);
    assert.notEqual(withUpstream.apiRawCostKrw, flashEstimate.apiRawCostKrw);
  });

  it("no upstream + Flash uses Flash rates not DeepSeek V3 hardcoded", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const flash = buildStatusWidgetExtractReceipt(
      { inputTokens: 1_000_000, outputTokens: 1_000_000, estimated: true },
      exchangeRate,
      FLASH
    );
    const v3 = buildStatusWidgetExtractReceipt(
      { inputTokens: 1_000_000, outputTokens: 1_000_000, estimated: true },
      exchangeRate,
      V3
    );
    assert.equal(flash.model, OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.notEqual(flash.apiRawCostKrw, v3.apiRawCostKrw);
    const rates = resolveOpenRouterModelRates(OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.equal(rates.inputUsdPerM, 0.3);
    assert.equal(rates.outputUsdPerM, 2.5);
    assert.equal(rates.cacheReadUsdPerM, 0.03);
  });

  it("no upstream + DeepSeek V3 0324 uses V3 rates not V4 Pro", () => {
    const v3Rates = resolveOpenRouterModelRates(OPENROUTER_DEEPSEEK_V3_MODEL);
    const v4Rates = resolveOpenRouterModelRates("deepseek/deepseek-v4-pro");
    assert.equal(v3Rates.inputUsdPerM, 0.24);
    assert.equal(v3Rates.outputUsdPerM, 0.9);
    assert.equal(v4Rates.inputUsdPerM, 0.435);
    assert.notEqual(v3Rates.inputUsdPerM, v4Rates.inputUsdPerM);

    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const receipt = buildStatusWidgetExtractReceipt(
      { inputTokens: 1_000_000, outputTokens: 0, estimated: true },
      exchangeRate,
      V3
    );
    assert.equal(receipt.model, OPENROUTER_DEEPSEEK_V3_MODEL);
    assert.match(receipt.modelLabel, /DeepSeek V3 0324/);
  });

  it("showFullBillingReceipt true/false yield same widget P", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const usage = {
      inputTokens: 4252,
      outputTokens: 120,
      estimated: false,
      upstreamCostUsd: 0.002,
    };
    const meta: StatusWidgetExtractBillingMeta = {
      modelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      callCount: 2,
    };
    const full = applyStatusWidgetBillingCharge(baseUsage(), usage, exchangeRate, 48, meta);
    const receipt = buildStatusWidgetExtractReceipt(usage, exchangeRate, meta);
    const plainPoints = statusWidgetApiCostChargePoints(receipt.apiRawCostKrw);
    assert.equal(full.widgetCostPoints, plainPoints);
    assert.equal(full.totalCost, 48 + plainPoints);
    assert.equal(full.record.baseCost, 48);
  });

  it("applyStatusWidgetBillingCharge keeps main RP baseCost", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const out = applyStatusWidgetBillingCharge(
      baseUsage(),
      { inputTokens: 4252, outputTokens: 120, estimated: false, upstreamCostUsd: 0.002 },
      exchangeRate,
      48,
      FLASH
    );
    assert.equal(out.record.baseCost, 48);
    assert.equal(out.totalCost, 48 + out.widgetCostPoints);
    assert.equal(
      out.record.stages?.find((s) => s.stage === "상태창 추출")?.cost,
      out.widgetCostPoints
    );
  });

  it("model labels", () => {
    assert.equal(
      statusWidgetExtractModelLabel(OPENROUTER_GEMINI_25_FLASH_MODEL),
      "Google Gemini 2.5 Flash (상태창 추출)"
    );
    assert.equal(
      statusWidgetExtractModelLabel(OPENROUTER_DEEPSEEK_V3_MODEL),
      "DeepSeek V3 0324 (상태창 추출)"
    );
    assert.equal(
      statusWidgetExtractModelLabel("vendor/custom-model"),
      "vendor/custom-model (상태창 추출)"
    );
  });

  it("statusWidgetApiCostChargePoints ceils KRW raw cost", () => {
    assert.equal(statusWidgetApiCostChargePoints(0), 0);
    assert.equal(statusWidgetApiCostChargePoints(12.1), 13);
    assert.equal(statusWidgetApiCostChargePoints(12), 12);
  });
});
