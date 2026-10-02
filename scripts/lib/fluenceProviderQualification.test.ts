import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import { executeCompatibleSupplyProbe } from "./compatibleSupplyProbe";
import {
  adaptFluenceQualificationBody, buildFluenceComparisonRequests, buildFluencePreparation,
  resolveFluenceBenchmarkCredentials, runFluenceComparison, summarizeFluencePriceHistory,
  validateFluenceOffer, type FluenceOffer,
} from "./fluenceProviderQualification";

// Synthetic contract fields are NOT claims about the real Fluence API.
function offer(): FluenceOffer {
  return {
    logicalModelId: MAIN_RP_USER_SELECTABLE_OPTIONS[0].id,
    wireModelId: "fixture-exact-logical-model", offerId: "synthetic-offer", upstreamProvider: "synthetic-upstream",
    observedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    evidenceSource: "synthetic-test-only", identityEvidence: "synthetic mapping", controlParityEvidence: "synthetic canonical controls support",
    supportedRequestKeys: ["model", "messages", "stream", "stream_options", "max_tokens", "temperature", "top_p", "thinking", "reasoning_effort", "reasoning", "include_reasoning", "output_config", "frequency_penalty", "presence_penalty", "repetition_penalty", "seed", "fixture_route", "fixture_zdr"],
    structuredCacheControlSupported: true, maxContextTokens: 1_000_000,
    routing: { request: { fixture_route: "synthetic-upstream" }, evidence: "synthetic pin" },
    zdr: { available: true, request: { fixture_zdr: true }, evidence: "synthetic ZDR" },
    contentPermissionEvidence: null,
    currentOffer: { inputUsdPerMillion: 1, outputUsdPerMillion: 2, cacheReadUsdPerMillion: null },
    referenceCeiling: null, longContext: null, billedCost: null,
  };
}

const optIn = {
  REGULAR_TEST_REAL_PROVIDER_CALLS: "1", FLUENCE_PROVIDER_QUALIFICATION: "1",
  FLUENCE_BENCHMARK_API_KEY: "synthetic-fluence-benchmark",
  CHEAPER_INFERENCE_BENCHMARK_API_KEY: "synthetic-ci-benchmark",
  OPENROUTER_SUPPLY_BENCHMARK_API_KEY: "synthetic-or-benchmark",
};

function stream(text: string, model = "fixture-exact-logical-model", usage?: Record<string, unknown>) {
  const events = [
    `: comment\r\n`,
    `data: ${JSON.stringify({ id: "synthetic-response", model, provider: "synthetic-upstream", choices: [{ delta: { content: text } }] })}\r\n`,
    `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }], ...(usage ? { usage } : {}) })}\r\n`,
    "data: [DONE]", // No final newline; exercise decoder flush.
  ].join("");
  const bytes = new TextEncoder().encode(events);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    // Split both SSE frames and UTF-8 codepoints.
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream", "x-request-id": "synthetic-request" } });
}

