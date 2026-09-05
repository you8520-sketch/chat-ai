import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBillingSummaryToMessages,
  mergeBillingChargeSummaryFieldsById,
  shouldFetchFailedTurnBillingSummary,
  isTerminalFailedBillingStatus,
} from "@/lib/failedTurnBillingSummaryClient";
import type { UserMessageBillingSummary } from "@/lib/storedTurnChargeEvidenceShared";

function summaryFor(messageId: number, requestId: string | null): UserMessageBillingSummary {
  return {
    messageId,
    requestId,
    generationStatus: "interrupted",
    chargeStatus: "not_charged",
    settledPoints: 0,
    modelLabel: "DeepSeek V4 Pro",
  };
}

describe("failedTurnBillingSummaryClient live visibility", () => {
  it("S live EOF interrupted → fetchable without manual refresh", () => {
    assert.equal(
      shouldFetchFailedTurnBillingSummary({
        id: 11,
        role: "assistant",
        requestId: "req_live",
        generationStatus: "interrupted",
        billingChargeSummary: null,
      }),
      true
    );
  });

  it("T live failed_partial → fetchable without manual refresh", () => {
    assert.equal(
      shouldFetchFailedTurnBillingSummary({
        id: 12,
        role: "assistant",
        requestId: "req_partial",
        generationStatus: "failed_partial",
        billingChargeSummary: null,
      }),
      true
    );
  });

  it("does not fetch when summary already present or id missing", () => {
    assert.equal(
      shouldFetchFailedTurnBillingSummary({
        id: 13,
        role: "assistant",
        requestId: "req_x",
        generationStatus: "interrupted",
        billingChargeSummary: summaryFor(13, "req_x"),
      }),
      false
    );
    assert.equal(
      shouldFetchFailedTurnBillingSummary({
        role: "assistant",
        requestId: "req_x",
        generationStatus: "interrupted",
        billingChargeSummary: null,
      }),
      false
    );
    assert.equal(isTerminalFailedBillingStatus("completed"), false);
    assert.equal(isTerminalFailedBillingStatus("generating"), false);
  });

  it("U regen stale lazy response is ignored", () => {
    const prev = [
      { id: 20, role: "assistant", requestId: "req_B", generationStatus: "interrupted", billingChargeSummary: null },
    ];
    const stale = summaryFor(20, "req_A");
    assert.deepEqual(applyBillingSummaryToMessages(prev, stale), prev);
  });

  it("V current generation summary is applied", () => {
    const prev = [
      { id: 21, role: "assistant", requestId: "req_B", generationStatus: "failed", billingChargeSummary: null },
    ];
    const next = applyBillingSummaryToMessages(prev, summaryFor(21, "req_B"));
    assert.equal(next[0]?.billingChargeSummary?.messageId, 21);
  });

  it("AC/AD reject one-sided request identity", () => {
    const currentRequest = [{ id: 22, role: "assistant", requestId: "req_current", generationStatus: "failed", billingChargeSummary: null }];
    const summaryRequest = [{ id: 23, role: "assistant", requestId: null, generationStatus: "failed", billingChargeSummary: null }];
    assert.deepEqual(applyBillingSummaryToMessages(currentRequest, summaryFor(22, null)), currentRequest);
    assert.deepEqual(applyBillingSummaryToMessages(summaryRequest, summaryFor(23, "req_summary")), summaryRequest);
  });

  it("AE exact request identity is applied, including normalized whitespace", () => {
    const prev = [{ id: 24, role: "assistant", requestId: " req_exact ", generationStatus: "interrupted", billingChargeSummary: null }];
    const next = applyBillingSummaryToMessages(prev, summaryFor(24, "req_exact"));
    assert.equal(next[0]?.billingChargeSummary?.requestId, "req_exact");
  });

  it("SSR merge copies server summary with generation guard", () => {
    const prev = [
      { id: 30, role: "assistant", requestId: "req_B", generationStatus: "interrupted", billingChargeSummary: null },
    ];
    const server = [
      { id: 30, role: "assistant", requestId: "req_B", generationStatus: "interrupted", billingChargeSummary: summaryFor(30, "req_B") },
    ];
    const merged = mergeBillingChargeSummaryFieldsById(prev, server);
    assert.equal(merged[0]?.billingChargeSummary?.messageId, 30);
    const staleServer = [
      { id: 30, role: "assistant", requestId: "req_A", generationStatus: "interrupted", billingChargeSummary: summaryFor(30, "req_A") },
    ];
    assert.deepEqual(mergeBillingChargeSummaryFieldsById(prev, staleServer), prev);
    assert.deepEqual(
      mergeBillingChargeSummaryFieldsById(prev, [
        { id: 30, role: "assistant", requestId: "req_B", generationStatus: "interrupted", billingChargeSummary: summaryFor(30, null) },
      ]),
      prev
    );
  });
});
