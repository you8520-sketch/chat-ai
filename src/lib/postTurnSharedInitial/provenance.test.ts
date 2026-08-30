import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeUsageForPublicReceipt } from "@/lib/billingReceiptAccess";
import {
  applyStatusWidgetPlatformFundedExtract,
  buildStatusWidgetExtractReceipt,
} from "@/lib/statusWidget/receiptUsage";
import type { Usage } from "@/lib/chatUsage";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";

describe("T11/T12 shared admin provenance", () => {
  it("T11 shared purpose survives to persisted admin-shaped Usage", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const widgetUsage = {
      inputTokens: 4200,
      outputTokens: 900,
      estimated: false,
      upstreamCostUsd: 0.004,
    };
    const sharedMeta = {
      modelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      callCount: 1,
      postTurnSharedInitial: true,
    };
    const receipt = buildStatusWidgetExtractReceipt(widgetUsage, exchangeRate, sharedMeta);
    assert.equal(receipt.callCount, 1);
    assert.match(receipt.modelLabel, /공유 초기/);
    assert.doesNotMatch(receipt.modelLabel, /\(상태창 추출\)$/);

    const mainUsage: Usage = {
      input: 10000,
      output: 1000,
      model: "deepseek/deepseek-v4-pro",
      modelLabel: "DeepSeek V4 Pro",
      provider: "openrouter",
      route: "nsfw",
      cost: 60,
      baseCost: 60,
      breakdown: [],
      apiInputTokens: 12000,
      apiOutputTokens: 1500,
      apiRawCostKrw: 45,
      mainApiRawCostKrw: 45,
      apiCallCount: 1,
    };
    const merged = applyStatusWidgetPlatformFundedExtract(
      mainUsage,
      widgetUsage,
      exchangeRate,
      60,
      sharedMeta
    ).record;
    assert.equal(merged.statusWidgetExtract?.postTurnSharedInitial, true);
    assert.equal(merged.statusWidgetExtract?.callCount, 1);
    assert.equal(merged.apiCallCount, 2);
    assert.ok((merged.apiRawCostKrw ?? 0) > 45);
    assert.match(merged.stages?.at(-1)?.stage ?? "", /공유 초기/);
  });

  it("T12 pure widget provenance remains pure widget", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const widgetMeta = { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 1 };
    const receipt = buildStatusWidgetExtractReceipt(
      { inputTokens: 1000, outputTokens: 100, estimated: false },
      exchangeRate,
      widgetMeta
    );
    assert.match(receipt.modelLabel, /상태창 추출/);
    assert.doesNotMatch(receipt.modelLabel, /공유 초기/);

    const merged = applyStatusWidgetPlatformFundedExtract(
      {
        input: 1,
        output: 1,
        model: "m",
        modelLabel: "M",
        provider: "openrouter",
        route: "nsfw",
        cost: 60,
        baseCost: 60,
        breakdown: [],
        apiCallCount: 1,
      },
      { inputTokens: 1000, outputTokens: 100, estimated: false },
      exchangeRate,
      60,
      widgetMeta
    ).record;
    assert.equal(merged.statusWidgetExtract?.postTurnSharedInitial, undefined);
    assert.match(merged.stages?.at(-1)?.stage ?? "", /상태창 추출/);
  });

  it("public receipt strips internal provider economics", () => {
    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const merged = applyStatusWidgetPlatformFundedExtract(
      {
        input: 1,
        output: 1,
        model: "m",
        modelLabel: "M",
        provider: "openrouter",
        route: "nsfw",
        cost: 60,
        baseCost: 60,
        breakdown: [],
        apiCallCount: 1,
      },
      { inputTokens: 1000, outputTokens: 100, estimated: false, upstreamCostUsd: 0.002 },
      exchangeRate,
      60,
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 1, postTurnSharedInitial: true }
    ).record;
    const pub = sanitizeUsageForPublicReceipt(merged);
    assert.equal(pub.statusWidgetExtract, undefined);
    assert.equal(pub.statusWidgetExtractDiagnostics, undefined);
  });
});
