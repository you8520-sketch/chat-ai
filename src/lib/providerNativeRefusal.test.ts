import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectModelRefusal } from "@/lib/adultSceneRouting";
import {
  detectAdultGenerationFailure,
  generationFailureUserMessage,
  isCatastrophicallyShortResponse,
} from "@/lib/responseLength";
import { shouldWaiveTurnBilling } from "@/lib/points";
import {
  extractStreamChoiceTermination,
  isProviderNativeRefusalSignal,
  normalizeProviderTerminationFinishReason,
  normalizeStreamTermination,
} from "@/lib/providerTermination";

const healthyShortProse =
  "그는 창밖을 바라보며 깊은 숨을 내쉬었다. " +
  "오늘도 하루가 저물어가고 있었다. " +
  "가".repeat(1100) +
  " 마침내 그는 고개를 돌려 방 안을 둘러보았다.";

const partialRefusalProse = healthyShortProse.slice(0, 900);

const shortRefusalProse =
  "I can't continue with this request. I must decline.";

describe("provider termination field owners (code-only trace)", () => {
  it("OpenRouter exposes finish_reason and native_finish_reason on choice", () => {
    const fields = extractStreamChoiceTermination({
      finish_reason: "stop",
      native_finish_reason: "end_turn",
    });
    assert.equal(fields.finishReason, "stop");
    assert.equal(fields.nativeFinishReason, "end_turn");
    assert.equal(normalizeProviderTerminationFinishReason(fields), "stop");
  });

  it("native_finish_reason=refusal normalizes to refusal even when finish_reason=stop", () => {
    const normalized = normalizeStreamTermination({
      finish_reason: "stop",
      native_finish_reason: "refusal",
    });
    assert.equal(normalized, "refusal");
  });

  it("stop_details.type=refusal is recognized when exposed", () => {
    const normalized = normalizeStreamTermination({
      finish_reason: "stop",
      stop_details: { type: "refusal" },
    });
    assert.equal(normalized, "refusal");
  });

  it("top-level stop_reason=refusal is recognized when exposed", () => {
    const normalized = normalizeStreamTermination(
      { finish_reason: "stop" },
      { stop_reason: "refusal" }
    );
    assert.equal(normalized, "refusal");
  });
});

describe("provider-native model refusal delivery integrity", () => {
  it("1. normal finish/end_turn — success unchanged", () => {
    assert.equal(detectAdultGenerationFailure("stop", healthyShortProse, 3500), null);
    assert.equal(
      detectAdultGenerationFailure("end_turn", healthyShortProse, 3500),
      null
    );
    assert.equal(
      shouldWaiveTurnBilling(healthyShortProse, { generationFailure: null, adultMode: true }),
      null
    );
  });

  it("2. explicit native refusal + empty content — model_refusal, billing waived", () => {
    assert.equal(detectAdultGenerationFailure("refusal", "", 3500), "model_refusal");
    assert.equal(
      shouldWaiveTurnBilling("", {
        generationFailure: "model_refusal",
        adultMode: true,
      }),
      "generation_failure"
    );
    assert.equal(detectModelRefusal({ text: "", finishReason: "refusal" }).refused, true);
  });

  it("3. explicit native refusal + short refusal prose — model_refusal, not under_length", () => {
    assert.equal(
      detectAdultGenerationFailure("refusal", shortRefusalProse, 3500),
      "model_refusal"
    );
    assert.notEqual(
      detectAdultGenerationFailure("refusal", shortRefusalProse, 3500),
      "under_length"
    );
  });

  it("4. explicit native refusal + substantial partial content — model_refusal, billing waived", () => {
    assert.equal(
      detectAdultGenerationFailure("refusal", partialRefusalProse, 3500),
      "model_refusal"
    );
    assert.equal(
      shouldWaiveTurnBilling(partialRefusalProse, {
        generationFailure: "model_refusal",
        adultMode: true,
      }),
      "generation_failure"
    );
    assert.equal(
      detectModelRefusal({ text: partialRefusalProse, finishReason: "refusal" }).refused,
      true
    );
  });

  it("5. finish_reason=error — provider_error unchanged", () => {
    assert.equal(
      detectAdultGenerationFailure("error", partialRefusalProse, 3500),
      "provider_error"
    );
    assert.equal(detectAdultGenerationFailure("ERROR", "", 3500), "provider_error");
  });

  it("6. content_filter / safety handling unchanged", () => {
    assert.equal(
      detectAdultGenerationFailure("content_filter", healthyShortProse, 3500),
      "content_filter"
    );
    assert.equal(
      detectAdultGenerationFailure("SAFETY", healthyShortProse, 3500),
      "safety"
    );
  });

  it("7. prose refusal detector unchanged when finish is normal stop", () => {
    const policyRefusal =
      "I'm sorry, but I can't fulfill your request due to policy.";
    assert.equal(
      detectModelRefusal({ text: policyRefusal, finishReason: "stop" }).refused,
      true
    );
    assert.equal(
      detectModelRefusal({ text: healthyShortProse, finishReason: "stop" }).refused,
      false
    );
  });

  it("8. normal Opus end_turn via native_finish_reason wrapper — success unchanged", () => {
    const finish = normalizeStreamTermination({
      finish_reason: "stop",
      native_finish_reason: "end_turn",
    });
    assert.equal(finish, "stop");
    assert.equal(detectAdultGenerationFailure(finish, healthyShortProse, 3500), null);
  });

  it("generationFailureUserMessage(model_refusal) — neutral user copy", () => {
    const message = generationFailureUserMessage("model_refusal");
    assert.match(message, /저장되지 않았/);
    assert.match(message, /포인트는 차감되지 않/);
    assert.doesNotMatch(message, /검열/);
    assert.doesNotMatch(message, /안전 정책/);
    assert.doesNotMatch(message, /provider/i);
  });

  it("isProviderNativeRefusalSignal — refusal/refused only", () => {
    assert.equal(isProviderNativeRefusalSignal("refusal"), true);
    assert.equal(isProviderNativeRefusalSignal("REFUSED"), true);
    assert.equal(isProviderNativeRefusalSignal("stop"), false);
    assert.equal(isProviderNativeRefusalSignal("end_turn"), false);
  });

  it("catastrophic-short under stop remains under_length when not native refusal", () => {
    assert.equal(detectAdultGenerationFailure("stop", "짧음", 3500), "under_length");
    assert.equal(isCatastrophicallyShortResponse("짧음", 3500), true);
  });
});
