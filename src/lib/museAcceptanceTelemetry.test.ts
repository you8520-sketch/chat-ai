import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyMuseAcceptance,
  MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS,
  MUSE_ACCEPTANCE_SHORT_FLOOR_CHARS,
  shouldRecordMuseAcceptanceTelemetry,
  toMuseAcceptanceUsageFields,
} from "@/lib/museAcceptanceTelemetry";
import { TURN_LENGTH_SUPPLEMENT_API_ENABLED } from "@/lib/turnApiBudget";
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "@/lib/chatModels";

function base(overrides: Partial<Parameters<typeof classifyMuseAcceptance>[0]> = {}) {
  return {
    text: "가".repeat(2000) + "다.",
    finishReason: "stop",
    completedTurns: 3,
    characterId: 17,
    personaId: 1,
    modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
    selectedAI: OPENROUTER_MUSE_SPARK_11_MODEL,
    latencyMs: 1200,
    cost: 40,
    userRegenerate: false,
    manualContinueRequest: false,
    apiCallCount: 1,
    ...overrides,
  };
}

/** Healthy Korean prose of roughly n visible chars ending with period. */
function healthyProse(n: number): string {
  const unit = "고요한 공기가 방을 채웠다. ";
  let out = "";
  while ([...out].length < n - 1) out += unit;
  return out.trimEnd().replace(/[.!?…]*$/, "") + ".";
}

describe("museAcceptanceTelemetry", () => {
  it("does not enable length supplement API", () => {
    assert.equal(TURN_LENGTH_SUPPLEMENT_API_ENABLED, false);
  });

  it("gates recording to Muse Spark only", () => {
    assert.equal(shouldRecordMuseAcceptanceTelemetry(OPENROUTER_MUSE_SPARK_11_MODEL), true);
    assert.equal(shouldRecordMuseAcceptanceTelemetry("deepseek/deepseek-v4-pro"), false);
  });

  it("NORMAL_PASS for >=1800 healthy complete prose", () => {
    const text = healthyProse(MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS + 50);
    const t = classifyMuseAcceptance(base({ text }));
    assert.equal(t.acceptanceClass, "NORMAL_PASS");
    assert.ok(t.visibleChars >= MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS);
    assert.equal(t.completeSentence, true);
    assert.equal(t.healthyKorean, true);
    assert.equal(t.degeneration, false);
    assert.equal(t.autoContinuationTriggered, false);
    assert.equal(t.apiCallCount, 1);
  });

  it("SHORT_QUALITY_PASS for 900..1799 healthy complete prose", () => {
    const text = healthyProse(1200);
    const t = classifyMuseAcceptance(base({ text }));
    assert.equal(t.acceptanceClass, "SHORT_QUALITY_PASS");
    assert.ok(t.visibleChars >= MUSE_ACCEPTANCE_SHORT_FLOOR_CHARS);
    assert.ok(t.visibleChars < MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS);
  });

  it("FAIL under 900 chars even if healthy", () => {
    const text = healthyProse(400);
    const t = classifyMuseAcceptance(base({ text }));
    assert.equal(t.acceptanceClass, "FAIL");
  });

  it("FAIL empty output", () => {
    const t = classifyMuseAcceptance(base({ text: "   " }));
    assert.equal(t.acceptanceClass, "FAIL");
    assert.equal(t.visibleChars, 0);
  });

  it("FAIL truncated incomplete (length finish without sentence end)", () => {
    const t = classifyMuseAcceptance(
      base({
        text: "그는 문을 열고 천천히 걸음을",
        finishReason: "length",
      })
    );
    assert.equal(t.truncatedIncomplete, true);
    assert.equal(t.acceptanceClass, "FAIL");
  });

  it("FAIL on LOOP_ABORT", () => {
    const t = classifyMuseAcceptance(
      base({
        text: healthyProse(2000),
        finishReason: "LOOP_ABORT",
      })
    );
    assert.equal(t.degeneration, true);
    assert.equal(t.acceptanceClass, "FAIL");
  });

  it("records regenerate / continue flags without triggering auto continuation", () => {
    const t = classifyMuseAcceptance(
      base({
        userRegenerate: true,
        manualContinueRequest: true,
      })
    );
    assert.equal(t.userRegenerate, true);
    assert.equal(t.manualContinueRequest, true);
    assert.equal(t.autoContinuationTriggered, false);
  });

  it("usage fields omit raw prose", () => {
    const t = classifyMuseAcceptance(base());
    const fields = toMuseAcceptanceUsageFields(t);
    assert.equal("text" in fields, false);
    assert.equal(fields.acceptanceClass, t.acceptanceClass);
    assert.equal(fields.characterId, 17);
  });

  it("telemetry floor constants are not the billing 2700 floor", () => {
    assert.equal(MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS, 1800);
    assert.equal(MUSE_ACCEPTANCE_SHORT_FLOOR_CHARS, 900);
  });
});
