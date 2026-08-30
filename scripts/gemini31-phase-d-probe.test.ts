/**
 * Phase D §28 — deterministic diagnostic tests (no live API).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildContinuityAssistantMessage,
  inventorySseChunk,
  mergeReasoningDetailsFromChunks,
  summarizeReasoningDetails,
} from "./lib/gemini31PhaseDProbe";

describe("gemini31PhaseDProbe", () => {
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
    assert.equal(inv.reasoningDetailsBlockCount, 1);
    assert.equal(inv.reasoningDetailsSummaries[0]?.hasSignature, false);
    assert.equal(inv.reasoningDetailsSummaries[0]?.type, "thought_signature");
  });

  it("preserves reasoning_details ordering in merge", () => {
    const chunks = [
      {
        choices: [{ delta: { reasoning_details: [{ type: "a", data: "1" }] } }],
      },
      {
        choices: [{ delta: { reasoning_details: [{ type: "b", data: "2" }] } }],
      },
    ];
    const merged = mergeReasoningDetailsFromChunks(chunks);
    assert.ok(merged);
    assert.equal(merged!.length, 2);
    assert.deepEqual((merged![0] as { type: string }).type, "a");
    assert.deepEqual((merged![1] as { type: string }).type, "b");
  });

  it("summarizeReasoningDetails excludes raw prose from output shape", () => {
    const summary = summarizeReasoningDetails([
      { type: "reasoning.text", text: "secret hidden chain of thought prose" },
    ]);
    assert.equal(summary.blockCount, 1);
    assert.ok(summary.summaries[0]?.sha256);
    assert.equal(summary.summaries[0]?.byteLength, summary.totalBytes);
    assert.ok(!JSON.stringify(summary).includes("secret hidden chain"));
  });

  it("variant A history drops reasoning_details", () => {
    const msg = buildContinuityAssistantMessage("visible", [{ type: "sig" }], "A");
    assert.equal(msg.content, "visible");
    assert.equal("reasoning_details" in msg, false);
  });

  it("variant B history resends exact reasoning_details", () => {
    const details = [{ type: "thought_signature", format: "encrypted", data: "x" }];
    const msg = buildContinuityAssistantMessage("visible", details, "B");
    assert.deepEqual(msg.reasoning_details, details);
    assert.notEqual(msg.reasoning_details, details);
  });

  it("does not mix reasoning metadata into visible content field", () => {
    const msg = buildContinuityAssistantMessage("only visible", [{ type: "sig" }], "B");
    assert.equal(msg.content, "only visible");
    assert.ok(msg.reasoning_details);
  });
});
