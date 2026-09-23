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

export type SuggestedRepliesDecisionQualityAggregateSample = {
  contractValid: boolean;
  issues: readonly SuggestedRepliesDecisionQualityIssue[];
};

/**
 * Canonical pure aggregate owner for P3-A suggested-reply decision-quality evidence.
 *
 * It intentionally returns counts only: no raw model text, repaired output,
 * persistence side effects, provider calls, routing, retries, or billing data.
 */
export function aggregateSuggestedRepliesDecisionQualitySamples(
  samples: readonly SuggestedRepliesDecisionQualityAggregateSample[]
): SuggestedRepliesDecisionQualityAggregate {
  let validCount = 0;
  let invalidCount = 0;
  let multiIssueSampleCount = 0;
  const counts = new Map<SuggestedRepliesDecisionQualityIssue, number>();

  for (const sample of samples) {
    if (sample.contractValid) validCount += 1;
    else invalidCount += 1;

    if (sample.issues.length > 1) multiIssueSampleCount += 1;

    for (const issue of sample.issues) {
      counts.set(issue, (counts.get(issue) ?? 0) + 1);
    }
  }

  return {
    sampleCount: samples.length,
    validCount,
    invalidCount,
    multiIssueSampleCount,
    issueCounts: [...counts.entries()]
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => a.issue.localeCompare(b.issue)),
  };
}

export function aggregateSuggestedRepliesDecisionQuality(
  rawModelTexts: readonly string[]
): SuggestedRepliesDecisionQualityAggregate {
  return aggregateSuggestedRepliesDecisionQualitySamples(
    rawModelTexts.map((rawModelText) => observeSuggestedRepliesDecisionQuality(rawModelText))
  );
}
