import type {
  BodyRegion,
  SceneEvidenceEventType,
  SceneEvidenceSource,
  SceneSubjectType,
} from "@/lib/sceneEvidenceTypes";
import { SCENE_EVIDENCE_EXTRACTOR_VERSION } from "@/lib/sceneEvidenceTypes";

export { SCENE_EVIDENCE_EXTRACTOR_VERSION };

export const SCENE_EVIDENCE_EVENT_TYPES = [
  "BODY_REGION_EXPOSED",
  "BODY_REGION_COVERED",
  "VISIBLE_MARK_PRESENTED",
  "VISIBLE_ITEM_PRESENTED",
  "VISIBLE_ITEM_EXPOSED",
  "ABILITY_MANIFESTED",
  "PHYSICAL_SYMPTOM_DISPLAYED",
  "DOCUMENT_PRESENTED",
  "IDENTITY_DOCUMENT_PRESENTED",
] as const satisfies readonly SceneEvidenceEventType[];

export const SCENE_EVIDENCE_SOURCES = [
  "USER_MESSAGE_DETERMINISTIC",
  "USER_EXPLICIT_ACTION",
  "SERVER_SCENE_EVENT",
  "CREATOR_TRIGGER",
] as const satisfies readonly SceneEvidenceSource[];

export const SCENE_SUBJECT_TYPES = [
  "USER",
  "CHARACTER",
  "ITEM",
  "DOCUMENT",
  "ENVIRONMENT",
] as const satisfies readonly SceneSubjectType[];

export const BODY_REGIONS = [
  "face",
  "neck",
  "shoulder",
  "upper_arm",
  "forearm",
  "hand",
  "chest",
  "abdomen",
  "upper_back",
  "lower_back",
  "waist",
  "thigh",
  "leg",
  "foot",
  "full_body",
  "unknown",
] as const satisfies readonly BodyRegion[];

/** Shared S4B witness-scope attributes (never secret-bearing). */
const WITNESS_SCOPE_ATTRIBUTES = [
  "locationKey",
  "sceneWide",
  "directPresentation",
  "overcomesVisualObstruction",
] as const;

/** Attribute allow-lists per event type. */
export const EVENT_ATTRIBUTE_SCHEMA: Record<
  SceneEvidenceEventType,
  { required: string[]; allowed: string[] }
> = {
  BODY_REGION_EXPOSED: {
    required: ["region"],
    allowed: ["region", "exposureLevel", ...WITNESS_SCOPE_ATTRIBUTES],
  },
  BODY_REGION_COVERED: {
    required: ["region"],
    allowed: ["region", ...WITNESS_SCOPE_ATTRIBUTES],
  },
  VISIBLE_MARK_PRESENTED: {
    required: ["markLabel"],
    allowed: ["markLabel", "region", ...WITNESS_SCOPE_ATTRIBUTES],
  },
  VISIBLE_ITEM_PRESENTED: {
    required: ["itemLabel"],
    allowed: ["itemLabel", ...WITNESS_SCOPE_ATTRIBUTES],
  },
  VISIBLE_ITEM_EXPOSED: {
    required: ["itemLabel"],
    allowed: ["itemLabel", ...WITNESS_SCOPE_ATTRIBUTES],
  },
  ABILITY_MANIFESTED: {
    required: ["manifestation"],
    allowed: ["manifestation", "target", "visibleEffect", ...WITNESS_SCOPE_ATTRIBUTES],
  },
  PHYSICAL_SYMPTOM_DISPLAYED: {
    required: ["symptom"],
    allowed: ["symptom", "severity", ...WITNESS_SCOPE_ATTRIBUTES],
  },
  DOCUMENT_PRESENTED: {
    required: ["documentLabel"],
    allowed: ["documentLabel", ...WITNESS_SCOPE_ATTRIBUTES],
  },
  IDENTITY_DOCUMENT_PRESENTED: {
    required: ["documentLabel"],
    allowed: ["documentLabel", ...WITNESS_SCOPE_ATTRIBUTES],
  },
};

/** Keys that must never appear in scene evidence attributes (secret leakage). */
export const FORBIDDEN_ATTRIBUTE_KEYS = [
  "secretId",
  "secret_id",
  "secretKey",
  "secret_key",
  "canonicalSecretText",
  "canonical_secret_text",
  "suspectedFactText",
  "suspected_fact_text",
  "confirmedFactText",
  "confirmed_fact_text",
  "secretTitle",
  "ownerTitle",
  "owner_title",
  "secretCategory",
  "discoveryRuleId",
  "discovery_rule_id",
  "knowledgeState",
  "knowledge_state",
  "secretDescription",
  "secret_description",
  "directDisclosureAlias",
  "aliases",
] as const;

export const MAX_ATTRIBUTE_STRING_CHARS = 64;
export const MAX_ATTRIBUTES = 8;

export const CONFIDENCE_EXPLICIT = 100;
export const CONFIDENCE_SERVER = 100;
export const CONFIDENCE_CREATOR = 100;
export const CONFIDENCE_DETERMINISTIC_MIN = 90;
export const CONFIDENCE_DETERMINISTIC_DEFAULT = 95;
