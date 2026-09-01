import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countWidgetExtractAttempts,
  formatWidgetExtractAttemptLine,
  formatWidgetExtractAttemptResult,
} from "@/lib/statusWidgetExtractDiagnosticsDisplay";

describe("statusWidgetExtractDiagnosticsDisplay", () => {
  it("shows initial parse failure reason before repair success", () => {
    const initial = {
      stage: "initial" as const,
      modelId: "gpt-5.6-luna",
      httpStatus: 200,
      finishReason: "stop",
      errorCode: null,
      reasonCode: "V3_PARSE_FAILED",
      succeeded: false,
    };
    const repair = {
      stage: "repair" as const,
      modelId: "gpt-5.6-luna",
      httpStatus: 200,
      finishReason: "stop",
      errorCode: null,
      reasonCode: "V3_REPAIR_USED",
      succeeded: true,
    };
    assert.equal(formatWidgetExtractAttemptResult(initial), "failed (V3_PARSE_FAILED)");
    assert.equal(formatWidgetExtractAttemptResult(repair), "success (V3_REPAIR_USED)");
    assert.match(formatWidgetExtractAttemptLine(initial), /initial · gpt-5.6-luna/);
    assert.match(formatWidgetExtractAttemptLine(repair), /repair · gpt-5.6-luna/);
    const counts = countWidgetExtractAttempts({
      exhausted: false,
      usedFallback: false,
      attempts: [initial, repair],
    });
    assert.equal(counts.total, 2);
    assert.equal(counts.initial, 1);
    assert.equal(counts.repair, 1);
  });

  it("initial success implies zero repair attempts in count helper", () => {
    const counts = countWidgetExtractAttempts({
      exhausted: false,
      usedFallback: false,
      attempts: [
        {
          stage: "initial",
          modelId: "gpt-5.6-luna",
          httpStatus: 200,
          finishReason: "stop",
          errorCode: null,
          reasonCode: "OK",
          succeeded: true,
        },
      ],
    });
    assert.equal(counts.repair, 0);
    assert.equal(counts.total, 1);
  });
});
