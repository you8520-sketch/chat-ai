import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TextEncoder } from "node:util";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import {
  BOT_MAX_PROVIDER_ATTEMPTS,
  callTrpgBot,
  callTrpgGm,
  GM_MAX_PROVIDER_ATTEMPTS,
  GM_PROVIDER_5XX_RETRY_DELAY_MS,
  GM_RETRYABLE_HTTP_STATUSES,
  isGmRetryableHttpStatus,
} from "./gmCall";
import { isTrpgGeminiLowReasoningRequest, trpgProviderRequestContract } from "./gmClient";
import { extractTrpgHttpStatus } from "./startFailure";
import { mockReadableStreamFromText, buildMockOpenRouterStreamChunks } from "@/lib/mockApiMode";
import { TRPG_BOT_MODEL, TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "./types";

const GM_OK = `<<<NARRATION>>>
문이 천천히 열린다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false}`;

type CapturedRequest = { url: string; body: Record<string, unknown> };

const previousFetch = globalThis.fetch;
const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
const previousMock = process.env.MOCK_MODE;

afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
  else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  if (previousMock === undefined) delete process.env.MOCK_MODE;
  else process.env.MOCK_MODE = previousMock;
});

function installProvider(handler: (call: number, body: Record<string, unknown>) => Response): {
  calls: CapturedRequest[];
} {
  delete process.env.MOCK_MODE;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-trpg-gm-retry";
  const calls: CapturedRequest[] = [];
  let n = 0;
  globalThis.fetch = (async (input, init) => {
    n += 1;
    const url = String(input);
    const raw = String(init?.body ?? "");
    const body = JSON.parse(raw) as Record<string, unknown>;
    calls.push({ url, body });
    return handler(n, body);
  }) as typeof fetch;
  return { calls };
}

function httpError(status: number, text = "provider down"): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

