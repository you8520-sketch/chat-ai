import Module from "node:module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { AdultOffClassifierCallError } from "@/lib/adultOffOutputGuard";
import { getDb } from "@/lib/db";

/**
 * 합성 공급자 응답으로 분류기의 클라이언트 타임아웃만 검증한다. `AbortSignal.timeout`이 받은 값을 기록하고,
 * 가상 응답 지연이 그 값을 넘으면 실제 타임아웃과 같은 TimeoutError로 fetch를 끝낸다(실제로 26초를 기다리지 않는다).
 */

const SCOPE = { chatId: 1, assistantMessageId: 1, generationSequence: 0, generationRequestId: null };
const ALLOW_BODY = JSON.stringify({
  id: "classifier-1",
  model: "gpt-6-luna",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify({ decision: "allow", category: "none", confidence: "high", first_paragraph: -1 }),
      },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 1500,
    completion_tokens: 20,
    total_tokens: 1520,
    prompt_tokens_details: { cached_tokens: 1400 },
    completion_tokens_details: { reasoning_tokens: 0 },
  },
});

type ClassifierModule = typeof import("@/lib/adultOffOutputClassifier");

describe("adult-off classifier client timeout", () => {
  let classifier: ClassifierModule;
  const realFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  const previousNodeTestContext = process.env.NODE_TEST_CONTEXT;
  let timeouts: number[] = [];
  let fetchCalls = 0;
  let responseLatencyMs = 0;
  let responseStatus = 200;
  let bodyReadAbort = false;
  let lastUrl = "";
  let lastBody: Record<string, unknown> | null = null;
  let previousOpenAiKey: string | undefined;

  before(async () => {
    delete process.env.NODE_TEST_CONTEXT;
    installIsolatedTestDatabase();
    previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-fixture";
    classifier = await import("@/lib/adultOffOutputClassifier");
    AbortSignal.timeout = ((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    }) as typeof AbortSignal.timeout;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes("/chat/completions")) {
        return new Response(JSON.stringify({ rates: { KRW: 1400 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      fetchCalls += 1;
      lastUrl = url;
      lastBody = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const deadline = timeouts[0] ?? Number.POSITIVE_INFINITY;
      if (responseLatencyMs > deadline) throw new DOMException("The operation timed out.", "TimeoutError");
      if (bodyReadAbort) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            "Content-Type": "application/json",
            "x-request-id": "req_body_abort",
          }),
          text: async () => {
            throw new DOMException("The operation was aborted.", "AbortError");
          },
        } as Response;
      }
      return new Response(responseStatus === 200 ? ALLOW_BODY : JSON.stringify({ error: { message: "upstream" } }), {
        status: responseStatus,
        headers: { "Content-Type": "application/json", "x-request-id": "req_classifier_1" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    timeouts = [];
    fetchCalls = 0;
    responseLatencyMs = 0;
    responseStatus = 200;
    bodyReadAbort = false;
  });

  after(() => {
    AbortSignal.timeout = realTimeout;
    globalThis.fetch = realFetch;
    uninstallIsolatedTestDatabase();
    if (previousOpenAiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousNodeTestContext == null) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = previousNodeTestContext;
    Module._load = originalLoad;
  });

  it("keeps the synchronous guard at 60 seconds when no override is given", async () => {
    assert.equal(classifier.ADULT_OFF_CLASSIFIER_TIMEOUT_MS, 60_000);
    const result = await classifier.createAdultOffClassifier(SCOPE)("창가의 고요");
    assert.equal(timeouts[0], 60_000);
    assert.equal(lastUrl, "https://api.openai.com/v1/chat/completions");
    assert.equal(lastBody?.max_completion_tokens, 200);
    assert.equal(lastBody?.reasoning_effort, "none");
    assert.equal(lastBody?.max_tokens, undefined);
    assert.equal((lastBody?.response_format as { type?: string } | undefined)?.type, "json_schema");
    assert.equal(result.usage.providerRequestId, "req_classifier_1");
    assert.equal(result.usage.costUsd, null);
    const row = getDb()
      .prepare(
        `SELECT requested_provider, actual_provider, provider_request_id, input_tokens, output_tokens,
                cache_read_tokens, reasoning_tokens, actual_cost_usd, actual_cost_source, event_status,
                cheaper_inference_billed_cost_usd
           FROM api_cost_ledger
          WHERE request_kind='adult-off-output-moderation'
          ORDER BY id DESC LIMIT 1`
      )
      .get() as {
      requested_provider: string;
      actual_provider: string;
      provider_request_id: string | null;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      reasoning_tokens: number | null;
      actual_cost_usd: number | null;
      actual_cost_source: string | null;
      event_status: string | null;
      cheaper_inference_billed_cost_usd: number | null;
    };
    assert.equal(row.requested_provider, "openai");
    assert.equal(row.actual_provider, "openai");
    assert.equal(row.provider_request_id, "req_classifier_1");
    assert.equal(row.input_tokens, 1500);
    assert.equal(row.output_tokens, 20);
    assert.equal(row.cache_read_tokens, 1400);
    assert.equal(row.reasoning_tokens, 0);
    assert.equal(row.actual_cost_usd, null);
    assert.equal(row.actual_cost_source, "unavailable");
    assert.equal(row.event_status, "completed_without_exact_cost");
    assert.equal(row.cheaper_inference_billed_cost_usd, null);
  });

  it("applies an explicit shorter override to the same classifier path", async () => {
    await classifier.createAdultOffClassifier(SCOPE, { timeoutMs: 25_000 })("창가의 고요");
    assert.equal(timeouts[0], 25_000);
  });

  it("completes a 26.7 second normal response under the default limit but times out with a 25 second override", async () => {
    responseLatencyMs = 26_700;
    const result = await classifier.createAdultOffClassifier(SCOPE)("창가의 고요");
    assert.equal(result.verdict.decision, "allow");
    assert.equal(result.usage.outcome, "ok");
    assert.equal(fetchCalls, 1);

    fetchCalls = 0;
    timeouts = [];
    await assert.rejects(
      () => classifier.createAdultOffClassifier(SCOPE, { timeoutMs: 25_000 })("창가의 고요"),
      (error: unknown) => error instanceof AdultOffClassifierCallError && error.outcome === "timeout"
    );
    assert.equal(fetchCalls, 1, "a timeout is a single attempt");
  });

  it("still fails a response slower than the default limit, without any automatic retry", async () => {
    responseLatencyMs = 60_500;
    await assert.rejects(
      () => classifier.createAdultOffClassifier(SCOPE)("창가의 고요"),
      (error: unknown) => error instanceof AdultOffClassifierCallError && error.outcome === "timeout"
    );
    assert.equal(fetchCalls, 1);
  });

  it("finalizes the ledger when response.text() aborts after HTTP 200 headers", async () => {
    bodyReadAbort = true;
    await assert.rejects(
      () => classifier.createAdultOffClassifier(SCOPE)("창가의 고요"),
      (error: unknown) =>
        error instanceof AdultOffClassifierCallError &&
        error.outcome === "timeout" &&
        error.usage.providerRequestId === "req_body_abort" &&
        error.usage.httpStatus === 200
    );
    assert.equal(fetchCalls, 1);
    const row = getDb()
      .prepare(
        `SELECT provider_request_id, event_status
           FROM api_cost_ledger
          WHERE request_kind='adult-off-output-moderation'
          ORDER BY id DESC LIMIT 1`
      )
      .get() as { provider_request_id: string | null; event_status: string | null };
    assert.equal(row.provider_request_id, "req_body_abort");
    assert.equal(row.event_status, "failed_without_usage");
  });

  it("does not retry an HTTP failure under the default limit", async () => {
    responseStatus = 503;
    await assert.rejects(
      () => classifier.createAdultOffClassifier(SCOPE)("창가의 고요"),
      (error: unknown) =>
        error instanceof AdultOffClassifierCallError &&
        error.outcome === "http_error" &&
        error.usage.httpStatus === 503
    );
    assert.equal(fetchCalls, 1);
  });

  it("rejects a non-positive or non-finite timeout instead of silently disabling it", () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => classifier.createAdultOffClassifier(SCOPE, { timeoutMs }), RangeError);
    }
  });
});
