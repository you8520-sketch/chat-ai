import assert from "node:assert/strict";
import test from "node:test";
import { callOpenRouterCompletion } from "./openRouterCompletion";

test("background DeepSeek uses Cheaper Inference and preserves cache usage", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";

  let requestedUrl = "";
  let requestedBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        model: "deepseek-v4-flash",
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 75 },
          completion_tokens_details: { reasoning_tokens: 12 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await callOpenRouterCompletion({
      model: "deepseek-v4-flash",
      system: "system",
      history: [{ role: "user", content: "hello" }],
      maxTokens: 128,
    });

    assert.equal(
      requestedUrl,
      "https://api.cheaperinference.com/v1/chat/completions"
    );
    assert.equal(requestedBody?.model, "deepseek-v4-flash");
    assert.equal(result.text, "OK");
    assert.equal(result.usage.inputTokens, 100);
    assert.equal(result.usage.outputTokens, 20);
    assert.equal(result.usage.cacheReadTokens, 75);
    assert.equal(result.usage.standardInputTokens, 25);
    assert.equal(result.usage.reasoningOutputTokens, 12);
    assert.equal(result.usage.estimated, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});
