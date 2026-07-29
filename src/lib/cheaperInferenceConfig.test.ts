import assert from "node:assert/strict";
import test from "node:test";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  assertCheaperInferenceEndpoint,
} from "./cheaperInferenceConfig";

test("Cheaper Inference endpoint is fixed to chat completions", () => {
  assert.doesNotThrow(() =>
    assertCheaperInferenceEndpoint(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL)
  );
  assert.throws(() =>
    assertCheaperInferenceEndpoint("https://example.com/v1/chat/completions")
  );
});

test("OpenRouter-only request extensions are removed", () => {
  const body = {
    model: "claude-opus-5",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.82,
    max_tokens: 4096,
    session_id: "chat-1",
    frequency_penalty: 0.1,
    presence_penalty: 0.1,
    repetition_penalty: 1.05,
  };

  assert.deepEqual(adaptCheaperInferenceChatBody(body), {
    model: "claude-opus-5",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.82,
    max_tokens: 4096,
  });
  assert.equal(body.session_id, "chat-1", "input must not be mutated");
});
