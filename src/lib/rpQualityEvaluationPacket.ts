/**
 * Deterministic evaluation packet / rubric for GPT/human Main RP quality review.
 * Cursor never fills scores. Length is metadata, not a mechanical bonus.
 */
import {
  capabilitiesFromUserAuthoringLevel,
  USER_AUTHORING_LEVELS,
  type UserAuthoringCapabilities,
  type UserAuthoringLevel,
} from "@/lib/userAuthoringPolicy";
import {
  visibleAssistantDisplayCharCount,
  visibleAssistantDisplayText,
} from "@/lib/chatDisplayLength";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import { UNIFIED_TIER_AIM_CHARS } from "@/lib/responseLengthConstants";
import {
  classifyVisibleLength,
  countVisibleParagraphs,
  estimateDialogueShare,
  type RpVisibleLengthClass,
} from "@/lib/rpQualityBaseline";

export const RP_QUALITY_RUBRIC_TOTAL = 100;

export type RpQualityRubricDimensionId =
  | "natural_korean"
  | "character_voice"
  | "psychology_emotion"
  | "forward_motion"
  | "environment_grounding"
  | "authoring_policy"
  | "repetition_control"
  | "continuity_memory"
  | "dialogue_pacing"
  | "immersion_coherence";

export type RpQualityRubricDimension = {
  id: RpQualityRubricDimensionId;
  label: string;
  max: number;
};

export const RP_QUALITY_RUBRIC: readonly RpQualityRubricDimension[] = [
  { id: "natural_korean", label: "자연스러운 한국어 / 문장 리듬", max: 15 },
  { id: "character_voice", label: "캐릭터 고유 voice / 대사 일관성", max: 15 },
  { id: "psychology_emotion", label: "심리·감정 깊이", max: 10 },
  { id: "forward_motion", label: "scene / relationship forward motion", max: 15 },
  { id: "environment_grounding", label: "환경·공간·감각 grounding", max: 10 },
  { id: "authoring_policy", label: "user-authoring policy 정확성", max: 10 },
  { id: "repetition_control", label: "반복 / 의미 재진술 / AI 상투문 억제", max: 10 },
  { id: "continuity_memory", label: "continuity / memory / callback", max: 5 },
  { id: "dialogue_pacing", label: "대사·서술 pacing / balance", max: 5 },
  { id: "immersion_coherence", label: "전체 immersion / coherence", max: 5 },
] as const;

export const RP_QUALITY_HARD_GATES = [
  "character_voice_collapse",
  "severe_semantic_or_action_repetition",
  "user_authoring_scope_violation",
  "private_user_inner_pov_at_disallowed_level",
  "unauthorized_irreversible_user_fate",
  "physical_or_spatial_contradiction",
  "ignored_prior_dialogue_or_relationship",
  "user_input_echo_or_near_restatement",
  "ai_cast_no_initiative_always_waits",
  "scene_stalled_in_place",
  "meta_prompt_or_rule_leakage",
  "degenerate_or_flood_output",
] as const;

export type RpQualityHardGateId = (typeof RP_QUALITY_HARD_GATES)[number];

export const RP_REPETITION_AUDIT_DIMENSIONS = [
  "same_body_channel_repeat",
  "same_emotion_narrator_restatement",
  "same_dialogue_intent_repeat",
  "same_question_pattern_repeat",
  "next_paragraph_concludes_previous_meaning",
  "unnecessary_poetic_abstraction",
  "fragment_sentence_artificial_emphasis",
  "generic_prose_erasing_character_difference",
] as const;

export type RpRepetitionAuditDimensionId = (typeof RP_REPETITION_AUDIT_DIMENSIONS)[number];

export const RP_ADULT_QUALITY_OVERLAY = [
  "existing_character_voice_held",
  "current_relationship_emotion_line_connected",
  "authoring_agency_boundary_accurate",
  "physical_location_action_continuity",
  "emotion_reaction_sensation_integrated_not_listed",
  "same_sensation_reaction_phrase_suppressed",
  "scene_pacing_not_rushed_or_stalled",
  "generic_adult_dialogue_did_not_erase_character",
  "character_did_not_become_counselor_or_moral_teacher",
  "meaningful_relationship_or_situation_change_remains",
] as const;

export type RpAdultQualityOverlayId = (typeof RP_ADULT_QUALITY_OVERLAY)[number];

export type RpQualityTurnKind = "manual" | "auto" | "regen";
export type RpQualityContentMode = "SAFE" | "19+";

/** Benchmark model set is the live Main RP picker. No second included/excluded list. */
export const RP_QUALITY_BENCHMARK_MODELS = MAIN_RP_USER_SELECTABLE_OPTIONS.map(
  (option) => option.label
);

export type RpQualityAuthoringMatrix = Record<UserAuthoringLevel, UserAuthoringCapabilities>;

export function liveAuthoringCapabilityMatrix(): RpQualityAuthoringMatrix {
  return {
    LIMITED: capabilitiesFromUserAuthoringLevel("LIMITED"),
    NORMAL: capabilitiesFromUserAuthoringLevel("NORMAL"),
    ALLOW: capabilitiesFromUserAuthoringLevel("ALLOW"),
  };
}

