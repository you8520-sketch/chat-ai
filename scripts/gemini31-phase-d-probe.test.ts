/**
 * Phase D / D.1 — deterministic diagnostic tests (no live API).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCiDiagnosticBody,
  buildContinuityAssistantMessage,
  buildOpenRouterLowBody,
  buildRequestParityInventory,
  computeStreamTimings,
  inventorySseChunk,
  mergeReasoningDetailsFromChunks,
  pairedProviderOrder,
  summarizeReasoningDetails,
} from "./lib/gemini31PhaseDProbe";

describe("gemini31PhaseDProbe", () => {
  it("computeStreamTimings — providerComplete is NOT provider_wait", () => {
    const t = computeStreamTimings({
      firstByteMs: 80,
      firstSseMs: 100,
      firstReasoningMs: 100,
      firstVisibleMs: 900,
      streamCompleteMs: 5000,
    });
    assert.equal(t.request_to_first_sse_ms, 100);
    assert.equal(t.request_to_first_visible_ms, 900);
    assert.equal(t.request_to_stream_complete_ms, 5000);
    assert.equal(t.reasoning_to_visible_gap_ms, 800);
    assert.notEqual(t.request_to_stream_complete_ms, t.request_to_first_sse_ms);
  });

  it("missing firstReasoning falls back to firstSse for gap", () => {
    const t = computeStreamTimings({
      firstByteMs: 50,
      firstSseMs: 100,
      firstReasoningMs: null,
      firstVisibleMs: 900,
      streamCompleteMs: 5000,
    });
    assert.equal(t.request_to_first_reasoning_ms, null);
    assert.equal(t.reasoning_to_visible_gap_ms, 800);
  });

  it("paired provider order alternates", () => {
    assert.deepEqual(pairedProviderOrder(0), ["cheaperinference", "openrouter"]);
    assert.deepEqual(pairedProviderOrder(1), ["openrouter", "cheaperinference"]);
    assert.deepEqual(pairedProviderOrder(2), ["cheaperinference", "openrouter"]);
  });

  it("LOW/default/high diagnostic labels stay in script-only builders", () => {
    const msgs = [{ role: "user" as const, content: "test" }];
    const low = buildCiDiagnosticBody(msgs, "low");
    const def = buildCiDiagnosticBody(msgs, "default");
    const high = buildCiDiagnosticBody(msgs, "high");
    assert.equal(low.reasoning_effort, "low");
    assert.equal("reasoning_effort" in def, false);
    assert.equal(high.reasoning_effort, "high");
  });

  it("OR hidden vs visible differs only include_reasoning", () => {
    const msgs = [{ role: "user" as const, content: "test" }];
    const hidden = buildOpenRouterLowBody(msgs, true, "hidden");
    const visible = buildOpenRouterLowBody(msgs, true, "visible");
    assert.equal((hidden.reasoning as { effort: string }).effort, "low");
    assert.equal((visible.reasoning as { effort: string }).effort, "low");
    assert.equal(hidden.include_reasoning, false);
    assert.equal(visible.include_reasoning, true);
    assert.equal(hidden.model, visible.model);
    assert.equal(hidden.temperature, visible.temperature);
  });

  it("request parity hashes equal except approved provider fields", () => {
    const inv = buildRequestParityInventory([{ role: "user", content: "hello" }], "system");
    assert.ok(inv.MESSAGES_HASH.length === 64);
    assert.ok(inv.PROVIDER_REQUIRED_DIFFERENCE.length > 0);
    assert.equal(inv.OTHER_NON_PROVIDER_FIELD_MISMATCHES.length, 0);
  });

  it("detects reasoning_details in final empty-content chunk", () => {
    const chunk = {
      choices: [
        {
          delta: { content: "" },
          message: {
            content: "",
            reasoning_details: [
              { type: "thought_signature", format: "encrypted", data: "opaque-block-abc" },
            ],
          },
          finish_reason: "stop",
        },
      ],
    };
    const inv = inventorySseChunk(chunk, 0);
    assert.equal(inv.emptyContentChunk, true);
    assert.equal(inv.reasoningDetailsPresent, true);
  });

  it("preserves reasoning_details ordering in merge", () => {
    const chunks = [
      { choices: [{ delta: { reasoning_details: [{ type: "a", data: "1" }] } }] },
      { choices: [{ delta: { reasoning_details: [{ type: "b", data: "2" }] } }] },
    ];
    const merged = mergeReasoningDetailsFromChunks(chunks);
    assert.ok(merged);
    assert.equal(merged!.length, 2);
  });

  it("summarizeReasoningDetails excludes raw prose from output shape", () => {
    const summary = summarizeReasoningDetails([
      { type: "reasoning.text", text: "secret hidden chain of thought prose" },
    ]);
    assert.ok(!JSON.stringify(summary).includes("secret hidden chain"));
  });

  it("variant A history drops reasoning_details", () => {
    const msg = buildContinuityAssistantMessage("visible", [{ type: "sig" }], "A");
    assert.equal("reasoning_details" in msg, false);
  });

  it("variant B history resends exact reasoning_details", () => {
    const details = [{ type: "thought_signature", format: "encrypted", data: "x" }];
    const msg = buildContinuityAssistantMessage("visible", details, "B");
    assert.deepEqual(msg.reasoning_details, details);
    assert.notEqual(msg.reasoning_details, details);
  });
});
