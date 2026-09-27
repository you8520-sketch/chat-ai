import {
  inspectSuggestedRepliesModelTextContract,
  SUGGESTED_REPLIES_MODEL_CONTRACT_ISSUES,
  type SuggestedRepliesModelContractIssue,
} from "./parse";
import type { SuggestedReplyKind } from "./types";

export const SUGGESTED_REPLIES_DECISION_QUALITY_ISSUES =
  SUGGESTED_REPLIES_MODEL_CONTRACT_ISSUES;

export type SuggestedRepliesDecisionQualityIssue =
  SuggestedRepliesModelContractIssue;

export type SuggestedRepliesDecisionQualityObservation = {
  contractValid: boolean;
  issues: SuggestedRepliesDecisionQualityIssue[];
  observedKinds: SuggestedReplyKind[];
  itemCount: number;
};

/**
 * P3-A read-only observatory for the existing suggested-replies AI decision.
 *
 * The raw model contract remains the quality-observation owner. Production
 * acceptance may safely normalize recoverable length defects, while this
 * wrapper preserves the strict classification for telemetry/offline evidence
 * without creating a second validator, retry, or provider call.
 */
export function observeSuggestedRepliesDecisionQuality(
  rawModelText: string
): SuggestedRepliesDecisionQualityObservation {
  const inspection = inspectSuggestedRepliesModelTextContract(rawModelText);
  return {
    contractValid: inspection.contractValid,
    issues: inspection.issues,
    observedKinds: inspection.observedKinds,
    itemCount: inspection.itemCount,
  };
}
