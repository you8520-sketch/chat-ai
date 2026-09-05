import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completeChatBillingPresentation,
  createChatBillingPresentationOwner,
  stageChatBillingPresentation,
} from "./chatBillingPresentation";

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
