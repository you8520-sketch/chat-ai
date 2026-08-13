import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "../cheaperInferenceConfig";
import { adaptTrpgBotChatBody, adaptTrpgGmChatBody } from "./gmClient";

describe("TRPG GM call path vs regular chat", () => {
  it("enables DeepSeek V4 Pro thinking only on the GM adapter", () => {
    const body = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "장면" }],
      reasoning_effort: "high",
    };
    assert.deepEqual(adaptTrpgGmChatBody(body), {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "enabled" },
    });
    assert.deepEqual(adaptTrpgBotChatBody(body), {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "disabled" },
    });
    assert.deepEqual(adaptCheaperInferenceChatBody(body), {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "disabled" },
    });
    assert.equal(body.reasoning_effort, "high", "input must not be mutated");
  });
});
