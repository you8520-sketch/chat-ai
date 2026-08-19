import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gateChatOnSummaryBarrier } from "./memory-barrier-route-gate";

type RouteTurnState = {
  providerBootstrapCount: number;
  pointsDeducted: number;
  assistantFinalized: boolean;
  httpStatus: number | null;
  body: Record<string, unknown> | null;
};

/** Mirrors chat route early-return contract when summary barrier fails. */
function simulateChatRouteBarrierGate(
  barrier: Parameters<typeof gateChatOnSummaryBarrier>[0]
): RouteTurnState {
  const state: RouteTurnState = {
    providerBootstrapCount: 0,
    pointsDeducted: 0,
    assistantFinalized: false,
    httpStatus: null,
    body: null,
  };

  const gate = gateChatOnSummaryBarrier(barrier);
  if (!gate.proceed) {
    state.httpStatus = gate.response.status;
    state.body = gate.response.body;
    return state;
  }

  state.providerBootstrapCount += 1;
  state.pointsDeducted += 10;
  state.assistantFinalized = true;
  return state;
}

describe("F8 route barrier failure contract", () => {
  it("SUMMARY_BARRIER_FAILED => 503 retryable, billing waived, zero provider bootstrap", () => {
    const state = simulateChatRouteBarrierGate({
      ok: false,
      reason: "SUMMARY_BARRIER_FAILED",
      pendingRange: "1~5",
    });

    assert.equal(state.httpStatus, 503);
    assert.equal(state.providerBootstrapCount, 0);
    assert.equal(state.pointsDeducted, 0);
    assert.equal(state.assistantFinalized, false);
    assert.equal(state.body?.code, "SUMMARY_BARRIER_FAILED");
    assert.equal(state.body?.billingWaived, true);
    assert.equal(state.body?.retryable, true);
  });

  it("healthy barrier proceeds to provider bootstrap path", () => {
    const state = simulateChatRouteBarrierGate({
      ok: true,
      summarizedThrough: 5,
    });
    assert.equal(state.httpStatus, null);
    assert.equal(state.providerBootstrapCount, 1);
    assert.equal(state.assistantFinalized, true);
  });
});
