import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "@/services/contextBuilder";

describe("contextBuilder regenerate", () => {
  it("injects mandatory divergence block into dynamic system prompt", () => {
    const built = buildContext({
      charName: "에쉬",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: [],
      currentUserMessage: "[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]",
      nsfw: false,
      provider: "openrouter",
      modelId: "anthropic/claude-opus-4",
      regenerate: true,
      rejectedAssistantDraft: "에쉬가 고개를 끄덕였다.",
    });

    assert.match(built.systemPrompt, /REGENERATE — MANDATORY DIVERGENCE/i);
    assert.match(built.systemPrompt, /divergence reference \(summary only/i);
    assert.match(built.systemPrompt, /Opening situation:/i);
    assert.match(built.systemPrompt, /고개를 끄덕였다/);
    assert.doesNotMatch(built.systemPrompt, /\[Rejected draft — do NOT repeat/i);
  });

  it("skips regenerate block on normal turns", () => {
    const built = buildContext({
      charName: "에쉬",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: [],
      currentUserMessage: "앞으로 가자",
      nsfw: false,
      provider: "openrouter",
      modelId: "anthropic/claude-opus-4",
    });

    assert.doesNotMatch(built.systemPrompt, /REGENERATE — MANDATORY DIVERGENCE/i);
  });
});
