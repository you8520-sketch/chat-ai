/**
 * Episodic fact schema — memory layer owns types; status widget re-exports for compatibility.
 */
export type EpisodicFactCategory =
  | "relationship"
  | "character"
  | "setting"
  | "item"
  | "preference"
  | "rule"
  | "quest"
  | "location"
  | "organization";

export type EpisodicFactImportance = "critical" | "important" | "normal";

/**
 * Why an episodic extractor may promote scene detail into durable memory.
 * `assistant_inference` is intentionally not a valid value.
 */
export type EpisodicFactEvidenceType =
  | "explicit_user_statement"
  | "explicit_scene_event"
  | "explicit_character_claim"
  /** Legacy metadata only; new model output must never duplicate canon into episodic memory. */
  | "canon";

export type EpisodicExtractedFact = {
  category: EpisodicFactCategory;
  subject: string;
  attribute: string;
  value: string;
  importance: EpisodicFactImportance;
  fact_text: string;
  /** Optional only for legacy stored facts and internal fixtures. New model output requires it. */
  evidence_type?: EpisodicFactEvidenceType;
};

/** Batch user source for 5-turn seal evidence provenance validation. */
export type EpisodicBatchUserSource = {
  turn: number;
  messageId: number | null;
  text: string;
};
