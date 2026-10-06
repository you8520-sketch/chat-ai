import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "@/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import { resolveRpOpenRouterModelId } from "@/lib/openRouterConfig";
import {
  computeCheaperInferenceMarketPreviewCost,
  computeOpenRouterTurnCost,
} from "@/lib/points";
import {
  buildModelPickerPreview,
  capOutputSanityUpper,
  collectModelOutputSamples,
  computePreviewTurnPoints,
  computeStablePublishedPreviewPoints,
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

const ACTIVE_DEEPSEEK_MODEL =
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;

const ACTIVE_WITH_PREVIEW_OWNER = [
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  GEMINI_38_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
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
  it("shows exactly the canonical current four-model picker preview", () => {
    const preview = buildModelPickerPreview({ messages: [] });
    assert.equal(preview.models.length, 4);
    assert.ok(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL)
    );
    assert.equal(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      false
    );
    assert.equal(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      false
    );
    assert.ok(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL)
    );
    assert.ok(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_GPT_61_SOL_MODEL)
    );
    assert.equal(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      false
    );
    assert.equal(
      preview.models.some((m) => m.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      false
    );
    assert.ok(
      preview.models.some((m) => m.modelId === GEMINI_38_FLASH_MODEL)
    );
  });

  it("covers current models that already have this legacy preview owner's pricing path", () => {
    const preview = buildModelPickerPreview({ messages: [], modelIds: [...ACTIVE_WITH_PREVIEW_OWNER] });
    assert.equal(preview.models.length, ACTIVE_WITH_PREVIEW_OWNER.length);
    for (const id of ACTIVE_WITH_PREVIEW_OWNER) {
      const row = preview.models.find((m) => m.modelId === id);
      assert.ok(row, id);
      assert.equal(row!.supported, true);
      assert.ok(row!.estimatedPoints != null && row!.estimatedPoints >= 5);
      assert.ok(row!.estimatedPointsLow != null);
      assert.ok(row!.estimatedPointsHigh != null);
      assert.ok(row!.estimatedPointsHigh! > row!.estimatedPointsLow!, id);
    }
  });

  it("V4.1 preview uses the stable published owner, not legacy DeepSeek fallback", () => {
    const inputTokens = 22_000;
    const outputTokens = 1_500;
    const published = computeStablePublishedPreviewPoints({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      inputTokens,
      outputTokens,
    });
    const preview = computePreviewTurnPoints({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      inputTokens,
      outputTokens,
    });
    assert.ok(published != null && published > 0);
    assert.equal(preview, published);
    assert.equal(
      computeCheaperInferenceMarketPreviewCost(
        inputTokens,
        outputTokens,
        CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        0.15
      ),
      null
    );
  });

  it("uses p30+recent blend under sanity cap — stays below aim", () => {
    const { tokens } = resolveModelPickerOutputTokens({
      modelId: ACTIVE_DEEPSEEK_MODEL,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      messages: [
        assistantUsage(ACTIVE_DEEPSEEK_MODEL, 1700),
        assistantUsage(ACTIVE_DEEPSEEK_MODEL, 1800),
        assistantUsage(ACTIVE_DEEPSEEK_MODEL, 1900),
      ],
    });
    // newest=1900, p30=1700 → round(1700*0.75 + 1900*0.25)=1750
    assert.equal(tokens, 1750);
    assert.notEqual(tokens, resolveAimOutputTokens(3200));
  });

  it("caps extreme sample medians to aim×0.9", () => {
    const messages = [
      assistantUsage(ACTIVE_DEEPSEEK_MODEL, 2000),
      assistantUsage(ACTIVE_DEEPSEEK_MODEL, 2200),
      assistantUsage(ACTIVE_DEEPSEEK_MODEL, 2400),
      assistantUsage(GEMINI_38_FLASH_MODEL, 8000),
    ];
    const ds = resolveModelPickerOutputTokens({
      modelId: ACTIVE_DEEPSEEK_MODEL,
      messages,
    });
    // newest-first: 2400,2200,2000 → p30=2000 → blend 2000*0.75+2400*0.25=2100
    assert.equal(ds.tokens, 2100);
    const gemini = resolveModelPickerOutputTokens({
      modelId: GEMINI_38_FLASH_MODEL,
      messages: [
        assistantUsage(GEMINI_38_FLASH_MODEL, 7900),
        assistantUsage(GEMINI_38_FLASH_MODEL, 8000),
        assistantUsage(GEMINI_38_FLASH_MODEL, 8100),
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
        model: ACTIVE_DEEPSEEK_MODEL,
        usage: {
          selectedAI: ACTIVE_DEEPSEEK_MODEL,
          apiOutputTokens: 999,
        },
        variants: [
          { usage: { selectedAI: ACTIVE_DEEPSEEK_MODEL, apiOutputTokens: 999 } },
          { usage: { selectedAI: ACTIVE_DEEPSEEK_MODEL, apiOutputTokens: 2100 } },
        ],
        activeVariant: 1,
      },
    ];
    const samples = collectModelOutputSamples({
      modelId: ACTIVE_DEEPSEEK_MODEL,
      messages,
    });
    assert.deepEqual(samples, [2100]);
  });

  it("prefers assembled snapshot over api input in base resolver", () => {
    const resolved = resolveModelPickerBaseInputTokens({
      assembledSnapshotTokens: 11_200,
      messages: [
        assistantUsage(GEMINI_38_FLASH_MODEL, 2000, { apiInputTokens: 9200 }),
      ],
    });
    assert.equal(resolved.tokens, 11_200);
    assert.equal(resolved.basis, "assembled_snapshot");
  });

  it("caps assembled input by last receipt api input", () => {
    const messages = [
      assistantUsage(GEMINI_38_FLASH_MODEL, 2000, { apiInputTokens: 9_200 }),
    ];
    const aligned = resolveAlignedPreviewInputTokens({
      modelId: GEMINI_38_FLASH_MODEL,
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
    for (const modelId of ACTIVE_WITH_PREVIEW_OWNER) {
      const preview = computePreviewTurnPoints({ modelId, inputTokens: input, outputTokens: output });
      const billed =
        modelId === GEMINI_38_FLASH_MODEL
          ? computeOpenRouterTurnCost(input, output, resolveRpOpenRouterModelId(modelId))
          : computeStablePublishedPreviewPoints({ modelId, inputTokens: input, outputTokens: output }) ??
            computeCheaperInferenceMarketPreviewCost(input, output, modelId, 0.15);
      assert.equal(preview, billed, modelId);
    }
  });

  it("keeps Main RP Gemini 3.8 preview on OpenRouter even though TRPG also supports it on CheaperInference", () => {
    const inputTokens = 15_000;
    const outputTokens = 2_200;
    assert.equal(
      computePreviewTurnPoints({
        modelId: GEMINI_38_FLASH_MODEL,
        inputTokens,
        outputTokens,
      }),
      computeOpenRouterTurnCost(
        inputTokens,
        outputTokens,
        resolveRpOpenRouterModelId(GEMINI_38_FLASH_MODEL)
      )
    );
  });

  it("uses each model's assembled input snapshot with billing parity when no receipt", () => {
    const deepSeekInput = 22_000;
    const geminiInput = 15_000;
    const preview = buildModelPickerPreview({
      messages: [],
      modelIds: [
        ACTIVE_DEEPSEEK_MODEL,
        GEMINI_38_FLASH_MODEL,
      ],
      assembledSnapshotTokensByModel: {
        [ACTIVE_DEEPSEEK_MODEL]: deepSeekInput,
        [GEMINI_38_FLASH_MODEL]: geminiInput,
      },
    });
    const deepSeek = preview.models.find(
      (row) => row.modelId === ACTIVE_DEEPSEEK_MODEL
    )!;
    const gemini = preview.models.find(
      (row) => row.modelId === GEMINI_38_FLASH_MODEL
    )!;

    assert.equal(deepSeek.estimatedInputTokens, deepSeekInput);
    assert.equal(gemini.estimatedInputTokens, geminiInput);
    assert.equal(
      deepSeek.estimatedPoints,
      computeStablePublishedPreviewPoints({
        modelId: deepSeek.modelId,
        inputTokens: deepSeekInput,
        outputTokens: deepSeek.estimatedOutputTokens,
      })
    );
    assert.equal(
      gemini.estimatedPoints,
      computeOpenRouterTurnCost(
        geminiInput,
        gemini.estimatedOutputTokens,
        resolveRpOpenRouterModelId(gemini.modelId)
      )
    );
  });

  it("adds the same draft-token estimate to every model-specific snapshot", () => {
    const draftInput = "오늘은 긴 이야기를 시작해 보자.";
    const preview = buildModelPickerPreview({
      messages: [],
      modelIds: [
        ACTIVE_DEEPSEEK_MODEL,
        GEMINI_38_FLASH_MODEL,
      ],
      assembledSnapshotTokensByModel: {
        [ACTIVE_DEEPSEEK_MODEL]: 20_000,
        [GEMINI_38_FLASH_MODEL]: 10_000,
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
      previewCostOutputTokens(GEMINI_38_FLASH_MODEL, usage),
      2500
    );
    const input = 20_000;
    const preview = buildModelPickerPreview({
      messages: [
        assistantUsage(GEMINI_38_FLASH_MODEL, 2500, {
          apiContentOutputTokens: 1700,
          apiReasoningOutputTokens: 800,
        }),
        assistantUsage(GEMINI_38_FLASH_MODEL, 2400, {
          apiContentOutputTokens: 1600,
          apiReasoningOutputTokens: 800,
        }),
        assistantUsage(GEMINI_38_FLASH_MODEL, 2600, {
          apiContentOutputTokens: 1800,
          apiReasoningOutputTokens: 800,
        }),
      ],
      modelIds: [GEMINI_38_FLASH_MODEL],
      assembledSnapshotTokensByModel: {
        [GEMINI_38_FLASH_MODEL]: input,
      },
    });
    const row = preview.models[0]!;
    // newest=2600, p30 of [2600,2400,2500] sorted [2400,2500,2600] idx0=2400
    // blend 2400*0.75+2600*0.25=2450
    assert.equal(row.estimatedOutputTokens, 2450);
    assert.equal(
      row.estimatedPoints,
      computeOpenRouterTurnCost(
        input,
        2450,
        resolveRpOpenRouterModelId(GEMINI_38_FLASH_MODEL)
      )
    );
    assert.ok((row.estimatedPointsHigh ?? 0) > (row.estimatedPointsLow ?? 0));
  });

  it("Gemini preview uses content output (reasoning excluded)", () => {
    const gemBillable = previewBillableOutputTokens(GEMINI_38_FLASH_MODEL, {
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

  it("does not relabel retired Gemini 3.1/3.7 receipts as Gemini 3.8 measured samples", () => {
    const messages = [
      assistantUsage(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 7900),
      assistantUsage(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, 7800),
    ];
    const samples = collectModelOutputSamples({
      modelId: GEMINI_38_FLASH_MODEL,
      messages,
    });
    assert.deepEqual(samples, []);

    const preview = buildModelPickerPreview({
      messages,
      modelIds: [GEMINI_38_FLASH_MODEL],
    });
    assert.equal(preview.models[0]?.outputBasis, "cold_baseline");
  });

  it("uses Sol receipts only for Sol estimates and ignores historical Terra samples", () => {
    const preview = buildModelPickerPreview({
      messages: [
        assistantUsage(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, 1800),
        assistantUsage(CHEAPER_INFERENCE_GPT_61_SOL_MODEL, 1500),
      ],
      modelIds: [CHEAPER_INFERENCE_GPT_61_SOL_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL],
    });
    const sol = preview.models.find((m) => m.modelId === CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    const deepSeek = preview.models.find((m) => m.modelId === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(sol?.supported, true);
    assert.ok((sol?.estimatedPoints ?? 0) > 0);
    assert.equal(deepSeek?.supported, true);
    assert.notEqual(sol?.outputBasis, "unsupported");
    const terraOnly = buildModelPickerPreview({
      messages: [assistantUsage(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, 1800)],
      modelIds: [CHEAPER_INFERENCE_GPT_61_SOL_MODEL],
    });
    assert.equal(terraOnly.models[0]?.outputBasis, "cold_baseline");
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
      modelIds: [...ACTIVE_WITH_PREVIEW_OWNER],
      assembledSnapshotTokensByModel: Object.fromEntries(ACTIVE_WITH_PREVIEW_OWNER.map((id) => [id, 12_000])),
    });
    for (const id of ACTIVE_WITH_PREVIEW_OWNER) {
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
        assistantUsage(ACTIVE_DEEPSEEK_MODEL, 2000, { apiInputTokens: 11_000 }),
      ],
    });
    assert.equal(afterTrim.tokens, 8000);
  });

  it("cold-start uses calibrated per-model baselines", () => {
    const deepSeek = resolveModelPickerOutputTokens({
      modelId: ACTIVE_DEEPSEEK_MODEL,
      messages: [],
    });
    const gem = resolveModelPickerOutputTokens({
      modelId: GEMINI_38_FLASH_MODEL,
      messages: [],
    });
    assert.equal(
      deepSeek.tokens,
      MODEL_PICKER_MEASURED_COLD_BASELINES[ACTIVE_DEEPSEEK_MODEL]
    );
    assert.equal(
      gem.tokens,
      MODEL_PICKER_MEASURED_COLD_BASELINES[GEMINI_38_FLASH_MODEL]
    );
    assert.ok(resolveColdOutputBaseline(ACTIVE_DEEPSEEK_MODEL) < 2000);
  });
});
