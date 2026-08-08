/**
 * RP Quality Vector V2 — shared evaluation schema (Phase D).
 * Prompt rules are NOT encoded here; these are evaluation bands / alarms only.
 */

export type LengthBand =
  | "IDEAL"
  | "SOFT_ACCEPT"
  | "REVIEW_REQUIRED"
  | "STRONG_LENGTH_REGRESSION"
  | "DENSITY_COLLAPSE";

export type LengthMetrics = {
  visible_chars_with_spaces: number;
  visible_chars_no_whitespace: number;
  provider_raw_chars: number | null;
  final_display_chars: number | null;
  length_band: LengthBand;
  length_ratio_vs_pair: number | null;
  finish_reason: string | null;
  saw_done: boolean | null;
  incomplete: boolean | null;
};

export type CompositionMetrics = {
  dialogue_chars: number;
  narration_chars: number;
  dialogue_char_share: number;
  narration_char_share: number;
  dialogue_paragraph_count: number;
  narration_paragraph_count: number;
  /** Renamed from legacy dialogue_share — paragraph-based. */
  dialogue_paragraph_share: number;
  composition_parse_uncertain: boolean;
  dialogue_heavy_review: boolean;
  strong_dialogue_dominance: boolean;
};

export type DialogueFragmentationMetrics = {
  dialogue_paragraph_count: number;
  speaker_run_count: number;
  same_speaker_dialogue_fragments: number;
  same_speaker_fragment_ratio: number;
  narration_insertions_between_same_speaker_dialogue: number;
  single_sentence_dialogue_paragraphs: number;
  max_consecutive_short_dialogue_run: number;
  speaker_split_review_required: boolean;
};

export type NarrationFragmentationMetrics = {
  one_sentence_narration_ratio: number;
  consecutive_one_sentence_narration_runs: number;
  max_short_narration_run: number;
  avg_narration_paragraph_chars: number;
  median_narration_paragraph_chars: number;
};

export type SettingSourceBucket =
  | "CHARACTER_CANON"
  | "USER_PERSONA"
  | "WORLD_CANON"
  | "MEMORY"
  | "CURRENT_USER_INPUT";

export type ExactOverlapHit = {
  bucket: SettingSourceBucket;
  overlap_chars: number;
  snippet: string;
};

export type SettingExactOverlapAudit = {
  longest_common_substring_chars: number;
  matching_ngram_count: number;
  source_overlap_span_count: number;
  hits: ExactOverlapHit[];
  alarm_18_plus: boolean;
};

/** Human-assigned 0–3 recital scores (documented schema). */
export type SettingRecitalHumanScores = {
  CHARACTER_PROFILE_RECITAL: 0 | 1 | 2 | 3;
  USER_PERSONA_PARROT: 0 | 1 | 2 | 3;
  WORLD_LORE_BRIEFING: 0 | 1 | 2 | 3;
  MEMORY_RECITAL: 0 | 1 | 2 | 3;
  STATIC_FACT_BURST: 0 | 1 | 2;
  KNOWLEDGE_LEAK: 0 | 1;
  ACTIVE_CANON_USE: 0 | 1 | 2;
  AMBIENT_CANON_USE: 0 | 1 | 2;
};

export type ContinuityAutoAuditRef = {
  current_input_lcs_chars: number;
  current_input_overlap_alarm: boolean;
  current_input_dialogue_echo: boolean;
  recent_assistant_lcs_chars: number;
  recent_assistant_overlap_alarm: boolean;
  opening_paragraph_mirrors_prior: boolean;
  intra_turn_abstract_restatement_hits: number;
  intra_turn_reexplanation_alarm: boolean;
  continuity_review_required: boolean;
  alarms: string[];
};

export type RpQualityVectorV2 = {
  completion: {
    finish_reason: string | null;
    saw_done: boolean | null;
    incomplete: boolean | null;
  };
  length: LengthMetrics;
  composition: CompositionMetrics;
  dialogue_fragmentation: DialogueFragmentationMetrics;
  narration_fragmentation: NarrationFragmentationMetrics;
  setting_exact_overlap: SettingExactOverlapAudit | null;
  continuity: ContinuityAutoAuditRef | null;
  hard_alarms: string[];
};

export const LENGTH_BANDS = {
  IDEAL_MIN: 3200,
  IDEAL_MAX: 4200,
  SOFT_ACCEPT_MIN: 2800,
  REVIEW_REQUIRED_MIN: 2400,
  STRONG_REGRESSION_MIN: 1800,
} as const;
