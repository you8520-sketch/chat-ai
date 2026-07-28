import {
  BODY_REGIONS,
  EVENT_ATTRIBUTE_SCHEMA,
  FORBIDDEN_ATTRIBUTE_KEYS,
  MAX_ATTRIBUTE_STRING_CHARS,
  MAX_ATTRIBUTES,
  SCENE_EVIDENCE_EVENT_TYPES,
  SCENE_EVIDENCE_SOURCES,
  SCENE_SUBJECT_TYPES,
} from "@/lib/sceneEvidenceCatalog";
import type {
  SceneEvidenceAttributeValue,
  SceneEvidenceDraft,
  SceneEvidenceEvent,
  SceneEvidenceEventType,
  SceneEvidenceVisibility,
} from "@/lib/sceneEvidenceTypes";

export type SceneEvidenceValidationResult =
  | { ok: true; event: SceneEvidenceDraft }
  | { ok: false; errorCode: string };

function isAllowedEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function validateVisibility(
  raw: unknown
): SceneEvidenceVisibility | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const mode = o.mode;
  if (
    mode !== "CURRENT_CHARACTER" &&
    mode !== "EXPLICIT_OBSERVERS" &&
    mode !== "SCENE_PARTICIPANTS" &&
    mode !== "UNKNOWN"
  ) {
    return null;
  }
  const out: SceneEvidenceVisibility = { mode };
  if (Array.isArray(o.observerIds)) {
    out.observerIds = o.observerIds.map((id) => String(id)).filter(Boolean).slice(0, 8);
  }
  if (typeof o.requiresLineOfSight === "boolean") {
    out.requiresLineOfSight = o.requiresLineOfSight;
  }
  if (typeof o.requiresHearing === "boolean") {
    out.requiresHearing = o.requiresHearing;
  }
  return out;
}

function sanitizeAttributeValue(
  value: unknown
): SceneEvidenceAttributeValue | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t || t.length > MAX_ATTRIBUTE_STRING_CHARS) return null;
    return t;
  }
  return null;
}

/**
 * Strict validator — rejects secret-bearing keys, unknown types/attrs, bad confidence.
 */
export function validateSceneEvidenceDraft(
  draft: SceneEvidenceDraft
): SceneEvidenceValidationResult {
  if (!isAllowedEnum(draft.eventType, SCENE_EVIDENCE_EVENT_TYPES)) {
    return { ok: false, errorCode: "UNKNOWN_EVENT_TYPE" };
  }
  if (!isAllowedEnum(draft.sourceType, SCENE_EVIDENCE_SOURCES)) {
    return { ok: false, errorCode: "INVALID_SOURCE_TYPE" };
  }
  if (!isAllowedEnum(draft.subjectType, SCENE_SUBJECT_TYPES)) {
    return { ok: false, errorCode: "INVALID_SUBJECT_TYPE" };
  }
  if (!Number.isFinite(draft.chatId) || draft.chatId <= 0) {
    return { ok: false, errorCode: "INVALID_CHAT_ID" };
  }
  if (!Number.isFinite(draft.turnNumber) || draft.turnNumber < 0) {
    return { ok: false, errorCode: "INVALID_TURN" };
  }
  if (
    !Number.isInteger(draft.confidence) ||
    draft.confidence < 0 ||
    draft.confidence > 100
  ) {
    return { ok: false, errorCode: "INVALID_CONFIDENCE" };
  }
  const subjectId = String(draft.subjectId ?? "").trim();
  if (!subjectId || subjectId.length > 64) {
    return { ok: false, errorCode: "INVALID_SUBJECT_ID" };
  }

  const visibility = validateVisibility(draft.visibility);
  if (!visibility) {
    return { ok: false, errorCode: "INVALID_VISIBILITY" };
  }

  const schema = EVENT_ATTRIBUTE_SCHEMA[draft.eventType as SceneEvidenceEventType];
  const attrsIn = draft.attributes ?? {};
  const keys = Object.keys(attrsIn);
  if (keys.length > MAX_ATTRIBUTES) {
    return { ok: false, errorCode: "TOO_MANY_ATTRIBUTES" };
  }
  for (const key of keys) {
    if (
      (FORBIDDEN_ATTRIBUTE_KEYS as readonly string[]).includes(key) ||
      /secret|knowledge|canonical|discovery/i.test(key)
    ) {
      return { ok: false, errorCode: "FORBIDDEN_ATTRIBUTE_KEY" };
    }
    if (!schema.allowed.includes(key)) {
      return { ok: false, errorCode: "UNKNOWN_ATTRIBUTE" };
    }
  }
  for (const req of schema.required) {
    if (!(req in attrsIn)) {
      return { ok: false, errorCode: "MISSING_REQUIRED_ATTRIBUTE" };
    }
  }

  const attributes: Record<string, SceneEvidenceAttributeValue> = {};
  for (const [key, raw] of Object.entries(attrsIn)) {
    const v = sanitizeAttributeValue(raw);
    if (v == null) {
      return { ok: false, errorCode: "INVALID_ATTRIBUTE_VALUE" };
    }
    attributes[key] = v;
  }

  if (draft.eventType === "BODY_REGION_EXPOSED" || draft.eventType === "BODY_REGION_COVERED") {
    if (!isAllowedEnum(attributes.region, BODY_REGIONS) || attributes.region === "unknown") {
      return { ok: false, errorCode: "INVALID_BODY_REGION" };
    }
  }

  return {
    ok: true,
    event: {
      ...draft,
      subjectId,
      attributes,
      visibility,
    },
  };
}

export function rowToSceneEvidenceEvent(row: {
  id: string;
  idempotency_key: string;
  chat_id: number;
  turn_number: number;
  source_message_id: number | null;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor_type: string | null;
  actor_id: string | null;
  source_type: string;
  confidence: number;
  attributes_json: string;
  visibility_json: string;
  extractor_version: number;
}): SceneEvidenceEvent {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    chatId: row.chat_id,
    turnNumber: row.turn_number,
    sourceMessageId: row.source_message_id,
    eventType: row.event_type as SceneEvidenceEventType,
    subjectType: row.subject_type as SceneEvidenceEvent["subjectType"],
    subjectId: row.subject_id,
    actorType: (row.actor_type as SceneEvidenceEvent["actorType"]) ?? null,
    actorId: row.actor_id,
    sourceType: row.source_type as SceneEvidenceEvent["sourceType"],
    confidence: row.confidence,
    attributes: JSON.parse(row.attributes_json || "{}") as Record<
      string,
      SceneEvidenceAttributeValue
    >,
    visibility: JSON.parse(row.visibility_json || "{}") as SceneEvidenceVisibility,
    extractorVersion: row.extractor_version,
  };
}
