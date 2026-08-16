import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import { estimateTokens } from "@/lib/tokenEstimate";
import { rawRecentTurnsToHistory, type DialogueTurn } from "@/lib/hybridMemory";
import { buildContext } from "@/services/contextBuilder";

function makeTurns(count: number, assistantChars = 2500): DialogueTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    user: `user-${index + 1}:${"가".repeat(200)}`,
    assistant: `assistant-${index + 1}:${"나".repeat(assistantChars)}\n\n\`\`\`html\n<div class="status">${"상태창".repeat(80)}</div>\n\`\`\``,
  }));
}

describe("contextBuilder Opus history diet", () => {
  it("hard-caps Claude Opus 5 raw history near 10K even with a high coverage floor", () => {
    const history = rawRecentTurnsToHistory(makeTurns(16, 3_000));
    const built = buildContext({
      charName: "라이크",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: history,
      currentUserMessage: "지금 뭐 해?",
      nsfw: false,
      provider: "cheaperinference",
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      completedTurns: 16,
      summarizedTurnCount: 0,
      historyMinTurnFloor: 16,
    });

    const assembledHistory = built.history.slice(0, -1);
    const historyTokens = assembledHistory.reduce(
      (sum, message) => sum + estimateTokens(message.content ?? ""),
      0
    );
    assert.ok(
      historyTokens <= HISTORY_TOKEN_BUDGET + 1_500,
      `Opus history ${historyTokens} exceeded diet`
    );
    assert.ok(assembledHistory.length < history.length);
    assert.ok(assembledHistory.every((message) => !/```html/.test(message.content)));
    assert.match(assembledHistory.at(-1)?.content ?? "", /assistant-16/);
  });

  it("does not apply the Claude diet to DeepSeek V4 Pro", () => {
    const history = rawRecentTurnsToHistory(makeTurns(16, 3_000));
    const built = buildContext({
      charName: "라이크",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: history,
      currentUserMessage: "지금 뭐 해?",
      nsfw: false,
      provider: "cheaperinference",
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      completedTurns: 16,
      summarizedTurnCount: 0,
      historyMinTurnFloor: 16,
    });

    const assembledHistory = built.history.slice(0, -1);
    assert.equal(assembledHistory.length, history.length);
  });
});
