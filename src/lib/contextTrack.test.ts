import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import {
  CLAUDE_MAX_PAYLOAD_INPUT_TOKENS,
  HISTORY_TOKEN_BUDGET,
  resolveHistoryTokenBudget,
  resolveMaxPayloadInputTokens,
  usesPaidHistoryDiet,
} from "@/lib/contextTrack";

describe("paid history diet", () => {
  it("caps Claude Opus 5 history at the shared 10K budget", () => {
    assert.equal(usesPaidHistoryDiet(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), true);
    assert.equal(
      resolveHistoryTokenBudget(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, "openrouter"),
      HISTORY_TOKEN_BUDGET
    );
    assert.equal(
      resolveMaxPayloadInputTokens(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      CLAUDE_MAX_PAYLOAD_INPUT_TOKENS
    );
  });

  it("leaves cheap Cheaper Inference models unlimited", () => {
    for (const modelId of [
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    ]) {
      assert.equal(usesPaidHistoryDiet(modelId), false);
      assert.equal(
        resolveHistoryTokenBudget(modelId, "openrouter"),
        Number.MAX_SAFE_INTEGER
      );
      assert.equal(resolveMaxPayloadInputTokens(modelId), Number.MAX_SAFE_INTEGER);
    }
  });
});
