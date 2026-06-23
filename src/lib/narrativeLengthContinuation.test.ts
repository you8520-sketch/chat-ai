import assert from "node:assert/strict";

import { describe, it } from "node:test";

import {
  buildVisibleLengthContinuationUserMessage,
  continueNarrativeIfUnderMinimum,
  needsVisibleLengthContinuation,
} from "@/lib/narrativeLengthContinuation";
import { TurnApiBudget } from "@/lib/turnApiBudget";

describe("narrativeLengthContinuation", () => {
  it("needs continuation when visible prose below unified tier minimum (1,500)", () => {
    const short = "가".repeat(1200);
    assert.equal(needsVisibleLengthContinuation(short), true);
    assert.equal(needsVisibleLengthContinuation(short, 2000), true);
    assert.equal(needsVisibleLengthContinuation(short, 3000), true);
  });

  it("does not continue above minimum but below soft aim (~1,743 chars)", () => {
    assert.equal(needsVisibleLengthContinuation("가".repeat(1743)), false);
    assert.equal(needsVisibleLengthContinuation("가".repeat(1100)), true);
  });

  it("does not continue when char count meets tier minimum regardless of word count", () => {
    const longCharsFewWords = "가".repeat(1600);
    assert.equal(needsVisibleLengthContinuation(longCharsFewWords), false);
  });

  it("does not need continuation when chars and words meet tier minimum", () => {
    const words = Array.from({ length: 1200 }, (_, i) => `단어${i}`).join(" ");
    assert.equal(needsVisibleLengthContinuation(words), false);
  });

  it("continuation user message references unified char minimum 1,500", () => {
    const msg = buildVisibleLengthContinuationUserMessage(1200, undefined, 800);
    assert.match(msg, /1,200/);
    assert.match(msg, /1,500/);
    assert.match(msg, /자연스럽게 이어/);
    assert.match(msg, /HTML/);
    assert.doesNotMatch(msg, /1,000단어/);
  });

  it("continueNarrativeIfUnderMinimum does not sub-call when NARRATIVE_LENGTH_CONTINUATION_ENABLED is false", async () => {
    const prior = "가".repeat(900);
    assert.equal(needsVisibleLengthContinuation(prior), true);
    const budget = new TurnApiBudget();
    budget.beforeFetch("primary");
    const result = await continueNarrativeIfUnderMinimum({
      prose: prior,
      system: "test",
      modelId: "test/model",
      targetResponseChars: 3500,
      charName: "TestChar",
      turnApiBudget: budget,
    });
    assert.equal(result.continued, false);
    assert.equal(result.prose, prior);
    assert.equal(budget.fetchCountSnapshot, 1);
  });
});
