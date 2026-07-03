/** Locked speaking profile for a character — enforced at prompt + validation time */
export type SpeechFormality = "formal" | "semi_formal" | "informal" | "archaic_formal";

export type VocabularyStyle =
  | "noble"
  | "common"
  | "military"
  | "scholarly"
  | "street"
  | "modern_casual"
  | "neutral";

export type SocialClass =
  | "royalty"
  | "nobility"
  | "knight"
  | "clergy"
  | "merchant"
  | "commoner"
  | "outcast"
  | "modern"
  | "unspecified";

export type EraStyle =
  | "fantasy_medieval"
  | "historical_joseon"
  | "historical_general"
  | "modern"
  | "sci_fi"
  | "unspecified";

export type SpeechProfile = {
  charName: string;
  speech_tone: string;
  speech_formality: SpeechFormality;
  vocabulary_style: VocabularyStyle;
  social_class: SocialClass;
  era_style: EraStyle;
  forbidden_speech_patterns: string[];
  dialogue_examples: string[];
  /** 제작자 입력 — 성격 (말투 설정) */
  creator_personality?: string;
  /** 제작자 입력 — 말투 특징 */
  creator_speech_traits?: string;
  /** 예시 대사에서 추출한 종결 어미 앵커 */
  ending_anchors?: string[];
  /** Human-readable lock summary for prompts */
  lockSummary: string;
};

export type SpeechViolationType =
  | "forbidden_pattern"
  | "hybrid_honorific"
  | "modern_slang"
  | "formality_drift"
  | "class_drift"
  | "ending_drift"
  | "narration_register_lexicon";

export type SpeechViolation = {
  type: SpeechViolationType;
  matched: string[];
  excerpt: string;
  severity: "warn" | "fail";
};

export type SpeechValidationResult = {
  valid: boolean;
  violations: SpeechViolation[];
  shouldRewrite: boolean;
};
