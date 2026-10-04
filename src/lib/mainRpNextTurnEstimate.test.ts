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
  computeMainRpNextTurnEstimates,
  estimateNextTurnOutputTokens,
  isUsableOutputCalibrationSource,
  nextTurnEstimateDisplayMap,
  resolveNextTurnOutputChars,
  resolveObservedCharsPerToken,
} from "@/lib/mainRpNextTurnEstimate";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  computePublishedStandardPreviewDisplayPoints,
} from "@/lib/publishedUserCharge";
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
