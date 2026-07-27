/** PR-S3 — Investigation Discovery types (S3A/S3B). */

export const INVESTIGATION_RESOLVER_VERSION = 1;
export const INVESTIGATION_MATCHER_VERSION = 1;

export type InvestigationStatus =
  | "REQUESTED"
  | "REJECTED"
  | "FAILED"
  | "PARTIAL"
  | "SUCCEEDED";

export type InvestigationTargetType =
  | "DOCUMENT"
  | "FINANCIAL_RECORD"
  | "IDENTITY_RECORD"
  | "MEDICAL_RECORD"
  | "FORENSIC_RESULT"
  | "ORGANIZATION_RECORD"
  | "ITEM_EXAMINATION"
  | "LOCATION_SEARCH"
  | "TRUSTED_TESTIMONY"
  | "SYSTEM_DATABASE";

export type InvestigationActionType =
  | "READ_DOCUMENT"
  | "VERIFY_DOCUMENT"
  | "SEARCH_RECORDS"
  | "CHECK_FINANCIAL_RECORDS"
  | "VERIFY_IDENTITY"
  | "RUN_MEDICAL_EXAM"
  | "RUN_FORENSIC_EXAM"
  | "EXAMINE_ITEM"
  | "SEARCH_LOCATION"
  | "INTERVIEW_WITNESS"
  | "QUERY_DATABASE";

export type InvestigationResultType =
  | "DOCUMENT_CONTENT_VERIFIED"
  | "FINANCIAL_RECORD_FOUND"
  | "DEBT_RECORD_CONFIRMED"
  | "IDENTITY_RECORD_MATCH"
  | "IDENTITY_RECORD_MISMATCH"
  | "IDENTITY_ORIGIN_CONFIRMED"
  | "MEDICAL_CONDITION_INDICATED"
  | "MEDICAL_CONDITION_CONFIRMED"
  | "ABILITY_COST_INDICATED"
  | "ABILITY_COST_CONFIRMED"
  | "MARK_MEANING_IDENTIFIED"
  | "ORGANIZATION_AFFILIATION_INDICATED"
  | "ORGANIZATION_AFFILIATION_CONFIRMED"
  | "PAST_EVENT_RECORD_FOUND"
  | "ITEM_IDENTITY_CONFIRMED"
  | "TRUSTED_TESTIMONY_RECEIVED";

export type InvestigationResultState = "PARTIAL" | "VERIFIED";

export type InvestigationSourceType =
  | "USER_EXPLICIT_ACTION"
  | "USER_MESSAGE_DETERMINISTIC"
  | "SERVER_SCENE_EVENT"
  | "CREATOR_TRIGGER";

/** Alias used by attempt persistence. */
export type InvestigationAttemptSourceType = InvestigationSourceType;

export type InvestigationFailureCode =
  | "TARGET_NOT_FOUND"
  | "ACTION_NOT_ALLOWED"
  | "ACCESS_DENIED"
  | "DELAYED_NOT_SUPPORTED"
  | "UNSUPPORTED_ACTION"
  | "INVALID_REQUEST"
  | "WITNESS_NOT_TRUSTED"
  | "RESULT_PAYLOAD_INVALID";

export type InvestigationOwnerScope =
  | "CHAT"
  | "PERSONA"
  | "WORLD"
  | "CREATOR";

export type InvestigationTargetRow = {
  id: string;
  owner_scope: InvestigationOwnerScope;
  owner_id: string | null;
  target_type: InvestigationTargetType;
  target_key: string;
  display_label: string;
  required_access_json: string;
  result_payload_json: string;
  is_active: number;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type InvestigationAttemptRow = {
  id: string;
  idempotency_key: string;
  chat_id: number;
  turn_number: number;
  source_message_id: number | null;
  actor_type: string;
  actor_id: string;
  target_id: string | null;
  target_type: string;
  target_key: string;
  action_type: string;
  source_type: string;
  request_json: string;
  status: InvestigationStatus;
  failure_code: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type InvestigationResultRow = {
  id: string;
  idempotency_key: string;
  attempt_id: string;
  chat_id: number;
  turn_number: number;
  target_id: string | null;
  result_type: InvestigationResultType;
  result_state: InvestigationResultState;
  result_tags_json: string;
  observable_facts_json: string;
  observer_type: string;
  observer_id: string;
  source_type: string;
  confidence: number;
  resolver_version: number;
  created_at: string;
};

/** Secret-blind S3A input — never includes persona secret fields. */
export type InvestigationResolveInput = {
  chatId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  /** Explicit UI / client actions. */
  explicitActions?: InvestigationExplicitAction[];
  /** Current user message for high-precision request candidates only. */
  userMessage?: string;
  /**
   * Server/creator authoritative outcomes already decided outside assistant prose.
   * Still must reference an existing targetKey.
   */
  authoritativeOutcomes?: InvestigationAuthoritativeOutcome[];
};

export type InvestigationExplicitAction = {
  actionType: InvestigationActionType;
  targetKey: string;
};

export type InvestigationAuthoritativeOutcome = {
  actionType: InvestigationActionType;
  targetKey: string;
  sourceType: "SERVER_SCENE_EVENT" | "CREATOR_TRIGGER";
  /** Optional override; otherwise target payload is used. */
  resultType?: InvestigationResultType;
  resultState?: InvestigationResultState;
  resultTags?: string[];
  observableFacts?: string[];
  confidence?: number;
};

export type InvestigationResultPayload = {
  resultType: InvestigationResultType;
  resultState: InvestigationResultState;
  resultTags: string[];
  observableFacts: string[];
  requiredAccess?: {
    requiresPresentedDocument?: boolean;
    requiresItemLabel?: string;
    allowedActions?: InvestigationActionType[];
  };
};

export type InvestigationResultView = {
  id: string;
  attemptId: string;
  chatId: number;
  turnNumber: number;
  targetId: string | null;
  resultType: InvestigationResultType;
  resultState: InvestigationResultState;
  resultTags: string[];
  observableFacts: string[];
  observerType: "CHARACTER";
  observerId: string;
  sourceType: InvestigationSourceType;
  confidence: number;
  resolverVersion: number;
};
