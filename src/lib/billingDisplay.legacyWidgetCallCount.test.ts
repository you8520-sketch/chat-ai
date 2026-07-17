import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBillingReceipt,
  formatBillingReceiptText,
  resolveStoredWidgetExtractCallCount,
} from "./billingDisplay";
import { buildStatusWidgetExtractReceipt } from "@/lib/statusWidget/receiptUsage";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";

const receipt = buildBillingReceipt({
  cost: 48,
  modelLabel: "Claude Opus",
  apiInputTokens: 10000,
  apiOutputTokens: 1000,
})!;

function formatWithWidgetExtract(
  statusWidgetExtract: NonNullable<
    Parameters<typeof formatBillingReceiptText>[1]
  >["statusWidgetExtract"]
) {
  return formatBillingReceiptText(receipt, {
    apiRawCostKrw: 40,
    mainApiRawCostKrw: 33,
    statusWidgetExtract,
  });
}

describe("legacy statusWidgetExtract callCount display", () => {
  it("omits call-count phrase when stored receipt has no callCount", () => {
    const text = formatWithWidgetExtract({
      model: OPENROUTER_GEMINI_25_FLASH_MODEL,
      modelLabel: "Google Gemini 2.5 Flash (상태창 추출)",
      input: 4252,
      output: 120,
      apiRawCostKrw: 7,
    });
    assert.doesNotMatch(text, /NaN/);
    assert.doesNotMatch(text, /\d+회/);
    assert.doesNotMatch(text, / · .*회/);
    assert.match(text, /위젯 API 원가 \(Google Gemini 2\.5 Flash\):/);
    assert.match(text, /4,252 \/ 120 tokens/);
    assert.match(text, /~7원/);
    assert.match(text, /메인 RP API 원가: ~33원/);
  });

  it("shows 1회 / 2회 / 4회 for valid callCount", () => {
    for (const callCount of [1, 2, 4] as const) {
      const text = formatWithWidgetExtract({
        model: OPENROUTER_GEMINI_25_FLASH_MODEL,
        modelLabel: "Google Gemini 2.5 Flash (상태창 추출)",
        input: 1000,
        output: 50,
        apiRawCostKrw: 2,
        callCount,
      });
      assert.match(text, new RegExp(`${callCount}회`));
      assert.doesNotMatch(text, /NaN/);
    }
  });

  it("omits call-count phrase for NaN / 0 / -1 / string", () => {
    const invalids: unknown[] = [Number.NaN, 0, -1, "2"];
    for (const callCount of invalids) {
      assert.equal(resolveStoredWidgetExtractCallCount(callCount), null);
      const text = formatWithWidgetExtract({
        model: OPENROUTER_GEMINI_25_FLASH_MODEL,
        modelLabel: "Google Gemini 2.5 Flash (상태창 추출)",
        input: 1000,
        output: 50,
        apiRawCostKrw: 2,
        callCount: callCount as number,
      });
      assert.doesNotMatch(text, /NaN/);
      assert.doesNotMatch(text, /\d+회/);
      assert.match(text, /위젯 API 원가 \(Google Gemini 2\.5 Flash\):/);
    }
  });

  it("buildStatusWidgetExtractReceipt always stores a required callCount", () => {
    const built = buildStatusWidgetExtractReceipt(
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      resolveBillingExchangeRateSnapshot(),
      { modelId: OPENROUTER_GEMINI_25_FLASH_MODEL, callCount: 2 }
    );
    assert.equal(built.callCount, 2);
    assert.equal(typeof built.callCount, "number");
    assert.ok("callCount" in built);
  });
});