export function authoringEvaluationNotes(level: UserAuthoringLevel): string[] {
  switch (level) {
    case "LIMITED":
      return [
        "ALLOW is not a higher quality level; it only widens available [B] material.",
        "Do not invent [B] dialogue or major actions to fill length.",
      ];
    case "NORMAL":
      return [
        "Site policy allows direct [B] dialogue and major external action. Do not deduct for that alone.",
        "Private [B] inner POV and irreversible fate remain disallowed.",
      ];
    case "ALLOW":
      return [
        "Inner POV is allowed. Per-paragraph direct [B] emotion explanation is a separate repetition/prose issue.",
        "Irreversible [B] fate remains protected unless an explicit eligible OOC override exists.",
      ];
    default: {
      const _never: never = level;
      return _never;
    }
  }
}

export type RpQualityOutputMetadata = {
  visibleChars: number;
  lengthClass: RpVisibleLengthClass;
  paragraphCount: number;
  dialogueShareEstimate: number | null;
  model: string | null;
  sceneClass: string | null;
  authoringLevel: UserAuthoringLevel;
  turnKind: RpQualityTurnKind;
  contentMode: RpQualityContentMode;
  finishReason: string | null;
  finalWireFingerprint: string | null;
};

export type RpQualityOutputPacket = {
  opaqueLabel: string;
  generatedText: string;
  metadata: RpQualityOutputMetadata;
  scores: Record<RpQualityRubricDimensionId, number | null>;
  hardGateFlags: Partial<Record<RpQualityHardGateId, boolean | null>>;
  repetitionEvidence: Partial<Record<RpRepetitionAuditDimensionId, boolean | null>>;
  adultOverlay: Partial<Record<RpAdultQualityOverlayId, boolean | null>> | null;
};

export type RpQualityEvaluationContract = {
  kind: "rp-product-quality-baseline";
  cursorScores: false;
  lengthServesQuality: true;
  qualityDoesNotServeLength: true;
  steeringSoftAimChars: typeof UNIFIED_TIER_AIM_CHARS;
  exactLengthIsNotAcceptance: true;
  rubricTotal: typeof RP_QUALITY_RUBRIC_TOTAL;
  rubric: readonly RpQualityRubricDimension[];
  hardGates: readonly RpQualityHardGateId[];
  repetitionAuditDimensions: readonly RpRepetitionAuditDimensionId[];
  adultOverlay: readonly RpAdultQualityOverlayId[];
  authoringLevels: readonly UserAuthoringLevel[];
  authoringMatrix: RpQualityAuthoringMatrix;
  ordinaryAndAutoProgressionAreIndependent: true;
  benchmarkModels: readonly string[];
};

export function emptyRubricScores(): Record<RpQualityRubricDimensionId, number | null> {
  return {
    natural_korean: null,
    character_voice: null,
    psychology_emotion: null,
    forward_motion: null,
    environment_grounding: null,
    authoring_policy: null,
    repetition_control: null,
    continuity_memory: null,
    dialogue_pacing: null,
    immersion_coherence: null,
  };
}

export function buildQualityOutputMetadata(input: {
  generatedText: string;
  model?: string | null;
  sceneClass?: string | null;
  authoringLevel: UserAuthoringLevel;
  turnKind: RpQualityTurnKind;
  contentMode: RpQualityContentMode;
  finishReason?: string | null;
  finalWireFingerprint?: string | null;
}): RpQualityOutputMetadata {
  const visibleText = visibleAssistantDisplayText(input.generatedText);
  const visibleChars = visibleAssistantDisplayCharCount(input.generatedText);
  return {
    visibleChars,
    lengthClass: classifyVisibleLength(visibleChars),
    paragraphCount: countVisibleParagraphs(visibleText),
    dialogueShareEstimate: estimateDialogueShare(visibleText),
    model: input.model ?? null,
    sceneClass: input.sceneClass ?? null,
    authoringLevel: input.authoringLevel,
    turnKind: input.turnKind,
    contentMode: input.contentMode,
    finishReason: input.finishReason ?? null,
    finalWireFingerprint: input.finalWireFingerprint ?? null,
  };
}

export function buildQualityEvaluationContract(): RpQualityEvaluationContract {
  return {
    kind: "rp-product-quality-baseline",
    cursorScores: false,
    lengthServesQuality: true,
    qualityDoesNotServeLength: true,
    steeringSoftAimChars: UNIFIED_TIER_AIM_CHARS,
    exactLengthIsNotAcceptance: true,
    rubricTotal: RP_QUALITY_RUBRIC_TOTAL,
    rubric: RP_QUALITY_RUBRIC,
    hardGates: RP_QUALITY_HARD_GATES,
    repetitionAuditDimensions: RP_REPETITION_AUDIT_DIMENSIONS,
    adultOverlay: RP_ADULT_QUALITY_OVERLAY,
    authoringLevels: USER_AUTHORING_LEVELS,
    authoringMatrix: liveAuthoringCapabilityMatrix(),
    ordinaryAndAutoProgressionAreIndependent: true,
    benchmarkModels: RP_QUALITY_BENCHMARK_MODELS,
  };
}

export function buildQualityOutputPacket(input: {
  opaqueLabel: string;
  generatedText: string;
  model?: string | null;
  sceneClass?: string | null;
  authoringLevel: UserAuthoringLevel;
  turnKind: RpQualityTurnKind;
  contentMode: RpQualityContentMode;
  finishReason?: string | null;
  finalWireFingerprint?: string | null;
}): RpQualityOutputPacket {
  return {
    opaqueLabel: input.opaqueLabel,
    generatedText: input.generatedText,
    metadata: buildQualityOutputMetadata(input),
    scores: emptyRubricScores(),
    hardGateFlags: {},
    repetitionEvidence: {},
    adultOverlay: input.contentMode === "19+" ? {} : null,
  };
}
