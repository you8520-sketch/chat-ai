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
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import { computeOpenRouterTurnCost } from "@/lib/points";
import {
  estimateModelTurnPoints,
  MODEL_PICKER_DEFAULT_INPUT_TOKENS,
  MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS,
  modelPickerOptionLabel,
  resolveAimOutputTokens,
  resolveModelPickerInputTokens,
  resolveModelPickerOutputTokens,
} from "@/lib/modelTurnCostEstimate";

describe("modelTurnCostEstimate", () => {
  const models = [
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    OPENROUTER_KIMI_K3_MODEL,
    OPENROUTER_MUSE_SPARK_11_MODEL,
    OPENROUTER_GEMINI_25_PRO_MODEL,
    OPENROUTER_QWEN_37_MAX_MODEL,
    OPENROUTER_GEMINI_31_PRO_MODEL,
  ];

  it("matches points.ts token-floor for selectable models (8k in / fixed out)", () => {
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

  it("cold-start default input is below surcharge threshold", () => {
    assert.ok(MODEL_PICKER_DEFAULT_INPUT_TOKENS < 10_000);
    assert.equal(
      resolveModelPickerInputTokens({ recentUsages: [] }),
      MODEL_PICKER_DEFAULT_INPUT_TOKENS
    );
  });

  it("resolveAimOutputTokens tracks target response chars", () => {
    const aim = resolveAimOutputTokens(DEFAULT_TARGET_RESPONSE_CHARS);
    assert.equal(aim, Math.ceil(DEFAULT_TARGET_RESPONSE_CHARS * 0.9));
    assert.ok(aim > MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS);
  });

  it("new room with no receipts uses cold-start output (not full aim)", () => {
    const out = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      targetResponseChars: 3200,
      recentUsages: [],
    });
    assert.equal(out, MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS);
    assert.ok(out < resolveAimOutputTokens(3200));
  });

  it("resolveModelPickerOutputTokens uses shared-room median and floors at aim", () => {
    const aim = resolveAimOutputTokens(3200);
    const out = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      targetResponseChars: 3200,
      recentUsages: [
        {
          selectedAI: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
          apiContentOutputTokens: 2000,
        },
        {
          selectedAI: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
          apiContentOutputTokens: 4000,
        },
        {
          selectedAI: OPENROUTER_MUSE_SPARK_11_MODEL,
          apiContentOutputTokens: 9999,
        },
      ],
    });
    // shared median of 2000,4000,9999 = 4000; max(aim≈2880, 4000) = 4000
    assert.equal(out, Math.max(aim, 4000));
  });

  it("Muse and Gemini show the same cold-start points at equal rates", () => {
    const input = MODEL_PICKER_DEFAULT_INPUT_TOKENS;
    const muse = modelPickerOptionLabel({
      displayName: "Muse Spark 1.1",
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      inputTokens: input,
      targetResponseChars: 3200,
      recentUsages: [],
    });
    const gem = modelPickerOptionLabel({
      displayName: "Gemini 2.5 Pro",
      modelId: OPENROUTER_GEMINI_25_PRO_MODEL,
      inputTokens: input,
      targetResponseChars: 3200,
      recentUsages: [],
    });
    const musePts = muse.match(/예상 ([\d,]+)P$/)?.[1];
    const gemPts = gem.match(/예상 ([\d,]+)P$/)?.[1];
    assert.equal(musePts, gemPts);
    const expected = estimateModelTurnPoints({
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      inputTokens: input,
      outputTokens: MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS,
    });
    assert.equal(musePts, expected.toLocaleString("ko-KR"));
    // Cold-start must be well below legacy full-aim ~173P
    assert.ok(expected < 120);
  });

  it("formats option label with cold-start points when no samples", () => {
    const label = modelPickerOptionLabel({
      displayName: "Muse Spark 1.1",
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      inputTokens: MODEL_PICKER_DEFAULT_INPUT_TOKENS,
      targetResponseChars: 3200,
      recentUsages: [],
    });
    assert.match(label, /^Muse Spark 1\.1 예상 [\d,]+P$/);
    const expected = estimateModelTurnPoints({
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      inputTokens: MODEL_PICKER_DEFAULT_INPUT_TOKENS,
      outputTokens: MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS,
    });
    assert.ok(label.includes(expected.toLocaleString("ko-KR")));
    assert.doesNotMatch(label, /토큰|입력|출력|할증/);
  });
});
