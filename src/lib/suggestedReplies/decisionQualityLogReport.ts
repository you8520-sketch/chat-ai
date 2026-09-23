import {
  aggregateSuggestedRepliesDecisionQualitySamples,
  type SuggestedRepliesDecisionQualityAggregate,
  type SuggestedRepliesDecisionQualityAggregateSample,
} from "./decisionQualityAggregate";
import {
  SUGGESTED_REPLIES_DECISION_QUALITY_ISSUES,
  type SuggestedRepliesDecisionQualityIssue,
} from "./decisionQualityObservatory";
import {
  SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX,
  type SuggestedRepliesDecisionQualityTelemetrySource,
} from "./decisionQualityTelemetry";

export type SuggestedRepliesDecisionQualityLogReport = {
  telemetryRowCount: number;
  skippedMalformedTelemetryRows: number;
  overall: SuggestedRepliesDecisionQualityAggregate;
  bySource: Record<
    SuggestedRepliesDecisionQualityTelemetrySource,
    SuggestedRepliesDecisionQualityAggregate
  >;
};

const ISSUE_SET = new Set<string>(SUGGESTED_REPLIES_DECISION_QUALITY_ISSUES);
const SOURCES = ["post-turn-shared", "standalone-extract"] as const;

type ParsedTelemetrySample = SuggestedRepliesDecisionQualityAggregateSample & {
  source: SuggestedRepliesDecisionQualityTelemetrySource;
};

function parseTelemetryPayload(value: unknown): ParsedTelemetrySample | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.event !== "suggested_replies_decision_quality") return null;
  if (!SOURCES.includes(row.source as SuggestedRepliesDecisionQualityTelemetrySource)) return null;
  if (typeof row.contractValid !== "boolean") return null;
  if (!Array.isArray(row.issues)) return null;
  if (!row.issues.every((issue) => typeof issue === "string" && ISSUE_SET.has(issue))) return null;
  if (
    typeof row.issueCount !== "number" ||
    !Number.isInteger(row.issueCount) ||
    row.issueCount !== row.issues.length
  ) {
    return null;
  }

  return {
    source: row.source as SuggestedRepliesDecisionQualityTelemetrySource,
    contractValid: row.contractValid,
    issues: row.issues as SuggestedRepliesDecisionQualityIssue[],
  };
}

/**
 * Parse exported server/Railway logs into a counts-only report.
 * Unrelated lines are ignored. Prefixed but malformed telemetry rows are counted
 * and discarded. Raw log text and reply content are never returned.
 */
export function buildSuggestedRepliesDecisionQualityLogReport(
  logText: string
): SuggestedRepliesDecisionQualityLogReport {
  const samples: ParsedTelemetrySample[] = [];
  let skippedMalformedTelemetryRows = 0;

  for (const line of logText.split(/\r?\n/)) {
    const idx = line.indexOf(SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX);
    if (idx < 0) continue;

    const rawPayload = line
      .slice(idx + SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX.length)
      .trim();
    try {
      const parsed = parseTelemetryPayload(JSON.parse(rawPayload));
      if (parsed) samples.push(parsed);
      else skippedMalformedTelemetryRows += 1;
    } catch {
      skippedMalformedTelemetryRows += 1;
    }
  }

  const sourceSamples = (source: SuggestedRepliesDecisionQualityTelemetrySource) =>
    samples.filter((sample) => sample.source === source);

  return {
    telemetryRowCount: samples.length,
    skippedMalformedTelemetryRows,
    overall: aggregateSuggestedRepliesDecisionQualitySamples(samples),
    bySource: {
      "post-turn-shared": aggregateSuggestedRepliesDecisionQualitySamples(
        sourceSamples("post-turn-shared")
      ),
      "standalone-extract": aggregateSuggestedRepliesDecisionQualitySamples(
        sourceSamples("standalone-extract")
      ),
    },
  };
}