describe("Fluence offline qualification isolation", () => {
  it("never borrows production credentials and never calls either provider when blocked", async () => {
    let calls = 0;
    const result = await runFluenceComparison({ offer: offer(), env: {
      REGULAR_TEST_REAL_PROVIDER_CALLS: "1", FLUENCE_PROVIDER_QUALIFICATION: "1",
      FLUENCE_API_KEY: "synthetic-production-key", OPENROUTER_API_KEY: "synthetic-production-key", CHEAPER_INFERENCE_API_KEY: "synthetic-production-key",
    }, fetchImpl: async () => { calls++; throw new Error("must not fetch"); } });
    assert.equal(result.status, "BLOCKED_WAITLIST_CREDENTIAL");
    assert.equal(result.providerCalls, 0);
    assert.equal(calls, 0);
    for (const missing of ["REGULAR_TEST_REAL_PROVIDER_CALLS", "FLUENCE_PROVIDER_QUALIFICATION"]) {
      assert.equal(resolveFluenceBenchmarkCredentials({ ...optIn, [missing]: "0" }, offer().logicalModelId).ok, false);
    }
  });

  it("prepares canonical logical models without adding a production route or claiming live results", () => {
    const report = buildFluencePreparation();
    assert.deepEqual(report.packet.activeModelIds, MAIN_RP_USER_SELECTABLE_OPTIONS.map(o => o.id));
    assert.equal(report.providerCalls, 0);
    assert.equal(report.offer, null);
    assert.equal(report.adultQualification.policyConfirmed, false);
    assert.equal(report.actualBilledUsd, null);
    assert.equal(report.endpointClaim.independentlyVerified, false);
    assert.ok(MAIN_RP_USER_SELECTABLE_OPTIONS.every(o => o.provider !== ("fluence" as string)));
  });

  it("preserves prompt, length, reasoning and CI affinity for every active logical model", () => {
    for (const option of MAIN_RP_USER_SELECTABLE_OPTIONS) {
      const candidate = { ...offer(), logicalModelId: option.id };
      for (const request of buildFluenceComparisonRequests(candidate)) {
        assert.deepEqual(request.candidateBody.messages, request.currentBody.messages);
        for (const key of ["max_tokens", "thinking", "reasoning", "reasoning_effort", "output_config"]) {
          assert.deepEqual(request.candidateBody[key], request.currentBody[key]);
        }
        assert.equal(request.currentProvider, option.provider);
        assert.equal(request.candidateBody.stream, true);
        assert.equal(request.candidateBody.session_id, undefined);
        assert.equal(request.candidateBody.service_tier, undefined);
        if (option.provider === "cheaperinference") assert.match(request.currentEndpoint, /x-ci-prompt-cache-session=/);
      }
    }
  });

  it("uses canonical regeneration, continuation and frozen long-context assembly", () => {
    const plain = buildFluenceComparisonRequests(offer());
    for (const operation of ["regeneration", "continuation", "long_context"] as const) {
      const requests = buildFluenceComparisonRequests(offer(), operation);
      assert.notEqual(requests[0].promptSha256, plain[0].promptSha256);
      assert.deepEqual(requests[0].candidateBody.messages, requests[0].currentBody.messages);
      if (operation === "long_context") assert.ok(requests[0].estimatedPromptTokens > plain[0].estimatedPromptTokens);
    }
  });

  it("rejects stale offers, unproven controls, cache changes, ZDR gaps and control overrides", () => {
    assert.throws(() => validateFluenceOffer({ ...offer(), expiresAt: "2000-01-01" }), /stale/);
    const body = { model: "ci-id", messages: [{ role: "system", content: [{ type: "text", text: "fixture", cache_control: { type: "ephemeral" } }] }], thinking: { type: "disabled" } };
    assert.throws(() => adaptFluenceQualificationBody(body, { ...offer(), supportedRequestKeys: ["model"] }), /unsupported_canonical/);
    assert.throws(() => adaptFluenceQualificationBody(body, { ...offer(), structuredCacheControlSupported: false }), /cache_control/);
    assert.throws(() => adaptFluenceQualificationBody(body, { ...offer(), zdr: { available: null, request: {}, evidence: null } }), /zdr_unconfirmed/);
    assert.throws(() => adaptFluenceQualificationBody(body, { ...offer(), routing: { request: { thinking: { type: "enabled" } }, evidence: "fixture" } }), /canonical_control_override/);
    assert.throws(() => adaptFluenceQualificationBody(body, { ...offer(), routing: { request: { max_tokens: 1 }, evidence: "fixture" } }), /canonical_control_override/);
  });

  it("collects four factual results without inventing billing, reasoning or qualification success", async () => {
    let calls = 0;
    const report = await runFluenceComparison({ offer: offer(), env: optIn, fetchImpl: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      return stream("검증 응답", body.model, { prompt_tokens: 15, completion_tokens: 7, cost: 999 });
    } });
    assert.equal(calls, 4);
    assert.equal(report.status, "ROOT_CAUSE_UNCONFIRMED");
    assert.equal(report.results.length, 4);
    for (const result of report.results) {
      assert.equal(result.rawOutput, "검증 응답");
      assert.equal(result.reasoningTokens, null);
      assert.equal(result.promptTokens, 15);
      assert.equal(result.outputTokens, 7);
    }
    const candidate = report.results.find(r => r.side === "fluence")!;
    assert.equal(candidate.actualBilledUsd, null);
    assert.equal(candidate.unclassifiedReportedCost, 999);
    assert.equal(candidate.responseId, "synthetic-response");
  });

  it("captures documented USD including zero, independently of token estimates", async () => {
    const candidate = { ...offer(), billedCost: { jsonPointer: "/usage/actual_usd", currency: "USD" as const, evidence: "synthetic billed-field docs" } };
    const report = await runFluenceComparison({ offer: candidate, env: optIn, fetchImpl: async (_url, init) => stream("검증", JSON.parse(String(init?.body)).model, { actual_usd: 0 }) });
    const result = report.results.find(r => r.side === "fluence")!;
    assert.equal(result.actualBilledUsd, 0);
    assert.equal(result.outputTokens, null);
  });

  it("stops a mismatched provider model before further spend", async () => {
    let calls = 0;
    const report = await runFluenceComparison({ offer: offer(), env: optIn, fetchImpl: async (_url, init) => {
      calls++;
      return stream("検証", calls === 2 ? "wrong-model" : JSON.parse(String(init?.body)).model);
    } });
    assert.equal(report.status, "QUALIFICATION_FAILED");
    assert.equal(calls, 2);
  });

  it("prepares separate 7/30-day price windows without turning spot rates into point prices", () => {
    assert.equal(summarizeFluencePriceHistory([offer()], 7).status, "INSUFFICIENT_HISTORY");
    assert.equal(summarizeFluencePriceHistory([], 30).minInputUsdPerMillion, null);
    assert.throws(() => summarizeFluencePriceHistory([offer(), { ...offer(), upstreamProvider: "other" }], 7), /mixed_offer/);
  });
});

