import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  DEFAULT_SELECTED_AI,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_MUSE_SPARK_12_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isMuseDiagnosticSelectable,
  isMuseModel,
  isUserApiSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

describe("Muse Spark 1.2 diagnostic registry + 1.1 receipt compatibility", () => {
  it("registers Muse Spark 1.2 but keeps it out of the public picker", () => {
    assert.equal(DEFAULT_SELECTED_AI, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_MUSE_SPARK_12_MODEL));
    assert.ok(!USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === OPENROUTER_MUSE_SPARK_12_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_MUSE_SPARK_12_MODEL), true);
    assert.equal(selectedAILabel(OPENROUTER_MUSE_SPARK_12_MODEL), "Muse Spark 1.2");
    assert.equal(isUserApiSelectableAI(OPENROUTER_MUSE_SPARK_12_MODEL), isMuseDiagnosticSelectable());
  });

  it("keeps Muse Spark 1.1 as non-selectable receipt slug", () => {
    assert.ok(!SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_MUSE_SPARK_11_MODEL));
    assert.equal(isValidSelectedAI(OPENROUTER_MUSE_SPARK_11_MODEL), false);
    assert.equal(selectedAILabel(OPENROUTER_MUSE_SPARK_11_MODEL), "Muse Spark 1.1");
  });

  it("resolves Muse aliases to Muse Spark 1.2 for request routing", () => {
    assert.equal(resolveSelectedAI("muse"), OPENROUTER_MUSE_SPARK_12_MODEL);
    assert.equal(resolveSelectedAI("muse-spark"), OPENROUTER_MUSE_SPARK_12_MODEL);
    assert.equal(resolveSelectedAI("muse-spark-1.1"), OPENROUTER_MUSE_SPARK_12_MODEL);
    assert.equal(resolveSelectedAI("meta/muse-spark-1.1"), OPENROUTER_MUSE_SPARK_12_MODEL);
    assert.equal(resolveSelectedAI(OPENROUTER_MUSE_SPARK_12_MODEL), OPENROUTER_MUSE_SPARK_12_MODEL);
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_MUSE_SPARK_11_MODEL),
      OPENROUTER_MUSE_SPARK_12_MODEL
    );
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_MUSE_SPARK_12_MODEL),
      OPENROUTER_MUSE_SPARK_12_MODEL
    );
  });

  it("keeps Meta Muse Spark rates for receipts (1.1 and 1.2)", () => {
    assert.ok(isMuseModel(OPENROUTER_MUSE_SPARK_11_MODEL));
    assert.ok(isMuseModel(OPENROUTER_MUSE_SPARK_12_MODEL));
    for (const id of [OPENROUTER_MUSE_SPARK_11_MODEL, OPENROUTER_MUSE_SPARK_12_MODEL]) {
      const rates = resolveOpenRouterModelRates(id);
      assert.equal(rates.inputUsdPerM, 1.25);
      assert.equal(rates.outputUsdPerM, 4.25);
      assert.equal(rates.cacheReadUsdPerM, 0.15);
    }
  });

  it("allows Muse API selection only when diagnostic env is set", () => {
    const prev = process.env.MUSE_DIAGNOSTIC_SELECTABLE;
    try {
      delete process.env.MUSE_DIAGNOSTIC_SELECTABLE;
      assert.equal(isUserApiSelectableAI(OPENROUTER_MUSE_SPARK_12_MODEL), false);
      process.env.MUSE_DIAGNOSTIC_SELECTABLE = "1";
      assert.equal(isUserApiSelectableAI(OPENROUTER_MUSE_SPARK_12_MODEL), true);
      assert.ok(!USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === OPENROUTER_MUSE_SPARK_12_MODEL));
    } finally {
      if (prev === undefined) delete process.env.MUSE_DIAGNOSTIC_SELECTABLE;
      else process.env.MUSE_DIAGNOSTIC_SELECTABLE = prev;
    }
  });
});
