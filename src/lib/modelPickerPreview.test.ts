import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "@/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import {
  computeCheaperInferenceMarketPreviewCost,
  computeOpenRouterTurnCost,
} from "@/lib/points";
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

const OPENROUTER_DEEPSEEK_V4_PRO_MODEL =
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

const ACTIVE = [
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
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
  it("hides Claude Opus 5 from the default user picker preview", () => {
    const preview = buildModelPickerPreview({ messages: [] });
    assert.equal(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      false
    );
    assert.ok(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)
    );
    assert.equal(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      false
    );
    assert.ok(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)
    );
    assert.ok(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)
    );
  });

  it("covers all active models", () => {
    const preview = buildModelPickerPreview({ messages: [], modelIds: [...ACTIVE] });
    assert.equal(preview.models.length, 4);
    for (const id of ACTIVE) {
      const row = preview.models.find((m) => m.modelId === id);
      assert.ok(row, id);
      assert.equal(row!.supported, true);
      assert.ok(row!.estimatedPoints != null && row!.estimatedPoints >= 5);
      assert.ok(row!.estimatedPointsLow != null);
      assert.ok(row!.estimatedPointsHigh != null);
      assert.ok(row!.estimatedPointsHigh! > row!.estimatedPointsLow!, id);
    }
  });

  it("uses p30+recent blend under sanity cap — stays below aim", () => {
    const { tokens } = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      messages: [
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1700),
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1800),
        assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 1900),
      ],
    });
    // newest=1900, p30=1700 → round(1700*0.75 + 1900*0.25)=1750
    assert.equal(tokens, 1750);
    assert.notEqual(tokens, resolveAimOutputTokens(3200));
  });

  it("caps extreme sample medians to aim×0.9", () => {
    const messages = [
      assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 2000),
      assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 2200),
      assistantUsage(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 2400),
      assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 8000),
    ];
    const ds = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      messages,
    });
    // newest-first: 2400,2200,2000 → p30=2000 → blend 2000*0.75+2400*0.25=2100
    assert.equal(ds.tokens, 2100);
    const gemini = resolveModelPickerOutputTokens({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      messages: [
        assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 7900),
        assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 8000),
        assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 8100),
      ],
    });
    const upper = capOutputSanityUpper(8000, DEFAULT_TARGET_RESPONSE_CHARS);
    assert.equal(gemini.tokens, upper);
    assert.ok(gemini.tokens < 8000);
    assert.ok(upper <= Math.ceil(resolveAimOutputTokens(DEFAULT_TARGET_RESPONSE_CHARS) * 0.9));
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
        assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 2000, { apiInputTokens: 9200 }),
      ],
    });
    assert.equal(resolved.tokens, 11_200);
    assert.equal(resolved.basis, "assembled_snapshot");
  });

  it("caps assembled input by last receipt api input", () => {
    const messages = [
      assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 2000, { apiInputTokens: 9_200 }),
    ];
    const aligned = resolveAlignedPreviewInputTokens({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
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
      const billed =
        computeCheaperInferenceMarketPreviewCost(input, output, modelId, 0.15) ??
        computeOpenRouterTurnCost(input, output, modelId);
      assert.equal(preview, billed, modelId);
    }
  });

  it("uses each model's assembled input snapshot with billing parity when no receipt", () => {
    const deepSeekInput = 22_000;
    const geminiInput = 15_000;
    const preview = buildModelPickerPreview({
      messages: [],
      modelIds: [
        OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      ],
      assembledSnapshotTokensByModel: {
        [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]: deepSeekInput,
        [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: geminiInput,
      },
    });
    const deepSeek = preview.models.find(
      (row) => row.modelId === OPENROUTER_DEEPSEEK_V4_PRO_MODEL
    )!;
    const gemini = preview.models.find(
      (row) => row.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    )!;

    assert.equal(deepSeek.estimatedInputTokens, deepSeekInput);
    assert.equal(gemini.estimatedInputTokens, geminiInput);
    assert.equal(
      deepSeek.estimatedPoints,
      computeCheaperInferenceMarketPreviewCost(
        deepSeekInput,
        deepSeek.estimatedOutputTokens,
        deepSeek.modelId,
        0.15
      )
    );
    assert.equal(
      gemini.estimatedPoints,
      computeCheaperInferenceMarketPreviewCost(
        geminiInput,
        gemini.estimatedOutputTokens,
        gemini.modelId,
        0.15
      )
    );
  });

  it("adds the same draft-token estimate to every model-specific snapshot", () => {
    const draftInput = "오늘은 긴 이야기를 시작해 보자.";
    const preview = buildModelPickerPreview({
      messages: [],
      modelIds: [
        OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      ],
      assembledSnapshotTokensByModel: {
        [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]: 20_000,
        [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: 10_000,
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
      previewCostOutputTokens(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, usage),
      2500
    );
    const input = 20_000;
    const preview = buildModelPickerPreview({
      messages: [
        assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 2500, {
          apiContentOutputTokens: 1700,
          apiReasoningOutputTokens: 800,
        }),
        assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 2400, {
          apiContentOutputTokens: 1600,
          apiReasoningOutputTokens: 800,
        }),
        assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 2600, {
          apiContentOutputTokens: 1800,
          apiReasoningOutputTokens: 800,
        }),
      ],
      modelIds: [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL],
      assembledSnapshotTokensByModel: {
        [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: input,
      },
    });
    const row = preview.models[0]!;
    // newest=2600, p30 of [2600,2400,2500] sorted [2400,2500,2600] idx0=2400
    // blend 2400*0.75+2600*0.25=2450
    assert.equal(row.estimatedOutputTokens, 2450);
    assert.equal(
      row.estimatedPoints,
      computeCheaperInferenceMarketPreviewCost(
        input,
        2450,
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        0.15
      )
    );
    assert.ok((row.estimatedPointsHigh ?? 0) > (row.estimatedPointsLow ?? 0));
  });

  it("Gemini preview uses content output (reasoning excluded)", () => {
    const gemBillable = previewBillableOutputTokens(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, {
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

  it("hides Terra from picker estimates so receipts do not skew DeepSeek", () => {
    const preview = buildModelPickerPreview({
      messages: [assistantUsage(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, 1800)],
      modelIds: [CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
    });
    const terra = preview.models.find((m) => m.modelId === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
    const deepSeek = preview.models.find((m) => m.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(terra?.supported, false);
    assert.equal(terra?.estimatedPoints, null);
    assert.equal(deepSeek?.supported, true);
  });

  it("retires Muse from active picker estimates while keeping historical parsing", () => {
    const preview = buildModelPickerPreview({
      messages: [assistantUsage(OPENROUTER_MUSE_SPARK_11_MODEL, 1800)],
      modelIds: [OPENROUTER_MUSE_SPARK_11_MODEL],
    });
    assert.equal(preview.models[0]?.supported, false);
    assert.equal(preview.models[0]?.estimatedPoints, null);
  });

  it("formats a point range label", () => {
    assert.equal(formatModelPickerCostLabelRange(48, 72), "약 48–72P");
    assert.equal(formatModelPickerCostLabelFromPreview(60, 48, 72), "약 48–72P");
    assert.equal(formatModelPickerCostLabelFromPreview(60, 60, 60), "약 60P");
  });

  it("always shows a P range for cheap and expensive active models", () => {
    const preview = buildModelPickerPreview({
      messages: [],
      modelIds: [...ACTIVE],
      assembledSnapshotTokensByModel: Object.fromEntries(ACTIVE.map((id) => [id, 12_000])),
    });
    for (const id of ACTIVE) {
      const row = preview.models.find((m) => m.modelId === id)!;
      assert.ok(row.estimatedPointsLow != null && row.estimatedPointsHigh != null, id);
      assert.ok(row.estimatedPointsHigh! > row.estimatedPointsLow!, id);
      const label = formatModelPickerCostLabelFromPreview(
        row.estimatedPoints,
        row.estimatedPointsLow,
        row.estimatedPointsHigh
      );
      assert.match(label, /약 \d[\d,]*–\d[\d,]*P/, `${id}: ${label}`);
    }
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
    const deepSeek = resolveModelPickerOutputTokens({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      messages: [],
    });
    const gem = resolveModelPickerOutputTokens({
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      messages: [],
    });
    assert.equal(
      deepSeek.tokens,
      MODEL_PICKER_MEASURED_COLD_BASELINES[OPENROUTER_DEEPSEEK_V4_PRO_MODEL]
    );
    assert.equal(
      gem.tokens,
      MODEL_PICKER_MEASURED_COLD_BASELINES[CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]
    );
    assert.ok(resolveColdOutputBaseline(OPENROUTER_DEEPSEEK_V4_PRO_MODEL) < 2000);
  });
});
