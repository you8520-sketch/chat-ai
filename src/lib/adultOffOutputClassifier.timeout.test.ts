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
  usage: { prompt_tokens: 1500, completion_tokens: 20, cost: 0.0002 },
  cheaper_inference: {
    request_id: "classifier-1",
    billing: { status: "settled", billed_cost_usd: "0.000130", currency: "USD" },
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

  before(async () => {
    delete process.env.NODE_TEST_CONTEXT;
    installIsolatedTestDatabase();
    process.env.CHEAPER_INFERENCE_API_KEY = "test-cheaper-fixture";
    process.env.OPENROUTER_API_KEY = "test-openrouter-fixture";
    classifier = await import("@/lib/adultOffOutputClassifier");
    AbortSignal.timeout = ((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    }) as typeof AbortSignal.timeout;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      const deadline = timeouts[0] ?? Number.POSITIVE_INFINITY;
      if (responseLatencyMs > deadline) throw new DOMException("The operation timed out.", "TimeoutError");
      return new Response(responseStatus === 200 ? ALLOW_BODY : JSON.stringify({ error: { message: "upstream" } }), {
        status: responseStatus,
        headers: { "Content-Type": "application/json", "x-ci-request-id": "classifier-1" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    timeouts = [];
    fetchCalls = 0;
    responseLatencyMs = 0;
    responseStatus = 200;
  });

  after(() => {
    AbortSignal.timeout = realTimeout;
    globalThis.fetch = realFetch;
    uninstallIsolatedTestDatabase();
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    if (previousNodeTestContext == null) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = previousNodeTestContext;
    Module._load = originalLoad;
  });

  it("keeps the synchronous guard at 60 seconds when no override is given", async () => {
    assert.equal(classifier.ADULT_OFF_CLASSIFIER_TIMEOUT_MS, 60_000);
    await classifier.createAdultOffClassifier(SCOPE)("창가의 고요");
    assert.equal(timeouts[0], 60_000);
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
