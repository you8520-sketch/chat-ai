import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatSseUserChargeFromSettlement,
  completeChatBillingPresentation,
  createChatBillingPresentationOwner,
  extractChatStreamSettlement,
  stageChatBillingPresentation,
} from "./chatBillingPresentation";
import {
  UNDER_RECOVERED_BILLING_MESSAGE,
  UNDER_RECOVERED_OUTCOME,
} from "./chatBillingSettlement";

describe("request-scoped chat billing presentation", () => {
  it("holds billing while visual reveal is pending, then flushes exactly once", () => {
    const owner = createChatBillingPresentationOwner<number>();
    assert.equal(
      stageChatBillingPresentation(owner, {
        requestId: "turn-a",
        billing: 10,
        visualRevealPending: true,
      }),
      null
    );
    assert.equal(completeChatBillingPresentation(owner, "turn-a"), 10);
    assert.equal(completeChatBillingPresentation(owner, "turn-a"), null);
  });

  it("presents instant mode immediately and never duplicates", () => {
    const owner = createChatBillingPresentationOwner<number>();
    assert.equal(
      stageChatBillingPresentation(owner, {
        requestId: "instant",
        billing: 7,
        visualRevealPending: false,
      }),
      7
    );
    assert.equal(
      stageChatBillingPresentation(owner, {
        requestId: "instant",
        billing: 7,
        visualRevealPending: false,
      }),
      null
    );
  });

  it("never attaches turn A billing to turn B reveal completion", () => {
    const owner = createChatBillingPresentationOwner<number>();
    stageChatBillingPresentation(owner, {
      requestId: "turn-a",
      billing: 10,
      visualRevealPending: true,
    });
    stageChatBillingPresentation(owner, {
      requestId: "turn-b",
      billing: 20,
      visualRevealPending: true,
    });
    assert.equal(completeChatBillingPresentation(owner, "turn-b"), 20);
    assert.equal(completeChatBillingPresentation(owner, "turn-a"), 10);
  });
});

describe("chat stream settlement presentation", () => {
  it("charges 100P as an actual deduction and does not warn", () => {
    const view = extractChatStreamSettlement({
      cost: 100,
      totalPointsCost: 100,
      settledPoints: 100,
      requestedPoints: 100,
      remainingPoints: 0,
      paidPoints: 0,
      freePoints: 0,
      billingOutcome: "charged",
    });
    assert.deepEqual(view.deduction, {
      turnCost: 100,
      remainingPoints: 0,
      paidPoints: 0,
      freePoints: 0,
    });
    assert.equal(view.billingWarning, null);
    assert.equal(view.keepAssistantResponse, true);
  });

  it("keeps waived 0P semantics and does not treat it as under_recovered", () => {
    const view = extractChatStreamSettlement({
      cost: 0,
      totalPointsCost: 0,
      settledPoints: 0,
      requestedPoints: 0,
      remainingPoints: 100,
      paidPoints: 0,
      freePoints: 100,
      billingOutcome: "waived",
    });
    assert.equal(view.deduction, undefined);
    assert.equal(view.billingWarning, null);
    assert.equal(view.keepAssistantResponse, true);
  });

  it("does not fabricate an 800P deduction when settlement is under_recovered", () => {
    const view = extractChatStreamSettlement({
      cost: 800,
      totalPointsCost: 800,
      settledPoints: 0,
      requestedPoints: 800,
      remainingPoints: 100,
      paidPoints: 0,
      freePoints: 100,
      billingOutcome: UNDER_RECOVERED_OUTCOME,
      billingError: UNDER_RECOVERED_BILLING_MESSAGE,
    });
    assert.equal(view.deduction, undefined);
    assert.equal(view.billingWarning, UNDER_RECOVERED_BILLING_MESSAGE);
    assert.equal(view.keepAssistantResponse, true);
  });

  it("ignores requested product cost when outcome is missing but settledPoints is 0", () => {
    const view = extractChatStreamSettlement({
      cost: 800,
      totalPointsCost: 800,
      settledPoints: 0,
      requestedPoints: 800,
      remainingPoints: 100,
      paidPoints: 0,
      freePoints: 100,
    });
    assert.equal(view.deduction, undefined);
    assert.equal(view.billingWarning, null);
  });

  it("maps SSE user-charge fields from settlement, not requested product cost", () => {
    const charged = chatSseUserChargeFromSettlement({
      outcome: "charged",
      settledPoints: 100,
      requestedPoints: 100,
    });
    assert.equal(charged.cost, 100);
    assert.equal(charged.totalPointsCost, 100);
    assert.equal(charged.settledPoints, 100);
    assert.equal(charged.requestedPoints, 100);
    assert.equal(charged.billingOutcome, "charged");
    assert.equal(charged.billingError, undefined);

    const under = chatSseUserChargeFromSettlement({
      outcome: UNDER_RECOVERED_OUTCOME,
      settledPoints: 0,
      requestedPoints: 800,
    });
    assert.equal(under.cost, 0);
    assert.equal(under.totalPointsCost, 0);
    assert.equal(under.settledPoints, 0);
    assert.equal(under.requestedPoints, 800);
    assert.equal(under.billingOutcome, UNDER_RECOVERED_OUTCOME);
    assert.equal(under.billingError, UNDER_RECOVERED_BILLING_MESSAGE);

    const waived = chatSseUserChargeFromSettlement({
      outcome: "waived",
      settledPoints: 0,
      requestedPoints: 0,
    });
    assert.equal(waived.cost, 0);
    assert.equal(waived.totalPointsCost, 0);
    assert.equal(waived.billingOutcome, "waived");
    assert.equal(waived.billingError, undefined);
  });
});
