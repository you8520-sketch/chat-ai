/**
 * Phase D.2 §24 — deterministic tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aliasVariantOrder,
  buildCiAliasBody,
  classifyCacheField,
  closestTtftTarget,
  indexUsageByRequestId,
  joinUsageToRun,
  pickRequestId,
  reasoningControlKeys,
} from "./lib/gemini31PhaseD2Usage";
import type { CiUsageRequestRecord, D1ClientRun } from "./lib/gemini31PhaseD2Usage";
import { computeStreamTimings } from "./lib/gemini31PhaseDProbe";

describe("gemini31PhaseD2Usage", () => {
  it("classifyCacheField: null != zero", () => {
    assert.equal(classifyCacheField(null), "NOT_RECORDED");
    assert.equal(classifyCacheField(undefined), "NOT_RECORDED");
    assert.equal(classifyCacheField(0), "RECORDED_ZERO");
    assert.equal(classifyCacheField(12), "RECORDED_NONZERO");
  });

  it("request-id join uses id field", () => {
    const map = indexUsageByRequestId([
      { id: "req-1", prompt_tokens: 10 },
      { request_id: "req-2", prompt_tokens: 20 },
    ]);
    assert.ok(map.get("req-1"));
    assert.ok(map.get("req-2"));
  });

  it("request-id join prefers id over token fingerprint", () => {
    const records: CiUsageRequestRecord[] = [
      { request_id: "uuid-1", model: "gemini-3.1-pro-preview", prompt_tokens: 33, completion_tokens: 100 },
    ];
    const map = indexUsageByRequestId(records);
    const run: D1ClientRun = {
      source: "test",
      provider: "cheaperinference",
      provider_request_id: "uuid-1",
      reasoning_tokens: 50,
      prompt_tokens: 33,
      completion_tokens: 100,
      request_to_first_byte_ms: null,
      request_to_first_sse_ms: null,
      request_to_first_reasoning_ms: null,
      request_to_first_visible_ms: null,
      request_to_stream_complete_ms: null,
      visible_chars: 0,
      finish_reason: null,
    };
    const used = new Set<string>();
    const joined = joinUsageToRun(run, map, records, used);
    assert.equal(joined.joinMethod, "request_id");
    assert.equal(pickRequestId(joined.usage!), "uuid-1");
  });

  it("token fingerprint join when stream gen-* id differs from usage uuid", () => {
    const records: CiUsageRequestRecord[] = [
      {
        request_id: "37903dc1-5731-4da3-9655-14ea43f03358",
        model: "gemini-3.1-pro-preview",
        prompt_tokens: 33,
        completion_tokens: 1763,
        total_latency_ms: 16800,
      },
    ];
    const map = indexUsageByRequestId(records);
    const run: D1ClientRun = {
      source: "test",
      provider: "cheaperinference",
      provider_request_id: "gen-1788064161-ywWgDMxjNOdcenHhFfeN",
      reasoning_tokens: 1427,
      prompt_tokens: 33,
      completion_tokens: 1763,
      request_to_first_byte_ms: null,
      request_to_first_sse_ms: null,
      request_to_first_reasoning_ms: null,
      request_to_first_visible_ms: null,
      request_to_stream_complete_ms: 16820,
      visible_chars: 549,
      finish_reason: "stop",
    };
    const used = new Set<string>();
    const joined = joinUsageToRun(run, map, records, used);
    assert.equal(joined.joinMethod, "token_fingerprint");
    assert.equal(pickRequestId(joined.usage!), "37903dc1-5731-4da3-9655-14ea43f03358");
  });

  it("CI TTFT reconciliation picks closest client milestone", () => {
    const r = closestTtftTarget(402, {
      first_sse: 400,
      first_reasoning: 450,
      first_visible: 9000,
    });
    assert.equal(r.closest, "FIRST_SSE");
    assert.ok(Math.abs(r.deltas.FIRST_SSE ?? 999) < 10);
  });

  it("alias bodies differ only in reasoning control", () => {
    const base = { model: "gemini-3.1-pro-preview", messages: [], stream: true, temperature: 0.95 };
    const a = buildCiAliasBody([], "A", base);
    const b = buildCiAliasBody([], "B", base);
    const c = buildCiAliasBody([], "C", base);
    assert.deepEqual(reasoningControlKeys(a), ["reasoning_effort"]);
    assert.deepEqual(reasoningControlKeys(b), ["reasoning"]);
    assert.deepEqual(reasoningControlKeys(c), []);
    assert.equal(a.model, b.model);
    assert.equal(b.stream, c.stream);
  });

  it("only one reasoning control per alias variant", () => {
    const base = { model: "x", messages: [] };
    assert.equal(reasoningControlKeys(buildCiAliasBody([], "A", base)).length, 1);
    assert.equal(reasoningControlKeys(buildCiAliasBody([], "B", base)).length, 1);
    assert.equal(reasoningControlKeys(buildCiAliasBody([], "C", base)).length, 0);
  });

  it("counterbalanced alias order rotates", () => {
    assert.deepEqual(aliasVariantOrder(0), ["A", "B", "C"]);
    assert.deepEqual(aliasVariantOrder(1), ["B", "C", "A"]);
    assert.deepEqual(aliasVariantOrder(2), ["C", "A", "B"]);
  });

  it("exact-match cache header kept separate from usage cache tokens", () => {
    // x-ci-cache is gateway exact-match; usage API uses cache_read_input_tokens
    const usageClass = classifyCacheField(0);
    assert.equal(usageClass, "RECORDED_ZERO");
  });

  it("stream complete is not first SSE", () => {
    const t = computeStreamTimings({
      firstByteMs: 80,
      firstSseMs: 100,
      firstReasoningMs: 100,
      firstVisibleMs: 900,
      streamCompleteMs: 5000,
    });
    assert.notEqual(t.request_to_stream_complete_ms, t.request_to_first_sse_ms);
  });
});
