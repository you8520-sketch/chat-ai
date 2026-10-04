import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  MAIN_RP_MODEL_IDS,
  selectedAILabel,
} from "@/lib/chatModels";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  computeMainRpPickerBaselineEstimates,
  formatPickerBaselineEstimateSuffix,
  parseModelPickerBaselineEstimates,
  selectedAIOptionLabel,
  PICKER_BASELINE_ESTIMATE_INPUT_TOKENS,
  PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS,
} from "@/lib/modelPickerBaselineEstimate";
import {
  computePublishedStandardPreviewDisplayPoints,
  computePublishedStandardPreviewPoints,
  computePublishedUserChargeWithSnapshot,
} from "@/lib/publishedUserCharge";
import type { SitePromotionClientView } from "@/lib/sitePromotionClientView";

const FX_1560: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-10-03",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

function promo(modelId: string, badge: string): SitePromotionClientView {
  return {
    modelId,
    siteDiscountPercent: 10,
    endsAt: "2099-01-01T00:00:00.000Z",
    title: "promo",
    subtitle: "",
    detailLine: "",
    badge,
  };
}

describe("modelPickerBaselineEstimate", () => {
  it("prints a rounded integer P for every active Main RP model at the fixture FX", () => {
    const estimates = computeMainRpPickerBaselineEstimates(FX_1560.effectiveKrwPerUsd);
    assert.deepEqual(Object.keys(estimates).sort(), [...MAIN_RP_MODEL_IDS].sort());
    for (const modelId of MAIN_RP_MODEL_IDS) {
      const points = estimates[modelId];
      assert.equal(typeof points, "number", modelId);
      assert.ok(Number.isSafeInteger(points) && (points ?? 0) > 0, modelId);
      const live = computePublishedUserChargeWithSnapshot({
        modelId,
        usage: normalizeBillableUsage({
          modelId,
          promptTokens: PICKER_BASELINE_ESTIMATE_INPUT_TOKENS,
          outputTokens: PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS,
        }),
        usageCoverage: "complete",
        fxSnapshot: FX_1560,
        adjustment: { kind: "none" },
      });
      assert.equal(live.status, "complete", modelId);
      if (live.status === "complete") {
        assert.equal(points, Math.round(live.snapshot.standardUserChargeKrw), modelId);
        assert.equal(
          computePublishedStandardPreviewPoints({
            modelId,
            promptTokens: PICKER_BASELINE_ESTIMATE_INPUT_TOKENS,
            outputTokens: PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS,
            effectiveKrwPerUsd: FX_1560.effectiveKrwPerUsd,
          }),
          live.snapshot.finalPoints,
          modelId
        );
      }
    }
    assert.equal(estimates[CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL], 219);
  });

  it("rounds 10.2 KRW down for display without changing charge ceil", () => {
    const input = {
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      promptTokens: PICKER_BASELINE_ESTIMATE_INPUT_TOKENS,
      outputTokens: PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS,
      effectiveKrwPerUsd: 102,
    };
    const live = computePublishedUserChargeWithSnapshot({
      modelId: input.modelId,
      usage: normalizeBillableUsage({
        modelId: input.modelId,
        promptTokens: input.promptTokens,
        outputTokens: input.outputTokens,
      }),
      usageCoverage: "complete",
      fxSnapshot: { ...FX_1560, usdToKrw: 100, effectiveKrwPerUsd: 102 },
      adjustment: { kind: "none" },
    });
    assert.equal(live.status, "complete");
    if (live.status === "complete") {
      assert.equal(live.snapshot.standardUserChargeKrw, 10.2);
      assert.equal(live.snapshot.finalPoints, 11);
      assert.equal(computePublishedStandardPreviewPoints(input), 11);
      assert.equal(computePublishedStandardPreviewDisplayPoints(input), 10);
    }
  });

  it("omits invalid FX and never emits 0P", () => {
    assert.deepEqual(computeMainRpPickerBaselineEstimates(0), {});
    assert.deepEqual(computeMainRpPickerBaselineEstimates(-1), {});
    assert.deepEqual(computeMainRpPickerBaselineEstimates(Number.NaN), {});
    assert.equal(
      computePublishedStandardPreviewDisplayPoints({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        promptTokens: PICKER_BASELINE_ESTIMATE_INPUT_TOKENS,
        outputTokens: PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS,
        effectiveKrwPerUsd: 0.01,
      }),
      null
    );
    assert.equal(formatPickerBaselineEstimateSuffix(0), "");
    assert.equal(formatPickerBaselineEstimateSuffix(null), "");
    assert.equal(formatPickerBaselineEstimateSuffix(12.4), "");
    assert.equal(formatPickerBaselineEstimateSuffix(31), " · 약 31P");
  });

  it("parses only positive integer estimates for active Main RP ids", () => {
    const parsed = parseModelPickerBaselineEstimates({
      [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 31,
      [CHEAPER_INFERENCE_GPT_61_SOL_MODEL]: 0,
      "gpt-5.6-terra": 99,
      leftover: 12.5,
    });
    assert.deepEqual(parsed, {
      [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 31,
    });
    assert.equal(parseModelPickerBaselineEstimates([]), null);
    assert.equal(parseModelPickerBaselineEstimates(null), null);
  });

  it("keeps model name and promo badge, then appends the estimate", () => {
    const id = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
    const name = selectedAILabel(id);
    assert.equal(selectedAIOptionLabel(id, {}), name);
    assert.equal(
      selectedAIOptionLabel(id, { [id]: promo(id, "할인") }),
      `${name} [할인]`
    );
    assert.equal(
      selectedAIOptionLabel(id, {}, { [id]: 31 }),
      `${name} · 약 31P`
    );
    assert.equal(
      selectedAIOptionLabel(id, { [id]: promo(id, "할인") }, { [id]: 31 }),
      `${name} [할인] · 약 31P`
    );
    assert.equal(
      selectedAIOptionLabel(id, {}, { [id]: 0 }),
      name
    );
  });
});
