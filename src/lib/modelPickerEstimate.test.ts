import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  selectedAILabel,
} from "@/lib/chatModels";
import {
  acceptPickerEstimateResponse,
  formatPickerEstimateSuffix,
  modelPickerConfidenceFromEstimateRows,
  parseModelPickerEstimatePresentation,
  parseModelPickerEstimates,
  PICKER_ESTIMATE_VARIANCE_NOTE,
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

  it("shows anchored points, initial estimates, and unavailable prices differently", () => {
    const id = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
    const name = selectedAILabel(id);
    assert.equal(formatPickerEstimateSuffix(162, "anchored"), " · 약 162P");
    assert.equal(formatPickerEstimateSuffix(388, "initial"), " · 약 388P · 초기 추정");
    assert.equal(formatPickerEstimateSuffix(null, "unavailable"), " · 예상 —");
    assert.equal(formatPickerEstimateSuffix(388, "unavailable"), " · 예상 —");
    assert.equal(
      selectedAIOptionLabel(id, {}, { [id]: 162 }, { [id]: "anchored" }),
      `${name} · 약 162P`
    );
    assert.equal(
      selectedAIOptionLabel(id, {}, { [id]: 388 }, { [id]: "initial" }),
      `${name} · 약 388P · 초기 추정`
    );
    assert.equal(
      selectedAIOptionLabel(id, {}, {}, { [id]: "unavailable" }),
      `${name} · 예상 —`
    );
    assert.match(PICKER_ESTIMATE_VARIANCE_NOTE, /실제 사용량/);
  });

  it("reads forecastSource from the existing models payload and ignores a late response", () => {
    const flash = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
    const sol = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
    const parsed = parseModelPickerEstimatePresentation({
      estimates: { [flash]: 388, [sol]: 162 },
      models: {
        [flash]: { forecastSource: "uncalibrated_assembled", displayPoints: 388 },
        [sol]: { forecastSource: "same_model_actual_anchored_delta", displayPoints: 162 },
      },
    });
    assert.equal(parsed?.confidence[flash], "initial");
    assert.equal(parsed?.confidence[sol], "anchored");
    assert.equal(parsed?.points[sol], 162);
    const fromRows = modelPickerConfidenceFromEstimateRows({
      [sol]: { forecastSource: "same_model_actual_anchored_delta", displayPoints: 162 },
      [flash]: { forecastSource: "uncalibrated_assembled", displayPoints: 388 },
    });
    assert.equal(fromRows[sol], "anchored");
    assert.equal(fromRows[flash], "initial");
    const late = acceptPickerEstimateResponse({
      requestId: 1,
      latestRequestId: 2,
      presentation: parsed,
    });
    assert.equal(late, null);
    assert.equal(
      acceptPickerEstimateResponse({
        requestId: 2,
        latestRequestId: 2,
        presentation: parsed,
      }),
      parsed
    );
  });
});
