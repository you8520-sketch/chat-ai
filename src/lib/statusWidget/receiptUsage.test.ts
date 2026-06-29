import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendStatusWidgetExtractToUsageRecord,
  applyStatusWidgetBillingCharge,
  mergeStatusWidgetExtractUsages,
  statusWidgetApiCostChargePoints,
} from "./receiptUsage";
import type { Usage } from "@/lib/chatUsage";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";

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

  it("appendStatusWidgetExtractToUsageRecord splits main vs widget raw cost", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const base: Usage = {
      input: 10000,
      output: 1000,
      model: "deepseek/deepseek-v4-pro",
      provider: "openrouter",
      route: "nsfw",
      cost: 48,
      breakdown: [],
      apiInputTokens: 17970,
      apiOutputTokens: 1500,
      apiRawCostKrw: 33,
      mainApiRawCostKrw: 33,
    };
    const out = appendStatusWidgetExtractToUsageRecord(
      base,
      { inputTokens: 4252, outputTokens: 120, estimated: false, upstreamCostUsd: 0.002 },
      exchangeRate
    );
    assert.ok(out.statusWidgetExtract);
    assert.equal(out.statusWidgetExtract!.input, 4252);
    assert.equal(out.statusWidgetExtract!.output, 120);
    assert.ok(out.statusWidgetExtract!.apiRawCostKrw > 0);
    assert.equal(out.mainApiRawCostKrw, 33);
    assert.ok(out.apiRawCostKrw! > out.mainApiRawCostKrw!);
    assert.equal(out.apiInputTokens, 17970 + 4252);
    assert.equal(out.stages?.some((s) => s.stage.includes("위젯")), true);
  });

  it("statusWidgetApiCostChargePoints ceils KRW raw cost", () => {
    assert.equal(statusWidgetApiCostChargePoints(0), 0);
    assert.equal(statusWidgetApiCostChargePoints(12.1), 13);
    assert.equal(statusWidgetApiCostChargePoints(12), 12);
  });

  it("applyStatusWidgetBillingCharge adds widget cost to main billing", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const base: Usage = {
      input: 10000,
      output: 1000,
      model: "deepseek/deepseek-v4-pro",
      provider: "openrouter",
      route: "nsfw",
      cost: 48,
      baseCost: 48,
      breakdown: [],
      apiInputTokens: 17970,
      apiOutputTokens: 1500,
      apiRawCostKrw: 33,
      mainApiRawCostKrw: 33,
    };
    const out = applyStatusWidgetBillingCharge(
      base,
      { inputTokens: 4252, outputTokens: 120, estimated: false, upstreamCostUsd: 0.002 },
      exchangeRate,
      48
    );
    assert.ok(out.widgetCostPoints > 0);
    assert.equal(out.totalCost, 48 + out.widgetCostPoints);
    assert.equal(out.record.cost, out.totalCost);
    assert.equal(out.record.baseCost, 48);
    assert.equal(out.record.widgetCostPoints, out.widgetCostPoints);
    assert.equal(
      out.record.stages?.find((s) => s.stage.includes("위젯"))?.cost,
      out.widgetCostPoints
    );
  });
});
