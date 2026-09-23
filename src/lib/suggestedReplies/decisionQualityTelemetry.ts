import type { SuggestedRepliesDecisionQualityObservation } from "./decisionQualityObservatory";

export type SuggestedRepliesDecisionQualityTelemetrySource =
  | "post-turn-shared"
  | "standalone-extract";

export type SuggestedRepliesDecisionQualityTelemetry = {
  event: "suggested_replies_decision_quality";
  source: SuggestedRepliesDecisionQualityTelemetrySource;
  contractValid: boolean;
  itemCount: number;
  issueCount: number;
  issues: SuggestedRepliesDecisionQualityObservation["issues"];
};

export const SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX =
  "[suggested-replies-decision-quality]";

export function buildSuggestedRepliesDecisionQualityTelemetry(input: {
  source: SuggestedRepliesDecisionQualityTelemetrySource;
  observation: SuggestedRepliesDecisionQualityObservation;
}): SuggestedRepliesDecisionQualityTelemetry {
  return {
    event: "suggested_replies_decision_quality",
    source: input.source,
    contractValid: input.observation.contractValid,
    itemCount: input.observation.itemCount,
    issueCount: input.observation.issues.length,
    issues: [...input.observation.issues].sort(),
  };
}

/** Production metadata-only log. Never pass raw model text or reply content here. */
export function logSuggestedRepliesDecisionQualityTelemetry(
  payload: SuggestedRepliesDecisionQualityTelemetry
): void {
  console.info(
    `${SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX} ${JSON.stringify(payload)}`
  );
}
