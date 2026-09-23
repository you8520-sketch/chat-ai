import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSuggestedRepliesDecisionQualityLogReport } from "./decisionQualityLogReport";
import { SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX } from "./decisionQualityTelemetry";

function line(payload: unknown): string {
  return `${SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX} ${JSON.stringify(payload)}`;
}

describe("P3-A suggested replies decision-quality log report", () => {
  it("aggregates metadata-only telemetry by source and drops malformed rows", () => {
    const secret = "RAW-REPLY-MUST-NOT-LEAK";
    const text = [
      "unrelated server log",
      line({
        event: "suggested_replies_decision_quality",
        source: "post-turn-shared",
        contractValid: true,
        itemCount: 3,
        issueCount: 0,
        issues: [],
      }),
      line({
        event: "suggested_replies_decision_quality",
        source: "standalone-extract",
        contractValid: false,
        itemCount: 3,
        issueCount: 2,
        issues: ["duplicate_text", "missing_kind"],
      }),
      `${SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX} not-json-${secret}`,
      line({
        event: "suggested_replies_decision_quality",
        source: "unknown-source",
        contractValid: false,
        itemCount: 0,
        issueCount: 1,
        issues: ["malformed_json"],
        rawModelText: secret,
      }),
    ].join("\n");

    const report = buildSuggestedRepliesDecisionQualityLogReport(text);

    assert.equal(report.telemetryRowCount, 2);
    assert.equal(report.skippedMalformedTelemetryRows, 2);
    assert.deepEqual(report.overall, {
      sampleCount: 2,
      validCount: 1,
      invalidCount: 1,
      multiIssueSampleCount: 1,
      issueCounts: [
        { issue: "duplicate_text", count: 1 },
        { issue: "missing_kind", count: 1 },
      ],
    });
    assert.equal(report.bySource["post-turn-shared"].sampleCount, 1);
    assert.equal(report.bySource["standalone-extract"].sampleCount, 1);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(JSON.stringify(report).includes("rawModelText"), false);
  });

  it("returns a stable zero report when no telemetry rows exist", () => {
    const report = buildSuggestedRepliesDecisionQualityLogReport("ordinary log only");
    assert.equal(report.telemetryRowCount, 0);
    assert.equal(report.skippedMalformedTelemetryRows, 0);
    assert.equal(report.overall.sampleCount, 0);
    assert.equal(report.bySource["post-turn-shared"].sampleCount, 0);
    assert.equal(report.bySource["standalone-extract"].sampleCount, 0);
  });
});