describe("shared compatible qualification transport failures", () => {
  const probe = (fetchImpl: typeof fetch, overrides = {}) => executeCompatibleSupplyProbe({ endpoint: "https://example.invalid/v1/chat/completions", headers: {}, body: { stream: true }, timeoutMs: 1000, strict: true, fetchImpl, ...overrides });
  it("decodes fragmented UTF-8/SSE and records TTFT using one clock", async () => {
    let clock = 0;
    const result = await probe(async () => stream("한국어"), { now: () => clock += 10 });
    assert.equal(result.text, "한국어");
    assert.equal(result.sawDone, true);
    assert.ok(result.ttftSeconds! > 0 && result.ttftSeconds! <= result.totalSeconds);
    assert.equal(result.error, null);
  });
  it("retains 429/5xx status with exactly one request", async () => {
    for (const status of [429, 500, 502, 503]) {
      let calls = 0;
      const result = await probe(async () => { calls++; return new Response("synthetic sensitive error", { status }); });
      assert.equal(result.error, `http_${status}`);
      assert.equal(calls, 1);
    }
  });
  it("rejects malformed streams, provider errors, disconnects and non-SSE responses", async () => {
    for (const [data, expected] of [["data: {bad}\n", "malformed_stream"], ['data: {"error":{"message":"sensitive"}}\n', "provider_stream_error"], ['data: {"choices":[{"delta":{"content":"partial"}}]}\n', "incomplete_stream"]]) {
      assert.equal((await probe(async () => new Response(data, { headers: { "content-type": "text/event-stream" } }))).error, expected);
    }
    assert.equal((await probe(async () => new Response("json"))).error, "unexpected_content_type");
  });
  it("preserves partial reported usage without inventing missing fields", async () => {
    const response = await probe(async () => new Response([
      'data: {"choices":[{"delta":{"content":"검증"}}],"usage":{"prompt_tokens":12,"actual_usd":0}}\n',
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"completion_tokens":3}}\n',
      'data: [DONE]\n',
    ].join(""), { headers: { "content-type": "text/event-stream" } }));
    assert.deepEqual(response.usage, { prompt_tokens: 12, completion_tokens: 3, actual_usd: 0 });
    assert.equal(response.envelope?.usage, response.usage);
  });
  it("cancels pending readers on timeout and explicit disconnect", async () => {
    let cancelled = 0;
    const pending = async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": "text/event-stream" } });
    // Keep the deterministic mock process alive for AbortSignal's unref timer.
    const timer = setTimeout(() => {}, 1000);
    try {
      assert.equal((await probe(pending, { timeoutMs: 20 })).error, "timeout");
      const abort = new AbortController();
      const result = probe(pending, { signal: abort.signal });
      setTimeout(() => abort.abort(), 10);
      assert.equal((await result).error, "cancelled");
      assert.equal(cancelled, 2);
    } finally { clearTimeout(timer); }
  });
  it("does not count a pre-cancelled request as a provider call", async () => {
    const abort = new AbortController();
    abort.abort();
    let calls = 0;
    const result = await probe(async () => { calls++; return stream("unused"); }, { signal: abort.signal });
    assert.equal(calls, 0);
    assert.equal(result.requestStarted, false);
    assert.equal(result.error, "cancelled");
  });
});
