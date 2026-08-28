import assert from "node:assert/strict";
import test from "node:test";
import {
  callOpenRouterCompletion,
  CompatibleCompletionError,
} from "./openRouterCompletion";

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
    assert.equal(requestedBody?.model, "deepseek-v4-flash-0731");
    assert.deepEqual(requestedBody?.thinking, { type: "disabled" });
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

test("empty completion preserves HTTP status and finish reason", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "" }, finish_reason: "length" }],
        usage: { prompt_tokens: 100, completion_tokens: 3072 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        callOpenRouterCompletion({
          model: "deepseek-v4-flash",
          system: "system",
          history: [{ role: "user", content: "hello" }],
          maxTokens: 3072,
        }),
      (error: unknown) => {
        assert.ok(error instanceof CompatibleCompletionError);
        assert.equal(error.httpStatus, 200);
        assert.equal(error.finishReason, "length");
        assert.equal(error.usage?.inputTokens, 100);
        assert.equal(error.usage?.outputTokens, 3072);
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});

test("unbounded background calls omit max_tokens and disable reasoning on both providers", async () => {
  const previousFetch = globalThis.fetch;
  const previousCheaperKey = process.env.CHEAPER_INFERENCE_API_KEY;
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-cheaper-key";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";

  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    for (const model of ["deepseek-v4-flash", "deepseek/deepseek-v4-flash"]) {
      await callOpenRouterCompletion({
        model,
        system: "system",
        history: [{ role: "user", content: "hello" }],
        maxTokens: null,
        disableReasoning: true,
        requestKind: "background-memory-extract",
      });
    }

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.body.max_tokens, undefined);
    assert.deepEqual(requests[0]?.body.thinking, { type: "disabled" });
    assert.equal(requests[1]?.body.max_tokens, undefined);
    assert.deepEqual(requests[1]?.body.reasoning, { effort: "none" });
    assert.equal(requests[1]?.body.include_reasoning, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCheaperKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousCheaperKey;
    if (previousOpenRouterKey == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  }
});

test("gemini-3.1-flash-lite routes through CheaperInference with CI model id", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  const previousOr = process.env.OPENROUTER_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  delete process.env.OPENROUTER_API_KEY;

  let requestedUrl = "";
  let requestedBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        model: "google/gemini-3.1-flash-lite",
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await callOpenRouterCompletion({
      model: "gemini-3.1-flash-lite",
      system: "system",
      history: [{ role: "user", content: "hello" }],
      maxTokens: 128,
    });

    assert.equal(
      requestedUrl,
      "https://api.cheaperinference.com/v1/chat/completions"
    );
    assert.equal(requestedBody?.model, "gemini-3.1-flash-lite");
    assert.equal(requestedBody?.reasoning_effort, "none");
    assert.equal(requestedBody?.thinking, undefined);
    assert.equal(requestedBody?.reasoning, undefined);
    assert.ok(
      !String(requestedUrl).includes("openrouter.ai"),
      "OpenRouter calls=0"
    );
    assert.equal(result.text, "OK");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
    if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOr;
  }
});
