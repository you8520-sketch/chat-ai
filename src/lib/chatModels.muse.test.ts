import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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

describe("Muse Spark 1.1 on OpenRouter", () => {
  it("is the default recommended selectable option", () => {
    assert.equal(DEFAULT_SELECTED_AI, OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(SELECTED_AI_OPTIONS[0]?.id, OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === OPENROUTER_MUSE_SPARK_11_MODEL));
    assert.ok(isValidSelectedAI(OPENROUTER_MUSE_SPARK_11_MODEL));
    assert.equal(selectedAILabel(OPENROUTER_MUSE_SPARK_11_MODEL), "Muse Spark 1.1");
    const muse = SELECTED_AI_OPTIONS.find((o) => o.id === OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(muse?.badge, "기본 추천");
    assert.equal(muse?.recommended, true);
  });

  it("maps legacy muse slugs to Spark 1.1", () => {
    assert.equal(resolveSelectedAI("muse"), OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(resolveSelectedAI("muse-spark"), OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(resolveSelectedAI("muse-spark-1.1"), OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(resolveSelectedAI("meta/muse-spark-1.1"), OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(
      resolveOpenRouterModelId(OPENROUTER_MUSE_SPARK_11_MODEL),
      OPENROUTER_MUSE_SPARK_11_MODEL
    );
  });

  it("uses Meta Muse Spark list pricing", () => {
    assert.ok(isMuseModel(OPENROUTER_MUSE_SPARK_11_MODEL));
    const rates = resolveOpenRouterModelRates(OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(rates.inputUsdPerM, 1.25);
    assert.equal(rates.outputUsdPerM, 4.25);
    assert.equal(rates.cacheReadUsdPerM, 0.15);
  });
});
