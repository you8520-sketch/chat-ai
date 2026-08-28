import assert from "node:assert/strict";
import test from "node:test";
import { streamOpenRouterAdult, callOpenRouterAdult } from "./openRouterAdult";
import { parseCompatibleUsage } from "./openRouterUsage";
import { tokenUsageFromOpenRouterBreakdown } from "./openRouterUsage";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("streamOpenRouterAdult captures top-level CI billing envelope after usage chunk", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";

  globalThis.fetch = (async () =>
    sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello world." } }] })}\n\n`,
      `data: ${JSON.stringify({
        usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.01 },
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [],
        cheaper_inference: { billing: { billed_cost_usd: "0.008000" } },
      })}\n\n`,
      "data: [DONE]\n\n",
    ])) as typeof fetch;

  try {
    const gen = streamOpenRouterAdult(
      "system prompt",
      [{ role: "user", content: "hello" }],
      "gemini-3.7-flash",
      800,
      { allowOpenRouterUnderLengthRecovery: false, skipAssistantPrefill: true }
    );

    let deltaCount = 0;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        assert.equal(value.cheaperInferenceBilledCostUsd, 0.008);
        assert.equal(value.inputTokens, 1000);
        assert.equal(value.outputTokens, 200);
        break;
      }
      if (value) deltaCount += 1;
    }
    assert.ok(deltaCount >= 1);

    const breakdown = parseCompatibleUsage({
      usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.01 },
      cheaperInference: { billing: { billed_cost_usd: "0.008000" } },
    });
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, 0.008);
    assert.equal(breakdown.upstreamCostUsd, 0.01);

    const tokenUsage = tokenUsageFromOpenRouterBreakdown(breakdown);
    assert.equal(tokenUsage.cheaperInferenceBilledCostUsd, 0.008);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});

test("callOpenRouterAdult non-stream uses parseCompatibleUsage envelope precedence", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.01 },
        cheaper_inference: { billing: { billed_cost_usd: "0.008000" } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  try {
    const result = await callOpenRouterAdult(
      "system prompt",
      [{ role: "user", content: "hello" }],
      "gemini-3.7-flash",
      800,
      { allowOpenRouterUnderLengthRecovery: false, skipAssistantPrefill: true }
    );
    assert.equal(result.usage.cheaperInferenceBilledCostUsd, 0.008);
    assert.equal(result.text, "OK");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});
