import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
} from "@/lib/chatModels";
import { visibleAssistantDisplayCharCount, visibleAssistantDisplayText } from "@/lib/chatDisplayLength";
import {
  applyProviderInputCalibration,
  computeMainRpNextTurnEstimates,
  estimateNextTurnOutputTokens,
  isUsableOutputCalibrationSource,
  isUsableProviderInputCalibrationSource,
  nextTurnEstimateDisplayMap,
  pickLatestProviderInputCalibrationByModel,
  resolveMainRpNextTurnCalibrationModelId,
  resolveNextTurnOutputChars,
  resolveObservedCharsPerToken,
  resolveProviderInputRatio,
} from "@/lib/mainRpNextTurnEstimate";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  computePublishedStandardPreviewDisplayPoints,
  computePublishedStandardPreviewPoints,
} from "@/lib/publishedUserCharge";
import {
  MAIN_RP_PROVIDER_ADMISSION_ESTIMATE_MULTIPLIER,
  admitMainRpProviderByRequiredPoints,
  resolveMainRpProviderAdmissionRequiredPoints,
} from "@/lib/mainRpProviderAdmission";
import {
  CATASTROPHIC_MIN_RESPONSE_CHARS,
  KOREAN_CHARS_PER_OUTPUT_TOKEN,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import { buildContext } from "@/services/contextBuilder";
import type { CharacterChunk } from "@/types";

const FX = 1560.6;
const ESTIMATE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/mainRpNextTurnEstimate.ts"),
  "utf8"
);
const SERVICE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/services/mainRpNextTurnEstimate.ts"),
  "utf8"
);
const ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/chat/next-turn-estimates/route.ts"),
  "utf8"
);
const SELECTED_AI_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/user/selected-ai/route.ts"),
  "utf8"
);
const PAGE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/chat/[id]/page.tsx"),
  "utf8"
);
const CHAT_ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);
const TOKEN_ESTIMATE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/tokenEstimate.ts"),
  "utf8"
);

const IDENTITY_CHUNK: CharacterChunk = {
  id: "c-identity",
  characterId: "1",
  content: "[Identity]\n솔은 밤의 등대지기. FIRST_TURN_CHARACTER_SETTING",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 20,
  keywords: ["솔"],
};

const WORLD_CHUNK: CharacterChunk = {
  id: "c-world",
  characterId: "1",
  content: "FIRST_TURN_WORLD 등대 아래 항구.",
  category: "world",
  importance: "CONTEXTUAL",
  tokenCount: 12,
  keywords: ["등대"],
};

function firstTurnInput(modelId: string, extraHistory: Array<{ role: "user" | "assistant"; content: string }> = []) {
  return {
    charName: "솔",
    contentKind: "character" as const,
    chunks: [IDENTITY_CHUNK, WORLD_CHUNK],
    systemPrompt: "FIRST_TURN_SYSTEM_PROMPT 너는 솔이다.",
    world: "FIRST_TURN_WORLD 등대 아래 항구.",
    exampleDialog: "안녕, 여행자.",
    userNickname: "여행자",
    personaDisplayName: "여행자",
    userPersona: "FIRST_TURN_PERSONA 과묵한 항해사.",
    userNote: "FIRST_TURN_USER_NOTE 비 오는 밤을 좋아한다.",
    userLorebookBlock: "FIRST_TURN_LOREBOOK 항구의 안개",
    shortTermHistory: [
      { role: "assistant" as const, content: "FIRST_TURN_GREETING 등대가 깜빡인다." },
      ...extraHistory,
    ],
    currentUserMessage: "",
    nsfw: false,
    modelId,
    provider: "openrouter" as const,
    targetResponseChars: UNIFIED_TIER_AIM_CHARS,
    completedTurns: extraHistory.length > 0 ? 1 : 0,
  };
}

