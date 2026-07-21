import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { computeOpenRouterTurnCost } from "@/lib/points";
import {
  estimateModelTurnPoints,
  MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS,
  modelPickerOptionLabel,
  resolveModelPickerInputTokens,
} from "@/lib/modelTurnCostEstimate";

describe("modelTurnCostEstimate", () => {
  const models = [
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    OPENROUTER_KIMI_K3_MODEL,
    OPENROUTER_MUSE_SPARK_11_MODEL,
    OPENROUTER_GEMINI_25_PRO_MODEL,
    // residual retired slugs — still billed if receipt carries them
    OPENROUTER_QWEN_37_MAX_MODEL,
    OPENROUTER_GEMINI_31_PRO_MODEL,
  ];

  it("matches points.ts token-floor for selectable models (8k in / 1500 out)", () => {
    const input = 8000;
    const output = MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS;
    for (const modelId of models) {
      const preview = estimateModelTurnPoints({ modelId, inputTokens: input, outputTokens: output });
      const billed = computeOpenRouterTurnCost(input, output, modelId);
      assert.equal(preview, billed, modelId);
    }
  });

  it("applies 10k+ input surcharge like points.ts", () => {
    const input = 12_500;
    const output = MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS;
    for (const modelId of models) {
      const preview = estimateModelTurnPoints({ modelId, inputTokens: input, outputTokens: output });
      const billed = computeOpenRouterTurnCost(input, output, modelId);
      assert.equal(preview, billed, modelId);
    }
  });

  it("resolveModelPickerInputTokens prefers apiInputTokens and adds draft", () => {
    const n = resolveModelPickerInputTokens({
      recentUsages: [{ input: 1000 }, { apiInputTokens: 9200, input: 9000 }],
      draftInput: "안녕", // length 2 → estimateTokens ceil(1.8)=2
    });
    assert.equal(n, 9200 + 2);
  });

  it("formats option label with next-turn points only", () => {
    const label = modelPickerOptionLabel({
      displayName: "Muse Spark 1.1",
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      inputTokens: 8000,
    });
    assert.match(label, /^Muse Spark 1\.1 예상 \d+P$/);
    assert.doesNotMatch(label, /토큰|입력|출력|할증/);
  });
});
