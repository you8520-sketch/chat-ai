import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectAdultGenerationFailure,
  isCatastrophicallyShortResponse,
} from "@/lib/responseLength";
import { shouldWaiveTurnBilling } from "@/lib/points";

const healthyShortProse =
  "그는 창밖을 바라보며 깊은 숨을 내쉬었다. " +
  "오늘도 하루가 저물어가고 있었다. " +
  "가".repeat(1100) +
  " 마침내 그는 고개를 돌려 방 안을 둘러보았다.";

const partialErrorProse =
  healthyShortProse +
  " 그는 천천히 다가가며 말을 이어가";

describe("finish_reason=error delivery integrity", () => {
  it("stop + healthy body — success unchanged (no generation failure)", () => {
    assert.equal(detectAdultGenerationFailure("stop", healthyShortProse, 3500), null);
    assert.equal(
      shouldWaiveTurnBilling(healthyShortProse, { generationFailure: null, adultMode: true }),
      null
    );
  });

  it("error + non-empty partial body — provider_error generation failure", () => {
    assert.equal(
      detectAdultGenerationFailure("error", partialErrorProse, 3500),
      "provider_error"
    );
    assert.equal(
      shouldWaiveTurnBilling(partialErrorProse, {
        generationFailure: "provider_error",
        adultMode: true,
      }),
      "generation_failure"
    );
  });

  it("error + empty body — provider_error generation failure", () => {
    assert.equal(detectAdultGenerationFailure("ERROR", "", 3500), "provider_error");
    assert.equal(
      shouldWaiveTurnBilling("", { generationFailure: "provider_error", adultMode: true }),
      "generation_failure"
    );
  });

  it("content_filter safety termination — unchanged", () => {
    assert.equal(
      detectAdultGenerationFailure("content_filter", healthyShortProse, 3500),
      "content_filter"
    );
    assert.equal(
      detectAdultGenerationFailure("SAFETY", healthyShortProse, 3500),
      "safety"
    );
  });

  it("catastrophic-short behavior — unchanged", () => {
    assert.equal(detectAdultGenerationFailure("stop", "짧음", 3500), "under_length");
    assert.equal(isCatastrophicallyShortResponse("짧음", 3500), true);
    assert.equal(
      detectAdultGenerationFailure("error", "짧음", 3500),
      "provider_error"
    );
  });

  it("successful response still bills normally when no generation failure", () => {
    const waived = shouldWaiveTurnBilling(healthyShortProse, {
      generationFailure: null,
      adultMode: true,
      finishReason: "stop",
    });
    assert.equal(waived, null);
  });

  it("finish_reason=error does not use normal success commit semantics (billing waived)", () => {
    const failure = detectAdultGenerationFailure("error", partialErrorProse, 3500);
    assert.equal(failure, "provider_error");
    assert.notEqual(failure, null);
    assert.equal(
      shouldWaiveTurnBilling(partialErrorProse, {
        generationFailure: failure,
        adultMode: true,
        finishReason: "error",
      }),
      "generation_failure"
    );
  });

  it("finish_reason=length + non-empty body — success path unchanged when above catastrophic floor", () => {
    assert.equal(detectAdultGenerationFailure("length", healthyShortProse, 3500), null);
  });
});
