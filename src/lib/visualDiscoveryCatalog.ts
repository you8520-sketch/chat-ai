import type { SceneEvidenceEventType } from "@/lib/sceneEvidenceTypes";

export const VISUAL_DISCOVERY_MATCHER_VERSION = 1;

/** Minimum compiler confidence (0–1) for runtime visual eligibility. */
export const VISUAL_RULE_MIN_COMPILER_CONFIDENCE = 0.9;

/** Minimum scene-event confidence (0–100). */
export const VISUAL_EVENT_MIN_CONFIDENCE = 90;

export const VISUAL_EVIDENCE_KINDS = [
  "BODY_REGION_EXPOSED",
  "VISIBLE_MARK_SHOWN",
  "VISIBLE_ITEM_PRESENTED",
  "VISIBLE_ITEM_EXPOSED",
  "ABILITY_MANIFESTED",
  "PHYSICAL_SYMPTOM_DISPLAYED",
  "PHYSICAL_SYMPTOM_OBSERVED",
  "DOCUMENT_PRESENTED",
  "IDENTITY_DOCUMENT_PRESENTED",
] as const;

export type VisualEvidenceKind = (typeof VISUAL_EVIDENCE_KINDS)[number];

/** Explicit evidenceKind → scene eventType mapping (no fuzzy match). */
export const VISUAL_EVIDENCE_TO_SCENE_EVENT: Record<
  VisualEvidenceKind,
  SceneEvidenceEventType
> = {
  BODY_REGION_EXPOSED: "BODY_REGION_EXPOSED",
  VISIBLE_MARK_SHOWN: "VISIBLE_MARK_PRESENTED",
  VISIBLE_ITEM_PRESENTED: "VISIBLE_ITEM_PRESENTED",
  VISIBLE_ITEM_EXPOSED: "VISIBLE_ITEM_EXPOSED",
  ABILITY_MANIFESTED: "ABILITY_MANIFESTED",
  PHYSICAL_SYMPTOM_DISPLAYED: "PHYSICAL_SYMPTOM_DISPLAYED",
  PHYSICAL_SYMPTOM_OBSERVED: "PHYSICAL_SYMPTOM_DISPLAYED",
  DOCUMENT_PRESENTED: "DOCUMENT_PRESENTED",
  IDENTITY_DOCUMENT_PRESENTED: "IDENTITY_DOCUMENT_PRESENTED",
};

export function knowledgeStateRank(
  state: "UNKNOWN" | "SUSPECTED" | "CONFIRMED"
): number {
  if (state === "CONFIRMED") return 2;
  if (state === "SUSPECTED") return 1;
  return 0;
}
