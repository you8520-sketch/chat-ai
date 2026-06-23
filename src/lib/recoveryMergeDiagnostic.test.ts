import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  determineRecoveryMergeRejectReason,
  traceRecoveryMerge,
} from "@/lib/recoveryMergeDiagnostic";

describe("recoveryMergeDiagnostic", () => {
  it("empty recovery raw → empty_response", () => {
    const prior = "가".repeat(1200);
    const trace = traceRecoveryMerge({ prior, recoveryRaw: "   " });
    assert.equal(trace.rejectReason, "empty_response");
    assert.equal(trace.finalProse, prior);
  });

  it("duplicate tail stripped when continuation repeats prior", () => {
    const prior = "에쉬는 렌의 허리를 감쌌다. " + "가".repeat(800);
    const trace = traceRecoveryMerge({
      prior,
      recoveryRaw: prior.slice(-200),
      mergeOpts: { claudeRecovery: true },
    });
    assert.ok(
      trace.rejectReason === "duplicate_tail_stripped" ||
        trace.rejectReason === "echo_detected"
    );
    assert.equal(trace.finalProse.length, prior.length);
  });

  it("determineRecoveryMergeRejectReason returns null when merge gains chars", () => {
    const prior = "가".repeat(500);
    const tail = "나".repeat(400);
    const merged = prior + tail;
    const reason = determineRecoveryMergeRejectReason({
      prior,
      recoveryRaw: tail,
      dedupedTail: tail,
      cappedTail: tail,
      mergedAfterFinalize: merged,
      clean: merged,
      finalProse: merged,
    });
    assert.equal(reason, null);
  });
});
