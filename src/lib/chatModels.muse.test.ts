import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  DEFAULT_SELECTED_AI,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  SELECTED_AI_OPTIONS,
  isMuseModel,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("retired Muse Spark 1.1 compatibility", () => {
  it("is removed from selection and the default model", () => {
    assert.equal(DEFAULT_SELECTED_AI, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_MUSE_SPARK_11_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_MUSE_SPARK_11_MODEL), false);
    assert.equal(selectedAILabel(OPENROUTER_MUSE_SPARK_11_MODEL), "Muse Spark 1.1");
  });

  it("maps stored Muse selections to DeepSeek and keeps OpenRouter fallback valid", () => {
    assert.equal(resolveSelectedAI("muse"), CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(resolveSelectedAI("muse-spark"), CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(resolveSelectedAI("muse-spark-1.1"), CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(
      resolveSelectedAI("meta/muse-spark-1.1"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_MUSE_SPARK_11_MODEL),
      "google/gemini-3.6-flash"
    );
  });

  it("keeps Meta Muse Spark rates for historical receipts", () => {
    assert.ok(isMuseModel(OPENROUTER_MUSE_SPARK_11_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(rates.inputUsdPerM, 1.25);
    assert.equal(rates.outputUsdPerM, 4.25);
    assert.equal(rates.cacheReadUsdPerM, 0.15);
  });
});
