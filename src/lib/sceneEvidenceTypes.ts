/** PR-S2A — Secret-blind Scene Evidence types (no persona-secret fields). */

export const SCENE_EVIDENCE_EXTRACTOR_VERSION = 1;

export type SceneEvidenceSource =
  | "USER_MESSAGE_DETERMINISTIC"
  | "USER_EXPLICIT_ACTION"
  | "SERVER_SCENE_EVENT"
  | "CREATOR_TRIGGER";

export type SceneSubjectType =
  | "USER"
  | "CHARACTER"
  | "ITEM"
  | "DOCUMENT"
  | "ENVIRONMENT";

export type SceneActorType = "USER" | "CHARACTER" | "SERVER";

export type SceneEvidenceEventType =
  | "BODY_REGION_EXPOSED"
  | "BODY_REGION_COVERED"
  | "VISIBLE_MARK_PRESENTED"
  | "VISIBLE_ITEM_PRESENTED"
  | "VISIBLE_ITEM_EXPOSED"
  | "ABILITY_MANIFESTED"
  | "PHYSICAL_SYMPTOM_DISPLAYED"
  | "DOCUMENT_PRESENTED"
  | "IDENTITY_DOCUMENT_PRESENTED";

export type BodyRegion =
  | "face"
  | "neck"
  | "shoulder"
  | "upper_arm"
  | "forearm"
  | "hand"
  | "chest"
  | "abdomen"
  | "upper_back"
  | "lower_back"
  | "waist"
  | "thigh"
  | "leg"
  | "foot"
  | "full_body"
  | "unknown";

export type SceneEvidenceVisibilityMode =
  | "CURRENT_CHARACTER"
  | "EXPLICIT_OBSERVERS"
  | "SCENE_PARTICIPANTS"
  | "UNKNOWN";

export type SceneEvidenceVisibility = {
  mode: SceneEvidenceVisibilityMode;
  observerIds?: string[];
  requiresLineOfSight?: boolean;
  requiresHearing?: boolean;
};

export type SceneEvidenceAttributeValue = string | number | boolean;

/** USER-authored high-precision document ownership attribution (secret-blind). */
export type DocumentSubject = "PERSONA_SELF";

export type SceneEvidenceEvent = {
  id: string;
  idempotencyKey: string;
  chatId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  eventType: SceneEvidenceEventType;
  subjectType: SceneSubjectType;
  subjectId: string;
  actorType?: SceneActorType | null;
  actorId?: string | null;
  sourceType: SceneEvidenceSource;
  confidence: number;
  attributes: Record<string, SceneEvidenceAttributeValue>;
  visibility: SceneEvidenceVisibility;
  extractorVersion: number;
};

/** Explicit UI action metadata — never carries secret fields. */
export type SceneEvidenceExplicitAction =
  | { actionType: "EXPOSE_BODY_REGION"; region: BodyRegion; exposureLevel?: string }
  | { actionType: "COVER_BODY_REGION"; region: BodyRegion }
  | { actionType: "PRESENT_ITEM"; itemLabel: string }
  | { actionType: "PRESENT_VISIBLE_MARK"; markLabel: string }
  | { actionType: "PRESENT_DOCUMENT"; documentLabel: string }
  | { actionType: "MANIFEST_ABILITY"; manifestation: string; visibleEffect?: string }
  | { actionType: "DISPLAY_SYMPTOM"; symptom: string; severity?: string };

/** Server-authoritative scene event — not derived from assistant prose. */
export type SceneEvidenceServerEvent = {
  eventType: SceneEvidenceEventType;
  subjectType?: SceneSubjectType;
  subjectId?: string;
  attributes: Record<string, SceneEvidenceAttributeValue>;
  visibility?: SceneEvidenceVisibility;
  confidence?: number;
};

/**
 * Secret-blind extractor input — MUST NOT include secret source/rules/knowledge.
 * Public persona identity only (display name / id), never secret_description.
 */
export type SceneEvidenceExtractorInput = {
  chatId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  /** Current user message text only. */
  userMessage?: string;
  /** Explicit UI actions from the client request. */
  explicitActions?: SceneEvidenceExplicitAction[];
  /** Server-authoritative events already decided outside assistant prose. */
  serverEvents?: SceneEvidenceServerEvent[];
  /** Creator-authored trigger events. */
  creatorTriggers?: SceneEvidenceServerEvent[];
  /** Public persona identity (never secret fields). */
  publicPersonaId?: number | null;
  publicPersonaDisplayName?: string | null;
  /** Rollout / allowlist context for Discovery kill switch. */
  userId?: number | null;
};

export type SceneEvidenceDraft = Omit<
  SceneEvidenceEvent,
  "id" | "idempotencyKey" | "extractorVersion"
> & {
  extractorVersion?: number;
};

export type SceneEvidencePersistResult = {
  inserted: SceneEvidenceEvent[];
  reused: SceneEvidenceEvent[];
};
