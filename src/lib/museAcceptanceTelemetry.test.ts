import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyMuseAcceptance,
  MUSE_ACCEPTANCE_CLASSIFICATION_SCOPE,
  MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS,
  MUSE_ACCEPTANCE_SHORT_FLOOR_CHARS,
  shouldRecordMuseAcceptanceTelemetry,
  stripMuseAcceptanceFromUsage,
  toMuseAcceptanceUsageFields,
} from "@/lib/museAcceptanceTelemetry";
import { TURN_LENGTH_SUPPLEMENT_API_ENABLED } from "@/lib/turnApiBudget";
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";

function base(overrides: Partial<Parameters<typeof classifyMuseAcceptance>[0]> = {}) {
  return {
    text: "가".repeat(2000) + "다.",
    finishReason: "stop",
    completedTurns: 3,
    characterId: 17,
    personaId: 1,
    modelId: OPENROUTER_MUSE_SPARK_11_MODEL,
    selectedAI: OPENROUTER_MUSE_SPARK_11_MODEL,
    requestLatencyMs: 1200,
    cost: 40,
    isRegenerationRequest: false,
    isContinueRequest: false,
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

  it("scope is length_and_local_output_health — not a style quality score", () => {
    const t = classifyMuseAcceptance(base({ text: healthyProse(2000) }));
    assert.equal(t.classificationScope, MUSE_ACCEPTANCE_CLASSIFICATION_SCOPE);
    assert.equal(t.classificationScope, "length_and_local_output_health");
    const fields = toMuseAcceptanceUsageFields(t);
    assert.equal(fields.classificationScope, "length_and_local_output_health");
    // Ownership is a separate risk signal field; class itself does not encode invention/voice.
    assert.ok("ownership" in fields);
    assert.ok(!("styleQualityScore" in fields));
    assert.ok(!("hardInvention" in fields));
    assert.ok(!("reExplanation" in fields));
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

  it("records regeneration / continue flags without auto continuation", () => {
    const t = classifyMuseAcceptance(
      base({
        isRegenerationRequest: true,
        isContinueRequest: true,
      })
    );
    assert.equal(t.isRegenerationRequest, true);
    assert.equal(t.isContinueRequest, true);
    assert.equal(t.autoContinuationTriggered, false);
    assert.equal(t.requestLatencyMs, 1200);
  });

  it("usage fields omit raw prose and use renamed keys", () => {
    const t = classifyMuseAcceptance(base());
    const fields = toMuseAcceptanceUsageFields(t);
    assert.equal("text" in fields, false);
    assert.equal("latencyMs" in fields, false);
    assert.equal("userRegenerate" in fields, false);
    assert.equal("manualContinueRequest" in fields, false);
    assert.equal(fields.requestLatencyMs, 1200);
    assert.equal(fields.isRegenerationRequest, false);
    assert.equal(fields.isContinueRequest, false);
  });

  it("stripMuseAcceptanceFromUsage removes internal telemetry for clients", () => {
    const usage = {
      input: 1,
      output: 2,
      model: OPENROUTER_MUSE_SPARK_11_MODEL,
      route: "nsfw" as const,
      cost: 1,
      breakdown: [],
      museAcceptance: { acceptanceClass: "NORMAL_PASS" },
      finishReason: "stop",
    } satisfies Usage;
    const stripped = stripMuseAcceptanceFromUsage(usage);
    assert.equal(stripped.museAcceptance, undefined);
    assert.equal(stripped.finishReason, "stop");
    assert.equal(stripped.cost, 1);
  });

  it("telemetry floor constants are not the billing 2700 floor", () => {
    assert.equal(MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS, 1800);
    assert.equal(MUSE_ACCEPTANCE_SHORT_FLOOR_CHARS, 900);
  });
});
