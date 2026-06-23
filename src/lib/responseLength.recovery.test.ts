import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectAdultGenerationFailure,
  needsResponseLengthFix,
  needsUnderLengthRecovery,
} from "@/lib/responseLength";
import { continueNarrativeIfUnderMinimum } from "@/lib/narrativeLengthContinuation";
import { TurnApiBudget } from "@/lib/turnApiBudget";

const healthyShortProse =
  "그는 창밖을 바라보며 깊은 숨을 내쉬었다. " +
  "오늘도 하루가 저물어가고 있었다. " +
  "가".repeat(1100) +
  " 마침내 그는 고개를 돌려 방 안을 둘러보았다.";

describe("under-length recovery disabled (1-pass)", () => {
  it("needsUnderLengthRecovery always false regardless of char count", () => {
    assert.equal(needsUnderLengthRecovery(""), false);
    assert.equal(needsUnderLengthRecovery("가".repeat(100)), false);
    assert.equal(needsUnderLengthRecovery("가".repeat(1200)), false);
    assert.equal(needsUnderLengthRecovery("가".repeat(3000)), false);
  });

  it("needsResponseLengthFix false for complete short output below tier minimum", () => {
    const shortComplete = healthyShortProse;
    assert.equal(shortComplete.length < 2000, true);
    assert.equal(needsResponseLengthFix(shortComplete, "STOP"), false);
    assert.equal(needsResponseLengthFix(shortComplete, "END_TURN"), false);
  });

  it("needsResponseLengthFix true for MAX_TOKENS mid-sentence truncation", () => {
    const truncated = "그는 천천히 다가가며 말을 이어가";
    assert.equal(needsResponseLengthFix(truncated, "MAX_TOKENS"), true);
  });

  it("detectAdultGenerationFailure accepts healthy prose below 2,000 chars", () => {
    assert.equal(
      detectAdultGenerationFailure("STOP", healthyShortProse, 3500),
      null
    );
  });

  it("detectAdultGenerationFailure still rejects catastrophically short output", () => {
    assert.equal(detectAdultGenerationFailure("STOP", "짧음", 3500), "under_length");
  });

  it("continueNarrativeIfUnderMinimum skips API when flag disabled", async () => {
    const prior = "가".repeat(800);
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
