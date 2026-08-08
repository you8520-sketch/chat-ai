import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSISTANT_MESSAGE_MAX, CHAT_MESSAGE_MAX } from "./chatModels";
import { GREETING_LIMIT } from "./characterFormLimits";
import {
  isGreetingMessage,
  resolveChatMessageEditLimit,
} from "./chatMessageEditPolicy";

describe("chat message edit policy", () => {
  it("recognizes the assistant greeting as an editable greeting message", () => {
    assert.equal(isGreetingMessage({ role: "assistant", model: "greeting" }), true);
    assert.equal(isGreetingMessage({ role: "user", model: "greeting" }), false);
  });

  it("uses the character greeting limit for the chat intro", () => {
    assert.equal(
      resolveChatMessageEditLimit({ role: "assistant", model: "greeting" }),
      GREETING_LIMIT
    );
  });

  it("preserves existing limits for normal assistant and user messages", () => {
    assert.equal(
      resolveChatMessageEditLimit({ role: "assistant", model: "openrouter" }),
      ASSISTANT_MESSAGE_MAX
    );
    assert.equal(resolveChatMessageEditLimit({ role: "user", model: "user" }), CHAT_MESSAGE_MAX);
  });
});
