import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import { inspectEnglishLayerAssembly } from "@/lib/englishLayerAssemble";
import { mergeEnglishLayerWithKoreanSpeech } from "@/lib/characterChunks";
import type { CharacterChunk } from "@/types";

const koreanIdentity: CharacterChunk = {
  id: "c-chunk-0",
  characterId: "18",
  content: "[정체성]\n그는 냉정한 검사다. 한국어 원본 설정.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 20,
  keywords: ["검사"],
};
const englishIdentity: CharacterChunk = {
  ...koreanIdentity,
  content: "[Identity]\nHe is a cold prosecutor. English runtime layer.",
};
const koreanSpeech: CharacterChunk = {
  id: "c-chunk-1",
  characterId: "18",
  content: "[말투]\n반말. 짧게 끊어 말한다.",
  category: "speech",
  importance: "CRITICAL",
  tokenCount: 12,
  keywords: ["반말"],
};

const MAIN_RP_MODELS = [
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
] as const;

describe("English layer assemble dry-run", () => {
  it("uses English non-speech + Korean speech for every main RP model", async () => {
    const { buildContext } = await import("@/services/contextBuilder");
    const merged = mergeEnglishLayerWithKoreanSpeech([englishIdentity], [
      koreanIdentity,
      koreanSpeech,
    ]);
    const koreanSystemPrompt =
      "[정체성]\n그는 냉정한 검사다. 한국어 원본 설정.\n[말투]\n반말. 짧게 끊어 말한다.";

    for (const modelId of MAIN_RP_MODELS) {
      const built = buildContext({
        charName: "도윤",
        chunks: merged,
        userNickname: "유저",
        shortTermHistory: [],
        currentUserMessage: "안녕",
        nsfw: false,
        systemPrompt: koreanSystemPrompt,
        world: "",
        modelId,
        provider: "cheaperinference",
        useEnglishCharacterPrompt: true,
      });
      const check = inspectEnglishLayerAssembly({
        usedEnglish: true,
        mergedChunks: merged,
        assembledSystemPrompt: built.systemPrompt,
        koreanSystemPrompt,
      });
      assert.equal(check.pass, true, `${modelId}: ${check.reasons.join(", ")}`);
      assert.match(built.systemPrompt, /cold prosecutor|English runtime layer/i);
      assert.match(built.systemPrompt, /반말/);
      assert.doesNotMatch(built.systemPrompt, /그는 냉정한 검사다/);
    }
  });
});