function sseCompletion(
  text: string,
  usage = { prompt_tokens: 20, completion_tokens: 12 },
  modelId: string = TRPG_GM_MODEL
): Response {
  const chunks = [
    ...buildMockOpenRouterStreamChunks(text, modelId).slice(0, 1),
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage,
    })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(mockReadableStreamFromText(chunks), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function completion(text: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 20, completion_tokens: 12 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function assertGmStreamGemini(body: Record<string, unknown>): void {
  const contract = trpgProviderRequestContract(body);
  assert.equal(contract.model, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  assert.equal(contract.thinkingType, "");
  assert.equal(contract.reasoningEffort, "low");
  assert.equal(contract.stream, true);
  assert.equal(isTrpgGeminiLowReasoningRequest(contract), true);
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, TRPG_GM_MAX_TOKENS);
}

describe("TRPG GM provider HTTP 5xx retry", () => {
  it("pins GM two-attempt / bot one-attempt transport constants", () => {
    assert.equal(GM_MAX_PROVIDER_ATTEMPTS, 2);
    assert.equal(BOT_MAX_PROVIDER_ATTEMPTS, 1);
    assert.equal(GM_PROVIDER_5XX_RETRY_DELAY_MS, 1000);
    assert.deepEqual([...GM_RETRYABLE_HTTP_STATUSES], [500, 502, 503, 504]);
    assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(TRPG_BOT_MODEL, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    for (const status of [500, 502, 503, 504]) assert.equal(isGmRetryableHttpStatus(status), true);
    for (const status of [400, 401, 403, 404, 422, 429]) assert.equal(isGmRetryableHttpStatus(status), false);
  });

  it("A: retries GM 502 then succeeds on 200", async () => {
    const { calls } = installProvider((n) => (n === 1 ? httpError(502) : sseCompletion(GM_OK)));
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.equal(calls.length, 2);
    assert.equal(result.text, GM_OK);
    assert.equal(result.usage?.inputTokens, 20);
  });

  it("B: GM 503 then 503 stays provider_http with final status 503", async () => {
    const { calls } = installProvider(() => httpError(503, "busy"));
    await assert.rejects(
      () => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 }),
      (error: unknown) => {
        assert.equal(extractTrpgHttpStatus(error), 503);
        assert.match((error as Error).message, /\[TRPG\] 503/);
        return true;
      }
    );
    assert.equal(calls.length, 2);
  });

  it("C: GM 400 is not retried", async () => {
    const { calls } = installProvider(() => httpError(400, "bad request"));
    await assert.rejects(
      () => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 }),
      (error: unknown) => {
        assert.equal(extractTrpgHttpStatus(error), 400);
        return true;
      }
    );
    assert.equal(calls.length, 1);
  });

  it("D: first-call GM 200 uses one attempt", async () => {
    const { calls } = installProvider(() => sseCompletion(GM_OK));
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.equal(calls.length, 1);
    assert.equal(result.text, GM_OK);
  });

  it("E: bot 502 is not retried", async () => {
    const { calls } = installProvider(() => httpError(502));
    await assert.rejects(
      () => callTrpgBot({ system: "sys", user: "행동", timeoutMs: 5_000 }),
      (error: unknown) => {
        assert.equal(extractTrpgHttpStatus(error), 502);
        return true;
      }
    );
    assert.equal(calls.length, 1);
  });

  it("I: both GM attempts send the same already-adapted true-OFF body", async () => {
    const retryLogs: Array<Record<string, unknown>> = [];
    const previousInfo = console.info;
    console.info = ((...args: unknown[]) => {
      if (args[0] === "[TRPG][gm] provider_retry" && args[1] && typeof args[1] === "object") {
        retryLogs.push(args[1] as Record<string, unknown>);
      }
      previousInfo.apply(console, args as []);
    }) as typeof console.info;
    const { calls } = installProvider((n) => (n === 1 ? httpError(502) : sseCompletion(GM_OK)));
    try {
      await callTrpgGm({ system: "sys", user: "같은 입력", timeoutMs: 5_000 });
    } finally {
      console.info = previousInfo;
    }
    assert.equal(calls.length, 2);
    assertGmStreamGemini(calls[0]!.body);
    assertGmStreamGemini(calls[1]!.body);
    assert.deepEqual(calls[0]!.body, calls[1]!.body);
    assert.equal(calls[0]!.body.model, calls[1]!.body.model);
    assert.deepEqual(calls[0]!.body.messages, calls[1]!.body.messages);
    assert.equal(calls[0]!.body.max_tokens, calls[1]!.body.max_tokens);
    assert.equal(retryLogs.length, 1);
    assert.equal(retryLogs[0]?.attempt, 2);
    assert.equal(retryLogs[0]?.previousHttpStatus, 502);
    assert.equal(retryLogs[0]?.delayMs, GM_PROVIDER_5XX_RETRY_DELAY_MS);
  });

  it("does not retry empty completion after HTTP 200", async () => {
    const { calls } = installProvider(() => sseCompletion("   "));
    await assert.rejects(() => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 }), /empty completion/);
    assert.equal(calls.length, 1);
  });

  it("GM SSE usage.modelId matches the actual Gemini model used for the call", async () => {
    const { calls } = installProvider(() => sseCompletion(GM_OK));
    const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body.model, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(result.usage?.modelId, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  });

  it("Bot usage.modelId matches Gemini 3.7 Flash", async () => {
    const { calls } = installProvider(() =>
      completion(`행동 prose\n\n<<<ACTION_TYPE>>>\nfree\n\n<<<INTENT>>>\n조사한다.`)
    );
    const result = await callTrpgBot({ system: "sys", user: "행동", timeoutMs: 5_000 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body.model, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(result.usage?.modelId, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(calls[0]!.body.stream, false);
    assert.equal(calls[0]!.body.reasoning_effort, "low");
    assert.equal(calls[0]!.body.thinking, undefined);
    assert.equal(calls[0]!.body.reasoning, undefined);
  });

  it("does not retry a provider timeout / network throw", async () => {
    const { calls } = installProvider(() => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    await assert.rejects(() => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 }), /aborted due to timeout/);
    assert.equal(calls.length, 1);
  });
});

describe("TRPG GM provider SSE stream semantics", () => {
  it("SSE_UTF8_REAL_BYTE_SPLIT_PASS through single streaming TextDecoder", async () => {
    delete process.env.MOCK_MODE;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-stream";
    const korean = "한글 장면";
    const fullText = `<<<NARRATION>>>\n${korean}\n<<<DELTA>>>\n{}`;
    const payload = JSON.stringify({ choices: [{ delta: { content: fullText } }] });
    const line = `data: ${payload}\n\n`;
    const usageLine = `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 6 },
    })}\n\n`;
    const bytes = new TextEncoder().encode(`${line}${usageLine}data: [DONE]\n\n`);
    const hanIndex = line.indexOf("한");
    const splitAt = new TextEncoder().encode(line.slice(0, hanIndex)).length + 1;

    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, splitAt));
            controller.enqueue(bytes.slice(splitAt));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;

    try {
      const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
      assert.match(result.text, /한글 장면/, "SSE_UTF8_REAL_BYTE_SPLIT_PASS=true");
      assert.equal(result.usage?.inputTokens, 4);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
      if (previousMock === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = previousMock;
    }
  });

  it("SSE_DONE_TERMINATES_READ without waiting for hanging stream EOF", async () => {
    delete process.env.MOCK_MODE;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-stream";
    const text = GM_OK;
    const contentLine = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    const usageLine = `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 6 },
    })}\n\n`;
    const bytes = new TextEncoder().encode(`${contentLine}${usageLine}data: [DONE]\n\n`);

    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;

    try {
      const result = await Promise.race([
        callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("hung waiting for EOF")), 2_000);
        }),
      ]);
      assert.match(result.text, /<<<NARRATION>>>/, "SSE_DONE_TERMINATES_READ=true");
      assert.equal(result.usage?.outputTokens, 6, "SSE_FINAL_USAGE_PRESERVED=true");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
      if (previousMock === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = previousMock;
    }
  });

  it("GM_FIRST_CONTENT_MEASURABLE vs GM_FIRST_NARRATION_MEASURABLE", async () => {
    delete process.env.MOCK_MODE;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-stream";
    const text = GM_OK;
    const preMarker = "<<<NARR";
    const rest = "ATION>>>\n문이 천천히 열린다.\n<<<DELTA>>>\n{}";
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: preMarker } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: rest } }] })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      })}\n\n`,
      "data: [DONE]\n\n",
    ];
    globalThis.fetch = (async () =>
      new Response(mockReadableStreamFromText(chunks), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })) as typeof fetch;

    let firstContentMs: number | null = null;
    let firstNarrationMs: number | null = null;
    try {
      await callTrpgGm({
        system: "sys",
        user: "장면",
        timeoutMs: 5_000,
        stream: {
          onProviderTimings: (timings) => {
            if (timings.firstChunkAtMs != null) {
              firstContentMs = timings.firstChunkAtMs - timings.startAtMs;
            }
            if (timings.firstNarrationAtMs != null) {
              firstNarrationMs = timings.firstNarrationAtMs - timings.startAtMs;
            }
          },
        },
      });
      assert.ok(firstContentMs != null && firstContentMs >= 0, "GM_FIRST_CONTENT_MEASURABLE=true");
      assert.ok(firstNarrationMs != null && firstNarrationMs >= 0, "GM_FIRST_NARRATION_MEASURABLE=true");
      assert.ok(
        firstNarrationMs! >= firstContentMs!,
        "first narration is not before first provider content"
      );
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
      if (previousMock === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = previousMock;
    }
  });
});
