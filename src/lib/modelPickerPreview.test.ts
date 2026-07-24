import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "@/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import { computeOpenRouterTurnCost } from "@/lib/points";
import {
  buildModelPickerPreview,
  collectModelOutputSamples,
  computePreviewTurnPoints,
  formatModelPickerCostLabelFromPreview,
  previewBillableOutputTokens,
  resolveAimOutputTokens,
  resolveModelPickerBaseInputTokens,
  resolveModelPickerOutputTokens,
  type ModelPickerMessageSample,
} from "@/lib/modelPickerPreview";

const ACTIVE = [
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
] as const;

function assistantUsage(
  modelId: string,
  out: number,
  extra: Record<string, unknown> = {}
): ModelPickerMessageSample {
  return {
    role: "assistant",
    model: modelId,
    usage: {
      selectedAI: modelId,
      model: modelId,
      apiOutputTokens: out,
      apiContentOutputTokens: out,
      ...extra,
    },
  };
}

describe("modelPickerPreview V2", () => {
  it("covers all four active models", () => {
    const preview = buildModelPickerPreview({ messages: [], modelIds: [...ACTIVE] });
    assert.equal(preview.models.length, 4);
    for (const id of ACTIVE) {
      const row = preview.models.find((m) => m.modelId === id);
      assert.ok(row, id);
      assert.equal(row!.supported, true);
      assert.ok(row!.estimatedPoints != null && row!.estimatedPoints >= 5);
    }
  });

  it("removes aim floor — median 1800 stays 1800 not 2880", () => {
    const { tokens } = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      messages: [
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1700),
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1800),
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1900),
      ],
    });
    assert.equal(tokens, 1800);
    assert.notEqual(tokens, resolveAimOutputTokens(3200));
  });

  it("isolates cross-model samples — DeepSeek not polluted by Muse 8000", () => {
    const messages = [
      assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 2000),
      assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 2200),
      assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 2400),
      assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 8000),
    ];
    const ds = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      messages,
    });
    assert.equal(ds.tokens, 2200);
    const muse = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      messages: [
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 7900),
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 8000),
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 8100),
      ],
    });
    assert.equal(muse.tokens, 8000);
  });

  it("uses active variant usage for regen/variant", () => {
    const messages: ModelPickerMessageSample[] = [
      {
        role: "assistant",
        model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        usage: {
          selectedAI: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
          apiOutputTokens: 999,
        },
        variants: [
          { usage: { selectedAI: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, apiOutputTokens: 999 } },
          { usage: { selectedAI: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, apiOutputTokens: 2100 } },
        ],
        activeVariant: 1,
      },
    ];
    const samples = collectModelOutputSamples({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      messages,
    });
    assert.deepEqual(samples, [2100]);
  });

  it("prefers assembled snapshot over api input", () => {
    const resolved = resolveModelPickerBaseInputTokens({
      assembledSnapshotTokens: 11_200,
      messages: [
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 2000, { apiInputTokens: 9200 }),
      ],
    });
    assert.equal(resolved.tokens, 11_200);
    assert.equal(resolved.basis, "assembled_snapshot");
  });

  it("applies large-context input surcharge via server billing parity", () => {
    const input = 12_500;
    const output = 1800;
    for (const modelId of ACTIVE) {
      const preview = computePreviewTurnPoints({ modelId, inputTokens: input, outputTokens: output });
      const billed = computeOpenRouterTurnCost(input, output, modelId);
      assert.equal(preview, billed, modelId);
    }
  });

  it("uses each model's assembled input snapshot with billing parity", () => {
    const deepSeekInput = 22_000;
    const hy3Input = 15_000;
    const preview = buildModelPickerPreview({
      messages: [],
      modelIds: [
        OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        OPENROUTER_TENCENT_HY3_MODEL,
      ],
      assembledSnapshotTokensByModel: {
        [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]: deepSeekInput,
        [OPENROUTER_TENCENT_HY3_MODEL]: hy3Input,
      },
    });
    const deepSeek = preview.models.find(
      (row) => row.modelId === OPENROUTER_DEEPSEEK_V4_PRO_MODEL
    )!;
    const hy3 = preview.models.find(
      (row) => row.modelId === OPENROUTER_TENCENT_HY3_MODEL
    )!;

    assert.equal(deepSeek.estimatedInputTokens, deepSeekInput);
    assert.equal(hy3.estimatedInputTokens, hy3Input);
    assert.equal(
      deepSeek.estimatedPoints,
      computeOpenRouterTurnCost(
        deepSeekInput,
        deepSeek.estimatedOutputTokens,
        deepSeek.modelId
      )
    );
    assert.equal(
      hy3.estimatedPoints,
      computeOpenRouterTurnCost(
        hy3Input,
        hy3.estimatedOutputTokens,
        hy3.modelId
      )
    );
  });

  it("adds the same draft-token estimate to every model-specific snapshot", () => {
    const draftInput = "오늘은 긴 이야기를 시작해 보자.";
    const preview = buildModelPickerPreview({
      messages: [],
      modelIds: [
        OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        OPENROUTER_TENCENT_HY3_MODEL,
      ],
      assembledSnapshotTokensByModel: {
        [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]: 20_000,
        [OPENROUTER_TENCENT_HY3_MODEL]: 10_000,
      },
      draftInput,
    });
    const expectedDraftTokens = Math.max(1, Math.ceil(draftInput.length * 0.9));

    assert.equal(preview.models[0]?.estimatedInputTokens, 20_000 + expectedDraftTokens);
    assert.equal(preview.models[1]?.estimatedInputTokens, 10_000 + expectedDraftTokens);
  });

  it("Muse preview uses visible content output (reasoning excluded)", () => {
    const museBillable = previewBillableOutputTokens(OPENROUTER_MUSE_SPARK_11_MODEL, {
      apiOutputTokens: 2500,
      apiContentOutputTokens: 1700,
      apiReasoningOutputTokens: 800,
    });
    assert.equal(museBillable, 1700);
  });

  it("Gemini preview uses content output (reasoning excluded)", () => {
    const gemBillable = previewBillableOutputTokens(OPENROUTER_GEMINI_36_FLASH_MODEL, {
      apiOutputTokens: 2500,
      apiContentOutputTokens: 1700,
      apiReasoningOutputTokens: 800,
    });
    assert.equal(gemBillable, 1700);
  });

  it("unsupported model shows no false 5P label", () => {
    assert.equal(formatModelPickerCostLabelFromPreview(null), "예상 —");
    const preview = buildModelPickerPreview({
      messages: [],
      modelIds: ["unknown/model"],
    });
    assert.equal(preview.models[0]?.estimatedPoints ?? null, null);
  });

  it("does not assume input always increases — lower assembled snapshot wins", () => {
    const afterTrim = resolveModelPickerBaseInputTokens({
      assembledSnapshotTokens: 8000,
      messages: [
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 2000, { apiInputTokens: 11_000 }),
      ],
    });
    assert.equal(afterTrim.tokens, 8000);
  });

  it("cold-start uses per-model baselines (not shared 1500)", () => {
    const muse = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      messages: [],
    });
    const gem = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
      messages: [],
    });
    assert.notEqual(muse.tokens, gem.tokens);
  });
});
