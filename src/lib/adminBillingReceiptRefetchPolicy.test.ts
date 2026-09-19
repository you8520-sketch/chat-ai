import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminReceiptNeedsFollowUpFetch,
  ADMIN_RECEIPT_FOLLOW_UP_MAX_ATTEMPTS,
} from "@/lib/adminBillingReceiptRefetchPolicy";
import type { AdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3Shared";

function receiptWithCoverage(
  whole: AdminBillingReceiptV3["wholeTurn"]["coverage"],
  asyncCoverage: AdminBillingReceiptV3["async"]["coverage"]
): AdminBillingReceiptV3 {
  return {
    version: 3,
    assistantMessageId: 1,
    chatId: 1,
    mainRpOutputVisibleChars: 10,
    syncReceipt: null,
    async: {
      coverage: asyncCoverage,
      expectation: {
        families: [],
        overallCoverage: asyncCoverage,
        expectedFamilies: [],
        terminalFamilies: [],
        pendingFamilies: [],
        skippedFamilies: [],
        unverifiableFamilies: [],
      },
      physicalCallCount: 0,
      exactPhysicalCallCount: 0,
      incompletePhysicalCallCount: 0,
      knownActualCostUsd: 0,
      exactActualCostUsd: null,
      unexpectedRowCount: 0,
      unexpectedFamilies: [],
      byFamily: [],
    },
    wholeTurn: {
      scope: "turn_attributable",
      coverage: whole,
      mainActualCostUsd: null,
      mainActualCostSource: null,
      mainExact: false,
      syncActualCostUsd: null,
      syncExact: false,
      syncProvablyNone: false,
      asyncKnownActualCostUsd: 0,
      asyncExactActualCostUsd: null,
      knownProviderSpendUsd: 0,
      exactProviderSpendUsd: null,
      exactProviderSpendKrw: null,
      contributionMarginKrw: null,
      contributionMarginPercent: null,
      fx: null,
    },
    excludedCostScopes: [],
  };
}

describe("adminBillingReceiptRefetchPolicy", () => {
  it("partial/pending coverage requires follow-up fetch", () => {
    assert.equal(adminReceiptNeedsFollowUpFetch(receiptWithCoverage("partial", "complete")), true);
    assert.equal(adminReceiptNeedsFollowUpFetch(receiptWithCoverage("complete", "partial")), true);
    assert.equal(adminReceiptNeedsFollowUpFetch(receiptWithCoverage("pending", "complete")), true);
  });

  it("terminal complete/unverifiable coverage stops follow-up fetch", () => {
    assert.equal(adminReceiptNeedsFollowUpFetch(receiptWithCoverage("complete", "complete")), false);
    assert.equal(adminReceiptNeedsFollowUpFetch(receiptWithCoverage("unverifiable", "unverifiable")), false);
    assert.equal(adminReceiptNeedsFollowUpFetch(null), false);
  });

  it("bounded retry cap is fixed", () => {
    assert.equal(ADMIN_RECEIPT_FOLLOW_UP_MAX_ATTEMPTS, 3);
  });
});
