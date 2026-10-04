import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  MAIN_RP_MODEL_IDS,
  selectedAILabel,
} from "@/lib/chatModels";
import {
  formatPickerEstimateSuffix,
  parseModelPickerEstimates,
  selectedAIOptionLabel,
} from "@/lib/modelPickerBaselineEstimate";
import { computePublishedStandardPreviewDisplayPoints } from "@/lib/publishedUserCharge";
import type { SitePromotionClientView } from "@/lib/sitePromotionClientView";

const FIXED_INPUT = 20_000;
const FIXED_OUTPUT = 1_500;
const FX = 1560.6;

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

function fixedBaseline(modelId: string): number | null {
  return computePublishedStandardPreviewDisplayPoints({
    modelId,
    promptTokens: FIXED_INPUT,
    outputTokens: FIXED_OUTPUT,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    effectiveKrwPerUsd: FX,
  });
}

describe("PRE-FIX fixed 20k/1500 picker baseline", () => {
  it("is identical across two different room snapshots", () => {
    const roomA = Object.fromEntries(
      MAIN_RP_MODEL_IDS.map((id) => [id, fixedBaseline(id)])
    );
    const roomB = Object.fromEntries(
      MAIN_RP_MODEL_IDS.map((id) => [id, fixedBaseline(id)])
    );
    assert.deepEqual(roomA, roomB);
    for (const modelId of MAIN_RP_MODEL_IDS) {
      assert.equal(typeof roomA[modelId], "number", modelId);
      assert.ok((roomA[modelId] ?? 0) > 0, modelId);
    }
  });
});

describe("modelPickerEstimate labels", () => {
  it("parses only positive integer estimates for active Main RP ids", () => {
    const parsed = parseModelPickerEstimates({
      [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 31,
      [CHEAPER_INFERENCE_GPT_61_SOL_MODEL]: 0,
      "gpt-5.6-terra": 99,
      leftover: 12.5,
    });
    assert.deepEqual(parsed, {
      [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 31,
    });
    assert.equal(parseModelPickerEstimates([]), null);
    assert.equal(parseModelPickerEstimates(null), null);
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
    assert.equal(selectedAIOptionLabel(id, {}, { [id]: 0 }), name);
    assert.equal(formatPickerEstimateSuffix(null), "");
    assert.equal(formatPickerEstimateSuffix(31), " · 약 31P");
  });
});
