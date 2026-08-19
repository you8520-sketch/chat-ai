import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  PAID_DIET_COMPRESSED_ASSISTANT_CHARS,
  rawRecentTurnsToHistory,
  resolvePaidDietCoverageTurns,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { buildContext } from "@/services/contextBuilder";

function makeTurns(count: number, assistantChars = 2500): DialogueTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    user: `user-${index + 1}:${"가".repeat(200)}`,
    assistant: `assistant-${index + 1}:${"나".repeat(assistantChars)}\n\n\`\`\`html\n<div class="status">${"상태창".repeat(80)}</div>\n\`\`\``,
  }));
}

describe("contextBuilder Opus history diet", () => {
  it("keeps the 6-turn coverage window and compresses older assistants", () => {
    const history = rawRecentTurnsToHistory(makeTurns(6, 4_000));
    const built = buildContext({
      charName: "라이크",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: history,
      currentUserMessage: "지금 뭐 해?",
      nsfw: false,
      provider: "cheaperinference",
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      completedTurns: 6,
      summarizedTurnCount: 0,
      historyMinTurnFloor: 6,
    });

    const assembledHistory = built.history.slice(0, -1);
    assert.equal(assembledHistory.length, 12, "6 coverage turns must stay");
    assert.equal(resolvePaidDietCoverageTurns(6), 6);
    assert.ok(assembledHistory.every((message) => !/```html/.test(message.content)));

    const firstAssistant = assembledHistory[1]!;
    const lastAssistant = assembledHistory[11]!;
    assert.ok(firstAssistant.content.length <= PAID_DIET_COMPRESSED_ASSISTANT_CHARS + 40);
    assert.match(firstAssistant.content, /이전 턴 중반 생략/);
    assert.ok(lastAssistant.content.length > 3_000);
    assert.match(lastAssistant.content, /assistant-6/);

    const historyTokens = assembledHistory.reduce(
      (sum, message) => sum + estimateTokens(message.content ?? ""),
      0
    );
    const uncompressed = history.reduce(
      (sum, message) => sum + estimateTokens(message.content ?? ""),
      0
    );
    assert.ok(historyTokens < uncompressed * 0.6, `compressed ${historyTokens} vs raw ${uncompressed}`);
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
