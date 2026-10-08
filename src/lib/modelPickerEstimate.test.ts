import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  selectedAILabel,
} from "@/lib/chatModels";
import {
  formatPickerEstimateSuffix,
  parseModelPickerEstimates,
  selectedAIOptionLabel,
} from "@/lib/modelPickerEstimate";
import type { SitePromotionClientView } from "@/lib/sitePromotionClientView";

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
    assert.equal(selectedAIOptionLabel(id, {}, {}), name);
    assert.equal(formatPickerEstimateSuffix(null), "");
    assert.equal(formatPickerEstimateSuffix(undefined), "");
    assert.equal(formatPickerEstimateSuffix(31), " · 약 31P");
  });
});