function assembledTokens(modelId: string, extraHistory?: Array<{ role: "user" | "assistant"; content: string }>) {
  const built = buildContext(firstTurnInput(modelId, extraHistory));
  const tokens = built.meta.promptAudit?.totalAssembledTokens ?? built.meta.estimatedInputTokens;
  assert.ok(typeof tokens === "number" && tokens > 0, modelId);
  return { built, tokens: tokens! };
}

describe("main RP next-turn estimate", () => {
  it("A first-turn assembly includes production-injected sources", () => {
    const { built, tokens } = assembledTokens(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    const blob = `${built.systemPrompt}\n${built.history.map((m) => m.content).join("\n")}`;
    for (const marker of [
      "FIRST_TURN_CHARACTER_SETTING",
      "FIRST_TURN_WORLD",
      "FIRST_TURN_GREETING",
      "FIRST_TURN_PERSONA",
      "FIRST_TURN_USER_NOTE",
      "3,200자",
    ]) {
      assert.ok(blob.includes(marker), marker);
    }
    assert.ok(tokens > 200);
  });

  it("B same room snapshot yields different input tokens for two adapters", () => {
    const deepseek = assembledTokens(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    const gemini = assembledTokens(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    assert.notEqual(deepseek.tokens, gemini.tokens);
    const estimates = computeMainRpNextTurnEstimates({
      promptTokensByModel: {
        [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: deepseek.tokens,
        [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]: gemini.tokens,
      },
      effectiveKrwPerUsd: FX,
    });
    assert.notEqual(
      estimates[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]?.promptTokens,
      estimates[CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL]?.promptTokens
    );
  });

  it("C next-turn history changes the input estimate", () => {
    const first = assembledTokens(CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    const next = assembledTokens(CHEAPER_INFERENCE_GPT_61_SOL_MODEL, [
      { role: "user", content: "등대에 들어가도 될까?" },
      {
        role: "assistant",
        content: `${"다음 턴 본문 ".repeat(80)} 파도가 문을 두드린다.`,
      },
    ]);
    assert.notEqual(first.tokens, next.tokens);
    assert.ok(next.tokens > first.tokens);
  });

  it("D output floor uses 3200 unless last visible body is longer", () => {
    assert.equal(resolveNextTurnOutputChars(null), UNIFIED_TIER_AIM_CHARS);
    assert.equal(resolveNextTurnOutputChars(1200), UNIFIED_TIER_AIM_CHARS);
    assert.equal(resolveNextTurnOutputChars(3199), UNIFIED_TIER_AIM_CHARS);
    assert.equal(resolveNextTurnOutputChars(4800), 4800);
    const short = estimateNextTurnOutputTokens({ outputChars: UNIFIED_TIER_AIM_CHARS });
    const long = estimateNextTurnOutputTokens({ outputChars: 4800 });
    assert.equal(short, Math.ceil(UNIFIED_TIER_AIM_CHARS / KOREAN_CHARS_PER_OUTPUT_TOKEN));
    assert.ok(long > short);
  });

  it("E interrupted/failed/malformed turns are not calibration sources", () => {
    assert.equal(
      isUsableOutputCalibrationSource({
        generationStatus: "interrupted",
        model: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        visibleChars: 4000,
        outputTokens: 2000,
      }),
      false
    );
    assert.equal(
      isUsableOutputCalibrationSource({
        generationStatus: "failed",
        model: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        visibleChars: 4000,
        outputTokens: 2000,
      }),
      false
    );
    assert.equal(
      isUsableOutputCalibrationSource({
        generationStatus: "completed",
        model: "greeting",
        visibleChars: 4000,
        outputTokens: 2000,
      }),
      false
    );
    assert.equal(
      isUsableOutputCalibrationSource({
        generationStatus: "completed",
        model: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        visibleChars: CATASTROPHIC_MIN_RESPONSE_CHARS - 1,
        outputTokens: 2000,
      }),
      false
    );
    assert.equal(
      isUsableOutputCalibrationSource({
        generationStatus: "completed",
        model: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        visibleChars: 4000,
        outputTokens: 2000,
      }),
      true
    );
    assert.equal(resolveObservedCharsPerToken({ visibleChars: 40, outputTokens: 20 }), null);
  });

  it("F Opus 5.5 45% published owner is used with no local formula", () => {
    const pricing = getPublishedPricing(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    assert.equal(pricing?.targetMargin, 0.45);
    const { tokens } = assembledTokens(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    const estimates = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL]: tokens },
      effectiveKrwPerUsd: FX,
    });
    const row = estimates[CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL];
    assert.ok(row);
    assert.equal(
      row!.displayPoints,
      computePublishedStandardPreviewDisplayPoints({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens: row!.promptTokens,
        outputTokens: row!.expectedOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        effectiveKrwPerUsd: FX,
      })
    );
    assert.doesNotMatch(ESTIMATE_SOURCE, /0\.45/);
    assert.doesNotMatch(ESTIMATE_SOURCE, /targetMargin/);
  });

  it("G Sol long-context threshold matches the Published owner", () => {
    const pricing = getPublishedPricing(CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    const threshold = pricing?.publishedLongContextMinPromptTokens;
    assert.equal(threshold, 272_000);
    const below = computePublishedStandardPreviewDisplayPoints({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      promptTokens: threshold!,
      outputTokens: 2134,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    const above = computePublishedStandardPreviewDisplayPoints({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      promptTokens: threshold! + 1,
      outputTokens: 2134,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    assert.ok(below != null && above != null);
    assert.notEqual(below, above);
    const estimates = computeMainRpNextTurnEstimates({
      promptTokensByModel: {
        [CHEAPER_INFERENCE_GPT_61_SOL_MODEL]: threshold! + 1,
      },
      effectiveKrwPerUsd: FX,
    });
    assert.equal(
      estimates[CHEAPER_INFERENCE_GPT_61_SOL_MODEL]?.displayPoints,
      above
    );
  });

  it("H unverified cache stays at 0", () => {
    assert.match(ESTIMATE_SOURCE, /cacheReadTokens: 0/);
    assert.match(ESTIMATE_SOURCE, /cacheWriteTokens: 0/);
    const withZero = computePublishedStandardPreviewDisplayPoints({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      promptTokens: 8000,
      outputTokens: 2134,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    const withFakeCache = computePublishedStandardPreviewDisplayPoints({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      promptTokens: 8000,
      outputTokens: 2134,
      cacheReadTokens: 4000,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    assert.ok(withZero != null && withFakeCache != null);
    assert.notEqual(withZero, withFakeCache);
  });

  it("I estimate modules do not call providers or write ledgers", () => {
    for (const src of [ESTIMATE_SOURCE, SERVICE_SOURCE, ROUTE_SOURCE]) {
      assert.doesNotMatch(src, /streamOpenRouter/);
      assert.doesNotMatch(src, /recordMainGenerationProviderCost/);
      assert.doesNotMatch(src, /acquireMainRpGenerationLease/);
      assert.doesNotMatch(src, /settleChatTurnBillingExactlyOnce/);
      assert.doesNotMatch(src, /fetch\(/);
    }
    assert.match(SERVICE_SOURCE, /resolveModelPickerAssembledInputSnapshots/);
    assert.match(SERVICE_SOURCE, /visibleAssistantDisplayCharCount/);
    assert.match(SERVICE_SOURCE, /billableOpenRouterOutputTokens/);
  });

  it("J room isolation: selected-ai is not the room estimate owner", () => {
    assert.doesNotMatch(SELECTED_AI_SOURCE, /modelPickerBaselineEstimates/);
    assert.doesNotMatch(SELECTED_AI_SOURCE, /computeMainRpPickerBaselineEstimates/);
    assert.match(PAGE_SOURCE, /resolveMainRpNextTurnPickerEstimates/);
    assert.match(SERVICE_SOURCE, /user_id=\?/);
    const chatA = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 4000 },
      effectiveKrwPerUsd: FX,
    });
    const chatB = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 12000 },
      lastVisibleAssistantChars: 5000,
      effectiveKrwPerUsd: FX,
    });
    assert.notEqual(
      chatA[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]?.displayPoints,
      chatB[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]?.displayPoints
    );
  });

  it("visible body owner is reused instead of raw content.length", () => {
    const raw = `*RP 본문*\n<PitWallFixture tyreWearPct={38} driver="Dante" />`;
    const visibleText = visibleAssistantDisplayText(raw);
    const visible = visibleAssistantDisplayCharCount(raw);
    assert.ok(visible < raw.length);
    assert.ok(visible > 0);
    assert.doesNotMatch(visibleText, /tyreWearPct/);
  });

  it("display map only keeps positive integers", () => {
    const estimates = computeMainRpNextTurnEstimates({
      promptTokensByModel: {
        [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 3500,
        [CHEAPER_INFERENCE_GPT_61_SOL_MODEL]: 3500,
      },
      effectiveKrwPerUsd: FX,
    });
    const display = nextTurnEstimateDisplayMap(estimates);
    assert.ok((display[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL] ?? 0) > 0);
    assert.ok((display[CHEAPER_INFERENCE_GPT_61_SOL_MODEL] ?? 0) > 0);
  });
});

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const FLASH = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
const PREV_ASSEMBLED = 34_816;
const PREV_PROVIDER = 14_312;
const PREV_OUTPUT = 2_780;
const PREV_CHARS = 4_213;
const SOL_OBSERVED_CHARS_PER_TOKEN = PREV_CHARS / PREV_OUTPUT;

function solValidInputSource(overrides: Record<string, unknown> = {}) {
  return {
    generationStatus: "completed",
    model: SOL,
    selectedAI: SOL,
    actualModel: SOL,
    htmlFlashOnly: false,
    estimated: false,
    fallback: null,
    fallbackAttempted: false,
    apiCallCount: 1,
    lengthRecoveryPasses: 0,
    apiInputTokens: PREV_PROVIDER,
    assembledInputTokens: PREV_ASSEMBLED,
    ...overrides,
  };
}

function solNextTurn(input: {
  assembled: number;
  sample?: { actualProviderInputTokens: number; assembledInputTokens: number } | null;
}) {
  return computeMainRpNextTurnEstimates({
    promptTokensByModel: { [SOL]: input.assembled },
    lastVisibleAssistantChars: PREV_CHARS,
    observedCharsPerTokenByModel: { [SOL]: SOL_OBSERVED_CHARS_PER_TOKEN },
    providerInputCalibrationByModel:
      input.sample === undefined
        ? undefined
        : input.sample
          ? { [SOL]: input.sample }
          : { [SOL]: null },
    effectiveKrwPerUsd: FX,
  })[SOL];
}

describe("provider-input next-turn calibration", () => {
  it("A previous 14312/2780/4213 does not jump the next Sol estimate to ~277P", () => {
    const nextAssembled = PREV_ASSEMBLED + 80;
    const calibrated = solNextTurn({
      assembled: nextAssembled,
      sample: {
        actualProviderInputTokens: PREV_PROVIDER,
        assembledInputTokens: PREV_ASSEMBLED,
      },
    });
    const uncalibrated = solNextTurn({ assembled: nextAssembled });
    assert.ok(calibrated && uncalibrated);
    assert.equal(uncalibrated!.displayPoints, 277);
    assert.ok(calibrated!.displayPoints >= 159 && calibrated!.displayPoints <= 163);
    assert.notEqual(calibrated!.displayPoints, 277);
    assert.equal(calibrated!.localAssembledInputTokens, nextAssembled);
    assert.equal(
      calibrated!.predictedProviderInputTokens,
      Math.round(nextAssembled * (PREV_PROVIDER / PREV_ASSEMBLED))
    );
    assert.equal(calibrated!.promptTokens, calibrated!.predictedProviderInputTokens);
    assert.equal(calibrated!.actualProviderInputTokens, PREV_PROVIDER);
    assert.equal(calibrated!.expectedOutputTokens, PREV_OUTPUT);
    assert.equal(calibrated!.outputBasis, "observed_ratio");
    assert.equal(calibrated!.calibrationSource, "same_model_provider_ratio");
    assert.equal(calibrated!.calibrationConfidence, "latest_same_model");
  });

  it("B Published 14312/2780 stays pinned at 160 display / 161 ceil", () => {
    const display = computePublishedStandardPreviewDisplayPoints({
      modelId: SOL,
      promptTokens: PREV_PROVIDER,
      outputTokens: PREV_OUTPUT,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    const ceil = computePublishedStandardPreviewPoints({
      modelId: SOL,
      promptTokens: PREV_PROVIDER,
      outputTokens: PREV_OUTPUT,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    assert.equal(display, 160);
    assert.equal(ceil, 161);
  });

  it("C same-model calibration scales inflated assembled down to provider scale and caps ratio at 1", () => {
    const ratio = resolveProviderInputRatio({
      actualProviderInputTokens: PREV_PROVIDER,
      assembledInputTokens: PREV_ASSEMBLED,
    });
    assert.ok(ratio != null);
    assert.ok(ratio! < 1);
    assert.equal(
      applyProviderInputCalibration({
        localAssembledInputTokens: PREV_ASSEMBLED,
        sample: {
          actualProviderInputTokens: PREV_PROVIDER,
          assembledInputTokens: PREV_ASSEMBLED,
        },
      }).predictedProviderInputTokens,
      PREV_PROVIDER
    );
    const capped = resolveProviderInputRatio({
      actualProviderInputTokens: 40_000,
      assembledInputTokens: PREV_ASSEMBLED,
    });
    assert.equal(capped, 1);
    const cappedApply = applyProviderInputCalibration({
      localAssembledInputTokens: PREV_ASSEMBLED + 10,
      sample: {
        actualProviderInputTokens: 40_000,
        assembledInputTokens: PREV_ASSEMBLED,
      },
    });
    assert.equal(cappedApply.predictedProviderInputTokens, PREV_ASSEMBLED + 10);
    assert.equal(cappedApply.calibrationSource, "same_model_provider_ratio");
  });

  it("D no calibration falls back to the current uncalibrated assembled forecast", () => {
    const fallback = solNextTurn({ assembled: PREV_ASSEMBLED });
    assert.ok(fallback);
    assert.equal(fallback!.promptTokens, PREV_ASSEMBLED);
    assert.equal(fallback!.localAssembledInputTokens, PREV_ASSEMBLED);
    assert.equal(fallback!.predictedProviderInputTokens, PREV_ASSEMBLED);
    assert.equal(fallback!.actualProviderInputTokens, null);
    assert.equal(fallback!.calibrationSource, "uncalibrated_assembled");
    assert.equal(fallback!.calibrationConfidence, "none");
    assert.equal(fallback!.displayPoints, 277);
    assert.equal(TOKEN_ESTIMATE_SOURCE, fs.readFileSync(
      path.join(process.cwd(), "src/lib/tokenEstimate.ts"),
      "utf8"
    ));
    assert.match(TOKEN_ESTIMATE_SOURCE, /text\.length \* 0\.9/);
  });

  it("E multi-call and length-recovery turns cannot be a calibration source", () => {
    assert.equal(isUsableProviderInputCalibrationSource(solValidInputSource()), true);
    assert.equal(
      isUsableProviderInputCalibrationSource(solValidInputSource({ apiCallCount: 2 })),
      false
    );
    assert.equal(
      isUsableProviderInputCalibrationSource(
        solValidInputSource({ lengthRecoveryPasses: 1 })
      ),
      false
    );
    assert.equal(
      isUsableProviderInputCalibrationSource(solValidInputSource({ estimated: true })),
      false
    );
    assert.equal(
      isUsableProviderInputCalibrationSource(
        solValidInputSource({ fallback: "adult-fallback" })
      ),
      false
    );
    assert.equal(
      isUsableProviderInputCalibrationSource(
        solValidInputSource({ fallbackAttempted: true })
      ),
      false
    );
    assert.equal(
      isUsableProviderInputCalibrationSource(
        solValidInputSource({ generationStatus: "interrupted" })
      ),
      false
    );
    assert.equal(
      isUsableProviderInputCalibrationSource(
        solValidInputSource({ htmlFlashOnly: true })
      ),
      false
    );
    assert.equal(
      isUsableProviderInputCalibrationSource(
        solValidInputSource({ model: "greeting", selectedAI: "greeting" })
      ),
      false
    );
    assert.equal(
      isUsableProviderInputCalibrationSource(
        solValidInputSource({ apiInputTokens: null })
      ),
      false
    );
    const picked = pickLatestProviderInputCalibrationByModel([
      solValidInputSource(),
      solValidInputSource({ apiCallCount: 3, apiInputTokens: 9_999 }),
      solValidInputSource({ lengthRecoveryPasses: 2, apiInputTokens: 8_888 }),
    ]);
    assert.deepEqual(picked[SOL], {
      actualProviderInputTokens: PREV_PROVIDER,
      assembledInputTokens: PREV_ASSEMBLED,
    });
  });

  it("F a different model's ratio is not reused after a model switch", () => {
    const flashOnly = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [SOL]: PREV_ASSEMBLED },
      lastVisibleAssistantChars: PREV_CHARS,
      observedCharsPerTokenByModel: { [SOL]: SOL_OBSERVED_CHARS_PER_TOKEN },
      providerInputCalibrationByModel: {
        [FLASH]: {
          actualProviderInputTokens: PREV_PROVIDER,
          assembledInputTokens: PREV_ASSEMBLED,
        },
      },
      effectiveKrwPerUsd: FX,
    })[SOL];
    assert.ok(flashOnly);
    assert.equal(flashOnly!.calibrationSource, "uncalibrated_assembled");
    assert.equal(flashOnly!.displayPoints, 277);
    assert.equal(
      isUsableProviderInputCalibrationSource(
        solValidInputSource({ actualModel: FLASH })
      ),
      false
    );
    assert.equal(resolveMainRpNextTurnCalibrationModelId("openai/gpt-6.1-sol"), SOL);
    assert.equal(resolveMainRpNextTurnCalibrationModelId(FLASH), FLASH);
  });

  it("G regeneration and continuation skip contaminated later samples and keep the latest valid same-model ratio", () => {
    const picked = pickLatestProviderInputCalibrationByModel([
      solValidInputSource({ apiInputTokens: 12_000, assembledInputTokens: 30_000 }),
      solValidInputSource(),
      solValidInputSource({
        apiCallCount: 2,
        apiInputTokens: 50_000,
        assembledInputTokens: 36_000,
      }),
    ]);
    assert.deepEqual(picked[SOL], {
      actualProviderInputTokens: PREV_PROVIDER,
      assembledInputTokens: PREV_ASSEMBLED,
    });
    const regenEstimate = solNextTurn({
      assembled: PREV_ASSEMBLED + 40,
      sample: picked[SOL],
    });
    assert.ok(regenEstimate);
    assert.equal(regenEstimate!.calibrationSource, "same_model_provider_ratio");
    assert.notEqual(regenEstimate!.displayPoints, 277);
    assert.match(CHAT_ROUTE_SOURCE, /resolveMainRpNextTurnPublishedEstimateForModel/);
    assert.match(CHAT_ROUTE_SOURCE, /resolveMainRpProviderAdmissionRequiredPoints/);
  });

  it("H picker and #1400 admission stay on the same forecast owner", () => {
    assert.match(SERVICE_SOURCE, /function estimatesFromRoomRows/);
    assert.match(SERVICE_SOURCE, /providerInputCalibrationByModel/);
    assert.match(SERVICE_SOURCE, /readMainRpNextTurnProviderInputCalibration/);
    assert.match(
      SERVICE_SOURCE,
      /export async function resolveMainRpNextTurnPickerEstimates/
    );
    assert.match(
      SERVICE_SOURCE,
      /export function resolveMainRpNextTurnPublishedEstimateForModel/
    );
    const pickerAt = SERVICE_SOURCE.indexOf("resolveMainRpNextTurnPickerEstimates");
    const admitAt = SERVICE_SOURCE.indexOf(
      "resolveMainRpNextTurnPublishedEstimateForModel"
    );
    const fromRowsAt = SERVICE_SOURCE.indexOf("estimatesFromRoomRows(rows");
    assert.ok(pickerAt > 0);
    assert.ok(admitAt > 0);
    assert.ok(SERVICE_SOURCE.includes("estimatesFromRoomRows(rows, {"));
    assert.ok(SERVICE_SOURCE.includes("estimatesFromRoomRows(rows, promptTokensByModel)"));
    assert.match(PAGE_SOURCE, /resolveMainRpNextTurnPickerEstimates/);
    assert.match(ROUTE_SOURCE, /resolveMainRpNextTurnPickerEstimates/);
    assert.match(CHAT_ROUTE_SOURCE, /resolveMainRpNextTurnPublishedEstimateForModel/);
    assert.doesNotMatch(ESTIMATE_SOURCE, /Display-only next Main RP turn estimate/);
    assert.match(ESTIMATE_SOURCE, /#1400 admission/);
    assert.equal(fromRowsAt > 0, true);
  });

  it("I insufficient calibrated admission still blocks with provider call count 0", () => {
    const calibrated = solNextTurn({
      assembled: PREV_ASSEMBLED,
      sample: {
        actualProviderInputTokens: PREV_PROVIDER,
        assembledInputTokens: PREV_ASSEMBLED,
      },
    });
    assert.ok(calibrated);
    assert.equal(calibrated!.displayPoints, 160);
    const required = resolveMainRpProviderAdmissionRequiredPoints(
      calibrated!.displayPoints
    );
    assert.equal(MAIN_RP_PROVIDER_ADMISSION_ESTIMATE_MULTIPLIER, 3);
    assert.equal(required, 160 * 3);
    const blocked = admitMainRpProviderByRequiredPoints({
      balancePoints: 200,
      publishedNextTurnEstimatePoints: calibrated!.displayPoints,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.requiredPoints, required);
    const admitted = admitMainRpProviderByRequiredPoints({
      balancePoints: 500,
      publishedNextTurnEstimatePoints: calibrated!.displayPoints,
    });
    assert.equal(admitted.ok, true);
    const uncalibratedRequired = resolveMainRpProviderAdmissionRequiredPoints(277);
    assert.equal(uncalibratedRequired, 277 * 3);
    assert.ok(500 < uncalibratedRequired);
  });

  it("J settlement remains independent of the forecast owner", () => {
    assert.doesNotMatch(ESTIMATE_SOURCE, /settleChatTurnBillingExactlyOnce/);
    assert.doesNotMatch(SERVICE_SOURCE, /settleChatTurnBillingExactlyOnce/);
    assert.doesNotMatch(
      fs.readFileSync(path.join(process.cwd(), "src/lib/chatBillingSettlement.ts"), "utf8"),
      /computeMainRpNextTurnEstimates/
    );
  });
});
