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

export type EpisodicEvidenceRole = "user" | "assistant";

/**
 * Extractor-proposed source span. Model output only: the server resolves the
 * message id and decides authority from the canonical message row.
 */
export type EpisodicFactEvidenceClaim = {
  source_role: EpisodicEvidenceRole;
  source_quote: string;
};

export type EpisodicExtractedFact = {
  category: EpisodicFactCategory;
  subject: string;
  attribute: string;
  value: string;
  importance: EpisodicFactImportance;
  fact_text: string;
  /** Optional only for legacy stored facts and internal fixtures. New model output requires it. */
  evidence_type?: EpisodicFactEvidenceType;
  /** Required for Shared Initial output; absent on legacy stored facts and internal fixtures. */
  evidence?: EpisodicFactEvidenceClaim;
  /**
   * Server-resolved from a correction handle the server offered this turn (never read from
   * raw model output). The save path validates it before storing `metadata.correction`.
   */
  correction_target_fact_id?: number;
};

/** Batch user source for 5-turn seal evidence provenance validation. */
export type EpisodicBatchUserSource = {
  turn: number;
  messageId: number | null;
  text: string;
};
