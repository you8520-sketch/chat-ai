/** Phase 1 prompt snapshot — buildContext systemPrompt for diff check. */
import { buildContext } from "../src/services/contextBuilder";
import { OPENROUTER_QWEN_37_MAX_MODEL, GEMINI_CHAT_FLASH_25 } from "../src/lib/chatModels";
import type { CharacterChunk } from "../src/types";

const sampleChunk: CharacterChunk = {
  id: "c-chunk-0",
  characterId: "1",
  content: "[Identity]\nTest character.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 10,
  keywords: ["test"],
};

function snapshot(modelId: string, provider: "openrouter" | "gemini") {
  return buildContext({
    charName: "Test",
    chunks: [sampleChunk],
    userNickname: "User",
    shortTermHistory: [],
    currentUserMessage: "hello",
    nsfw: true,
    modelId,
    provider,
  }).systemPrompt;
}

const parts = [
  "===OPENROUTER===",
  snapshot(OPENROUTER_QWEN_37_MAX_MODEL, "openrouter"),
  "===GEMINI===",
  snapshot(GEMINI_CHAT_FLASH_25, "gemini"),
];
process.stdout.write(parts.join("\n"));
