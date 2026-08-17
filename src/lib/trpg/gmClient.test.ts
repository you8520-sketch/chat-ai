import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "../cheaperInferenceConfig";
import { adaptTrpgBotChatBody, adaptTrpgGmChatBody } from "./gmClient";
import { TRPG_BOT_MODEL, TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "./types";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

describe("TRPG GM call path vs regular chat", () => {
  it("enables DeepSeek V4 Pro thinking only on the GM adapter", () => {
    const body = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "장면" }],
      reasoning_effort: "high",
    };
    assert.deepEqual(adaptTrpgGmChatBody(body), {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "enabled" },
    });
    assert.deepEqual(adaptTrpgBotChatBody(body), {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    });
    assert.deepEqual(adaptCheaperInferenceChatBody(body), {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "disabled" },
    });
    assert.equal(body.reasoning_effort, "high", "input must not be mutated");
  });

  it("keeps a high max_tokens cap on the GM adapter", () => {
    const withCap = adaptTrpgGmChatBody({
      model: "deepseek-v4-pro-0813",
      max_tokens: TRPG_GM_MAX_TOKENS,
    });
    assert.equal(withCap.max_tokens, TRPG_GM_MAX_TOKENS);
    assert.deepEqual(withCap.thinking, { type: "enabled" });
    assert.equal("reasoning_effort" in withCap, false);
  });

  it("keeps Bot on the true OFF contract even if a caller sent another effort", () => {
    const adapted = adaptTrpgBotChatBody({
      model: "deepseek-v4-pro-0813",
      reasoning_effort: "high",
      messages: [{ role: "user", content: "문을 막는다" }],
    });
    assert.deepEqual(adapted.thinking, { type: "disabled" });
    assert.equal((adapted.thinking as { type: string }).type, "disabled");
    assert.equal(adapted.reasoning_effort, "none");
    assert.equal(adapted.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(TRPG_BOT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  });
});
