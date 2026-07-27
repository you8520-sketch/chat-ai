/** PR-S4B — Multi-observer witness resolution types (secret-blind). */

export const SCENE_WITNESS_RESOLVER_VERSION = 1;

export const MIN_AUTOMATIC_OBSERVATION_CONFIDENCE = 90;
export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 100;
export const MAX_WITNESS_CANDIDATES = 16;

export type ObservationModality =
  | "VISUAL"
  | "AUDITORY"
  | "DIRECT_ADDRESS"
  | "DOCUMENT_READ";

export type ObservationState = "OBSERVED" | "NOT_OBSERVED" | "UNKNOWN";

export type ObservationRunStatus = "STARTED" | "COMPLETED" | "FAILED";

export type ObservationReasonCode =
  | "EXPLICIT_TARGET"
  | "PRESENT_AND_CAPABLE"
  | "CURRENT_CHARACTER_SCOPE"
  | "SCENE_WIDE_EVENT"
  | "OBSERVER_NOT_REGISTERED"
  | "OBSERVER_INACTIVE"
  | "SCENE_MISMATCH"
  | "ABSENT"
  | "PRESENCE_UNKNOWN"
  | "UNCONSCIOUS"
  | "ASLEEP"
  | "INCAPACITATED"
  | "AWARENESS_UNKNOWN"
  | "VISUAL_BLOCKED"
  | "BLIND"
  | "VISUAL_CAPABILITY_UNKNOWN"
  | "AUDITORY_BLOCKED"
  | "DEAF"
  | "AUDITORY_CAPABILITY_UNKNOWN"
  | "LOCATION_MISMATCH"
  | "NOT_IN_EXPLICIT_OBSERVERS"
  | "VISIBILITY_UNKNOWN"
  | "SOURCE_NOT_AUTHORITATIVE"
  | "UNSUPPORTED_MODALITY"
  | "EVENT_CONFIDENCE_TOO_LOW"
  | "TOO_MANY_CANDIDATES"
  | "NO_ACTIVE_SCENE"
  | "NO_PRESENCE_ROW";

export type ObserverStateSnapshot = {
  presenceState: string;
  awarenessState: string;
  visualCapability: string;
  auditoryCapability: string;
  observerLocationKey: string | null;
  eventLocationKey: string | null;
  visibilityMode: string;
  presenceUpdatedAt: string | null;
  observerActive: boolean;
};

export type EventScopeSnapshot = {
  visibilityMode: string;
  observerIds?: string[];
  sceneId: string;
  sceneLocationKey: string | null;
  eventLocationKey: string | null;
  modality: ObservationModality | null;
  sceneWide: boolean;
  directPresentation: boolean;
  overcomesVisualObstruction: boolean;
};

export type SceneEventObservationRunRow = {
  id: string;
  idempotency_key: string;
  scene_evidence_event_id: string;
  chat_id: number;
  scene_id: string;
  resolver_version: number;
  status: ObservationRunStatus;
  candidate_count: number;
  observed_count: number;
  rejected_count: number;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
};

export type SceneEventObservationRow = {
  id: string;
  idempotency_key: string;
  observation_run_id: string;
  scene_evidence_event_id: string;
  chat_id: number;
  scene_id: string;
  turn_number: number;
  observer_type: string;
  observer_id: string;
  modality: ObservationModality;
  observation_state: ObservationState;
  reason_code: ObservationReasonCode;
  confidence: number;
  observer_state_snapshot_json: string;
  event_scope_snapshot_json: string;
  resolver_version: number;
  created_at: string;
};

export type SceneEventObservationDecision = {
  observerType: string;
  observerId: string;
  modality: ObservationModality;
  observationState: ObservationState;
  reasonCode: ObservationReasonCode;
  confidence: number;
  observerStateSnapshot: ObserverStateSnapshot;
  eventScopeSnapshot: EventScopeSnapshot;
};
