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
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.82,
    max_tokens: 4096,
    reasoning_effort: "none",
    session_id: "chat-1",
    frequency_penalty: 0.1,
    presence_penalty: 0.1,
    repetition_penalty: 1.05,
  };

  assert.deepEqual(adaptCheaperInferenceChatBody(body), {
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.82,
    max_tokens: 4096,
    reasoning: { effort: "none" },
    reasoning_effort: "none",
  });
  assert.equal(body.session_id, "chat-1", "input must not be mutated");
});

test("Claude Opus 5 disables thinking at Anthropic effort low", () => {
  const body = {
    model: "claude-opus-5",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.82,
    max_tokens: 4096,
    reasoning: { effort: "none" },
    include_reasoning: false,
    reasoning_effort: "none",
    session_id: "chat-1",
    frequency_penalty: 0.1,
  };

  assert.deepEqual(adaptCheaperInferenceChatBody(body), {
    model: "claude-opus-5",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.82,
    max_tokens: 4096,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    reasoning_effort: "low",
  });
  assert.equal(body.reasoning_effort, "none", "input must not be mutated");
});

test("Gemini 3.1 Pro always uses low thinking on CheaperInference", () => {
  const body = {
    model: "gemini-3.1-pro-preview",
    messages: [{ role: "user", content: "hello" }],
    reasoning_effort: "high",
  };

  assert.deepEqual(adaptCheaperInferenceChatBody(body), {
    model: "gemini-3.1-pro-preview",
    messages: [{ role: "user", content: "hello" }],
    reasoning_effort: "low",
  });
  assert.equal(body.reasoning_effort, "high", "input must not be mutated");
});

test("Gemini 3.7 Flash uses probed reasoning_effort low, not none", () => {
  const body = {
    model: "gemini-3.7-flash",
    messages: [{ role: "user", content: "hello" }],
  };

  assert.deepEqual(adaptCheaperInferenceChatBody(body), {
    model: "gemini-3.7-flash",
    messages: [{ role: "user", content: "hello" }],
    reasoning_effort: "low",
  });
});

test("GPT-5.6 Luna disables reasoning with official effort none", () => {
  const body = {
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: "hello" }],
    reasoning: { effort: "minimal", exclude: true },
    include_reasoning: false,
  };

  assert.deepEqual(adaptCheaperInferenceChatBody(body), {
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: "hello" }],
    reasoning: { effort: "none" },
    reasoning_effort: "none",
  });
});

test("GPT-5.6 Terra disables reasoning with official effort none", () => {
  const body = {
    model: "gpt-5.6-terra",
    messages: [{ role: "user", content: "hello" }],
  };

  assert.deepEqual(adaptCheaperInferenceChatBody(body), {
    model: "gpt-5.6-terra",
    messages: [{ role: "user", content: "hello" }],
    reasoning: { effort: "none" },
    reasoning_effort: "none",
  });
});

test("DeepSeek V4 Flash disables hidden reasoning on CheaperInference", () => {
  const body = {
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "hello" }],
    reasoning: { effort: "minimal", exclude: true },
    include_reasoning: false,
  };

  assert.deepEqual(adaptCheaperInferenceChatBody(body), {
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "hello" }],
    thinking: { type: "disabled" },
  });
});

test("DeepSeek V4 Pro uses the native non-thinking switch on CheaperInference", () => {
  assert.deepEqual(
    adaptCheaperInferenceChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    }),
    {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      thinking: { type: "disabled" },
    }
  );
});
