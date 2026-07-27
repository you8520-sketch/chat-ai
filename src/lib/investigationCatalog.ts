import type {
  InvestigationActionType,
  InvestigationResultType,
  InvestigationTargetType,
} from "@/lib/investigationTypes";
import {
  INVESTIGATION_MATCHER_VERSION,
  INVESTIGATION_RESOLVER_VERSION,
} from "@/lib/investigationTypes";

export { INVESTIGATION_MATCHER_VERSION, INVESTIGATION_RESOLVER_VERSION };

export const INVESTIGATION_MIN_COMPILER_CONFIDENCE = 0.9;
export const INVESTIGATION_MIN_RESULT_CONFIDENCE = 90;

export const INVESTIGATION_RESULT_TYPES = [
  "DOCUMENT_CONTENT_VERIFIED",
  "FINANCIAL_RECORD_FOUND",
  "DEBT_RECORD_CONFIRMED",
  "IDENTITY_RECORD_MATCH",
  "IDENTITY_RECORD_MISMATCH",
  "IDENTITY_ORIGIN_CONFIRMED",
  "MEDICAL_CONDITION_INDICATED",
  "MEDICAL_CONDITION_CONFIRMED",
  "ABILITY_COST_INDICATED",
  "ABILITY_COST_CONFIRMED",
  "MARK_MEANING_IDENTIFIED",
  "ORGANIZATION_AFFILIATION_INDICATED",
  "ORGANIZATION_AFFILIATION_CONFIRMED",
  "PAST_EVENT_RECORD_FOUND",
  "ITEM_IDENTITY_CONFIRMED",
  "TRUSTED_TESTIMONY_RECEIVED",
] as const satisfies readonly InvestigationResultType[];

export const INVESTIGATION_ACTION_TYPES = [
  "READ_DOCUMENT",
  "VERIFY_DOCUMENT",
  "SEARCH_RECORDS",
  "CHECK_FINANCIAL_RECORDS",
  "VERIFY_IDENTITY",
  "RUN_MEDICAL_EXAM",
  "RUN_FORENSIC_EXAM",
  "EXAMINE_ITEM",
  "SEARCH_LOCATION",
  "INTERVIEW_WITNESS",
  "QUERY_DATABASE",
] as const satisfies readonly InvestigationActionType[];

export const INVESTIGATION_TARGET_TYPES = [
  "DOCUMENT",
  "FINANCIAL_RECORD",
  "IDENTITY_RECORD",
  "MEDICAL_RECORD",
  "FORENSIC_RESULT",
  "ORGANIZATION_RECORD",
  "ITEM_EXAMINATION",
  "LOCATION_SEARCH",
  "TRUSTED_TESTIMONY",
  "SYSTEM_DATABASE",
] as const satisfies readonly InvestigationTargetType[];

/** Immediate (V1) actions — delayed investigations are out of scope. */
export const IMMEDIATE_INVESTIGATION_ACTIONS = new Set<InvestigationActionType>([
  "READ_DOCUMENT",
  "VERIFY_DOCUMENT",
  "EXAMINE_ITEM",
  "VERIFY_IDENTITY",
  "CHECK_FINANCIAL_RECORDS",
  "RUN_MEDICAL_EXAM",
  "QUERY_DATABASE",
]);

export function resultStateRank(state: "PARTIAL" | "VERIFIED"): number {
  return state === "VERIFIED" ? 2 : 1;
}

export function resultStateSatisfies(
  actual: "PARTIAL" | "VERIFIED",
  minimum: "PARTIAL" | "VERIFIED"
): boolean {
  return resultStateRank(actual) >= resultStateRank(minimum);
}
