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
  capOutputSanityUpper,
  collectModelOutputSamples,
  computePreviewTurnPoints,
  formatModelPickerCostLabelFromPreview,
  formatModelPickerCostLabelRange,
  MODEL_PICKER_MEASURED_COLD_BASELINES,
  previewBillableOutputTokens,
  previewCostOutputTokens,
  resolveAimOutputTokens,
  resolveAlignedPreviewInputTokens,
  resolveColdOutputBaseline,
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
      assert.ok(row!.estimatedPointsLow != null);
      assert.ok(row!.estimatedPointsHigh != null);
    }
  });

  it("uses p40+recent blend under sanity cap — median 1800 stays ~1800 not aim", () => {
    const { tokens } = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      messages: [
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1700),
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1800),
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1900),
      ],
    });
    // newest=1900, p40=1800 → round(1800*0.7 + 1900*0.3)=1830
    assert.equal(tokens, 1830);
    assert.notEqual(tokens, resolveAimOutputTokens(3200));
  });

  it("caps extreme sample medians to aim×1.15", () => {
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
    // newest=2400 among DS samples [2400,2200,2000] wait order newest-first: 2400,2200,2000
    // Actually messages scanned from end: Muse 8000 skipped, then 2400,2200,2000
    // p40 of [2400,2200,2000] sorted [2000,2200,2400], idx floor(3*0.4)=1 → 2200
    // blend 2200*0.7+2400*0.3=2260
    assert.equal(ds.tokens, 2260);
    const muse = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      messages: [
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 7900),
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 8000),
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 8100),
      ],
    });
    const upper = capOutputSanityUpper(8000, DEFAULT_TARGET_RESPONSE_CHARS);
    assert.equal(muse.tokens, upper);
    assert.ok(muse.tokens < 8000);
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

  it("prefers assembled snapshot over api input in base resolver", () => {
    const resolved = resolveModelPickerBaseInputTokens({
      assembledSnapshotTokens: 11_200,
      messages: [
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 2000, { apiInputTokens: 9200 }),
      ],
    });
    assert.equal(resolved.tokens, 11_200);
    assert.equal(resolved.basis, "assembled_snapshot");
  });

  it("caps assembled input by last receipt api input", () => {
    const messages = [
      assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 2000, { apiInputTokens: 9_200 }),
    ];
    const aligned = resolveAlignedPreviewInputTokens({
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      assembledTokens: 14_000,
      messages,
      draftTokens: 10,
    });
    assert.equal(aligned.tokens, 9_210);
    assert.equal(aligned.basis, "assembled_capped_by_api");
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

  it("uses each model's assembled input snapshot with billing parity when no receipt", () => {
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

  it("cost preview uses capped total completion tokens (content + thinking)", () => {
    const usage = {
      apiOutputTokens: 2500,
      apiContentOutputTokens: 1700,
      apiReasoningOutputTokens: 800,
    };
    assert.equal(
      previewCostOutputTokens(OPENROUTER_MUSE_SPARK_11_MODEL, usage),
      2500
    );
    const input = 20_000;
    const preview = buildModelPickerPreview({
      messages: [
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 2500, {
          apiContentOutputTokens: 1700,
          apiReasoningOutputTokens: 800,
        }),
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 2400, {
          apiContentOutputTokens: 1600,
          apiReasoningOutputTokens: 800,
        }),
        assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 2600, {
          apiContentOutputTokens: 1800,
          apiReasoningOutputTokens: 800,
        }),
      ],
      modelIds: [OPENROUTER_MUSE_SPARK_11_MODEL],
      assembledSnapshotTokensByModel: {
        [OPENROUTER_MUSE_SPARK_11_MODEL]: input,
      },
    });
    const row = preview.models[0]!;
    // newest=2600, p40 of [2600,2400,2500] sorted [2400,2500,2600] idx1=2500
    // blend 2500*0.7+2600*0.3=2530
    assert.equal(row.estimatedOutputTokens, 2530);
    assert.equal(
      row.estimatedPoints,
      computeOpenRouterTurnCost(input, 2530, OPENROUTER_MUSE_SPARK_11_MODEL)
    );
    assert.ok((row.estimatedPointsHigh ?? 0) >= (row.estimatedPointsLow ?? 0));
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

  it("formats a point range label", () => {
    assert.equal(formatModelPickerCostLabelRange(48, 72), "약 48–72P");
    assert.equal(formatModelPickerCostLabelFromPreview(60, 48, 72), "약 48–72P");
    assert.equal(formatModelPickerCostLabelFromPreview(60, 60, 60), "약 60P");
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

  it("cold-start uses calibrated per-model baselines", () => {
    const muse = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
      messages: [],
    });
    const gem = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_GEMINI_36_FLASH_MODEL,
      messages: [],
    });
    assert.equal(muse.tokens, MODEL_PICKER_MEASURED_COLD_BASELINES[OPENROUTER_MUSE_SPARK_11_MODEL]);
    assert.equal(gem.tokens, MODEL_PICKER_MEASURED_COLD_BASELINES[OPENROUTER_GEMINI_36_FLASH_MODEL]);
    assert.notEqual(muse.tokens, gem.tokens);
    assert.ok(resolveColdOutputBaseline(OPENROUTER_MUSE_SPARK_11_MODEL) < 2000);
  });
});
