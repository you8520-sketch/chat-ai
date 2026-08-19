import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HISTORY_TOKEN_BUDGET,
  HISTORY_TOKEN_HARD_CAP,
  resolveHistoryTokenBudget,
  resolveMaxPayloadInputTokens,
} from "@/lib/contextTrack";
import { MAX_PAYLOAD_INPUT_TOKENS } from "@/lib/turnApiBudget";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";

describe("history / payload token budgets", () => {
  it("keeps the shared 10K history budget for every provider", () => {
    assert.equal(HISTORY_TOKEN_BUDGET, 10_000);
    assert.equal(HISTORY_TOKEN_HARD_CAP, 16_000);
    assert.equal(resolveHistoryTokenBudget("gemini-3.7-flash", "openrouter"), 10_000);
    assert.equal(
      resolveHistoryTokenBudget(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, "openrouter"),
      10_000
    );
    assert.equal(
      resolveHistoryTokenBudget(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, "openrouter"),
      10_000
    );
    assert.equal(resolveHistoryTokenBudget("unused", "gemini"), 10_000);
  });

  it("restores the loop-bug payload ceiling instead of MAX_SAFE_INTEGER", () => {
    assert.equal(resolveMaxPayloadInputTokens("gemini-3.7-flash"), MAX_PAYLOAD_INPUT_TOKENS);
    assert.equal(resolveMaxPayloadInputTokens("claude-opus-5"), MAX_PAYLOAD_INPUT_TOKENS);
    assert.ok(
      resolveMaxPayloadInputTokens(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL) < Number.MAX_SAFE_INTEGER
    );
    assert.ok(resolveMaxPayloadInputTokens("gemini-3.7-flash") < Number.MAX_SAFE_INTEGER);
  });
});
