import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_OPENROUTER_MODEL,
  callBackgroundMemory,
  resolveBackgroundMemoryFallbackModel,
  resolveBackgroundTextModelId,
} from "./ai";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V3_MODEL,
} from "./chatModels";

test("background text defaults to Cheaper Inference DeepSeek V4 Flash", () => {
  assert.equal(
    resolveBackgroundTextModelId(undefined),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(
    resolveBackgroundTextModelId(OPENROUTER_DEEPSEEK_V3_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(
    BACKGROUND_OPENROUTER_MODEL,
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
});

test("memory and rolling-summary requests keep the full input and omit output caps", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  const marker = "끝-원문-보존";
  const longInput = `${"가".repeat(60_000)}${marker}`;
  let requestBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "요약" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 30_000, completion_tokens: 10 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await callBackgroundMemory(
      "system",
      [{ role: "user", content: longInput }],
      undefined,
      "background-memory-rolling-summary"
    );

    const messages = requestBody?.messages as Array<{ content?: string }> | undefined;
    assert.ok(messages?.at(-1)?.content?.endsWith(marker));
    assert.equal(messages?.at(-1)?.content?.length, longInput.length);
    assert.equal(requestBody?.max_tokens, undefined);
    assert.deepEqual(requestBody?.thinking, { type: "disabled" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});

test("legacy or unset fallback resolves to OpenRouter DeepSeek V4 Flash", () => {
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: OPENROUTER_DEEPSEEK_V3_MODEL },
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
    ),
    OPENROUTER_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: "   " },
      "custom-model"
    ),
    OPENROUTER_DEEPSEEK_V4_FLASH_MODEL
  );
});

test("memory failure falls back from Cheaper V4 to OpenRouter V4 without caps", async () => {
  const previousFetch = globalThis.fetch;
  const previousCheaperKey = process.env.CHEAPER_INFERENCE_API_KEY;
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousFallback = process.env.BACKGROUND_MEMORY_FALLBACK_MODEL;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-cheaper-key";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.BACKGROUND_MEMORY_FALLBACK_MODEL = OPENROUTER_DEEPSEEK_V3_MODEL;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(input), body });
    if (requests.length === 1) {
      return new Response("temporary failure", { status: 503 });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "fallback summary" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 4 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await callBackgroundMemory(
      "system",
      [{ role: "user", content: "full memory source" }],
      undefined,
      "background-memory-extract"
    );

    assert.equal(result.text, "fallback summary");
    assert.deepEqual(
      requests.map(({ body }) => body.model),
      [CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL, OPENROUTER_DEEPSEEK_V4_FLASH_MODEL]
    );
    assert.equal(requests[0]?.body.max_tokens, undefined);
    assert.equal(requests[1]?.body.max_tokens, undefined);
    assert.deepEqual(requests[0]?.body.thinking, { type: "disabled" });
    assert.deepEqual(requests[1]?.body.reasoning, { effort: "none" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCheaperKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousCheaperKey;
    if (previousOpenRouterKey == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    if (previousFallback == null) delete process.env.BACKGROUND_MEMORY_FALLBACK_MODEL;
    else process.env.BACKGROUND_MEMORY_FALLBACK_MODEL = previousFallback;
  }
});
