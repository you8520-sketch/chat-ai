import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import {
  BOT_MAX_PROVIDER_ATTEMPTS,
  callTrpgBot,
  callTrpgGm,
  GM_MAX_PROVIDER_ATTEMPTS,
  GM_PROVIDER_5XX_RETRY_DELAY_MS,
  GM_RETRYABLE_HTTP_STATUSES,
  isGmRetryableHttpStatus,
} from "./gmCall";
import { isTrpgTrueOffRequest, trpgProviderRequestContract } from "./gmClient";
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

function sseCompletion(text: string, usage = { prompt_tokens: 20, completion_tokens: 12 }): Response {
  const chunks = [
    ...buildMockOpenRouterStreamChunks(text, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL).slice(0, 1),
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

function assertGmStreamTrue(body: Record<string, unknown>): void {
  const contract = trpgProviderRequestContract(body);
  assert.equal(contract.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  assert.equal(contract.thinkingType, "disabled");
  assert.equal(contract.reasoningEffort, "none");
  assert.equal(contract.stream, true);
  assert.equal(isTrpgTrueOffRequest(contract), true);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, TRPG_GM_MAX_TOKENS);
}

describe("TRPG GM provider HTTP 5xx retry", () => {
  it("pins GM two-attempt / bot one-attempt transport constants", () => {
    assert.equal(GM_MAX_PROVIDER_ATTEMPTS, 2);
    assert.equal(BOT_MAX_PROVIDER_ATTEMPTS, 1);
    assert.equal(GM_PROVIDER_5XX_RETRY_DELAY_MS, 1000);
    assert.deepEqual([...GM_RETRYABLE_HTTP_STATUSES], [500, 502, 503, 504]);
    assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(TRPG_BOT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
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
    assertGmStreamTrue(calls[0]!.body);
    assertGmStreamTrue(calls[1]!.body);
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

  it("does not retry a provider timeout / network throw", async () => {
    const { calls } = installProvider(() => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    await assert.rejects(() => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 }), /aborted due to timeout/);
    assert.equal(calls.length, 1);
  });
});
