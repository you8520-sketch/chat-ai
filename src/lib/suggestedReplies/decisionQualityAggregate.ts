import {
  observeSuggestedRepliesDecisionQuality,
  type SuggestedRepliesDecisionQualityIssue,
} from "./decisionQualityObservatory";

export type SuggestedRepliesDecisionQualityIssueCount = {
  issue: SuggestedRepliesDecisionQualityIssue;
  count: number;
};

export type SuggestedRepliesDecisionQualityAggregate = {
  sampleCount: number;
  validCount: number;
  invalidCount: number;
  multiIssueSampleCount: number;
  issueCounts: SuggestedRepliesDecisionQualityIssueCount[];
};

/**
 * Pure aggregate owner for P3-A suggested-reply decision-quality evidence.
 *
 * It intentionally returns counts only: no raw model text, repaired output,
 * persistence side effects, provider calls, routing, retries, or billing data.
 */
export function aggregateSuggestedRepliesDecisionQuality(
  rawModelTexts: readonly string[]
): SuggestedRepliesDecisionQualityAggregate {
  let validCount = 0;
  let invalidCount = 0;
  let multiIssueSampleCount = 0;
  const counts = new Map<SuggestedRepliesDecisionQualityIssue, number>();

  for (const rawModelText of rawModelTexts) {
    const observation = observeSuggestedRepliesDecisionQuality(rawModelText);

    if (observation.contractValid) validCount += 1;
    else invalidCount += 1;

    if (observation.issues.length > 1) multiIssueSampleCount += 1;

    for (const issue of observation.issues) {
      counts.set(issue, (counts.get(issue) ?? 0) + 1);
    }
  }

  return {
    sampleCount: rawModelTexts.length,
    validCount,
    invalidCount,
    multiIssueSampleCount,
    issueCounts: [...counts.entries()]
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => a.issue.localeCompare(b.issue)),
  };
}
