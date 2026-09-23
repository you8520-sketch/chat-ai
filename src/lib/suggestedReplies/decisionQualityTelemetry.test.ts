import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSuggestedRepliesDecisionQualityTelemetry,
  logSuggestedRepliesDecisionQualityTelemetry,
  SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX,
} from "./decisionQualityTelemetry";

describe("P3-A suggested replies decision-quality production telemetry", () => {
  it("builds metadata-only payload without raw reply content", () => {
    const payload = buildSuggestedRepliesDecisionQualityTelemetry({
      source: "standalone-extract",
      observation: {
        contractValid: false,
        issues: ["duplicate_text", "missing_kind"],
        observedKinds: ["natural", "twist"],
        itemCount: 3,
      },
    });

    assert.deepEqual(payload, {
      event: "suggested_replies_decision_quality",
      source: "standalone-extract",
      contractValid: false,
      itemCount: 3,
      issueCount: 2,
      issues: ["duplicate_text", "missing_kind"],
    });
    assert.equal("observedKinds" in payload, false);
    assert.equal(JSON.stringify(payload).includes("rawModelText"), false);
  });

  it("emits exactly one structured metadata line", () => {
    const original = console.info;
    const calls: unknown[][] = [];
    console.info = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      logSuggestedRepliesDecisionQualityTelemetry(
        buildSuggestedRepliesDecisionQualityTelemetry({
          source: "post-turn-shared",
          observation: {
            contractValid: true,
            issues: [],
            observedKinds: ["natural", "twist", "banter"],
            itemCount: 3,
          },
        })
      );
    } finally {
      console.info = original;
    }

    assert.equal(calls.length, 1);
    const line = String(calls[0]?.[0]);
    assert.equal(line.startsWith(SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX), true);
    assert.doesNotMatch(line, /natural.*twist.*banter/);
  });
});
