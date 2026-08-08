/**
 * RP Quality Vector V2 — Phase D evaluation harness (shared across models).
 * Does not mutate production prompts.
 */
import { computeCompositionMetrics } from "./composition";
import { computeContinuityAutoAudit } from "./continuity";
import { computeDialogueFragmentationMetrics } from "./dialogueFragmentation";
import { computeLengthMetrics } from "./length";
import { computeNarrationFragmentationMetrics } from "./narrationFragmentation";
import {
  computeSettingExactOverlapAudit,
  type SettingSource,
} from "./settingOverlap";
import type {
  RpQualityVectorV2,
  SettingRecitalHumanScores,
} from "./types";

export * from "./types";
export { classifyLengthBand, computeLengthMetrics } from "./length";
export { computeCompositionMetrics } from "./composition";
export { computeDialogueFragmentationMetrics } from "./dialogueFragmentation";
export { computeNarrationFragmentationMetrics } from "./narrationFragmentation";
export {
  computeSettingExactOverlapAudit,
  longestCommonSubstring,
  type SettingSource,
} from "./settingOverlap";
export {
  computeContinuityAutoAudit,
  CONTINUITY_FIXTURE_MEASURES,
  CONTINUITY_HUMAN_SCHEMA,
  emptyContinuityHumanScores,
  type ContinuityAutoAudit,
  type ContinuityHumanScores,
} from "./continuity";
export {
  extractDialogueSpans,
  isDialogueParagraph,
  splitParagraphs,
} from "./quotes";

/** Documented human recital schema (0–3 / hard leak). */
export const SETTING_RECITAL_HUMAN_SCHEMA = {
  CHARACTER_PROFILE_RECITAL:
    "0 none · 1 minor · 2 noticeable expository · 3 scene-blocking profile dump",
  USER_PERSONA_PARROT:
    "0 none · 1 minor · 2 noticeable · 3 checklist parrot of persona fields",
  WORLD_LORE_BRIEFING:
    "0 none · 1 minor · 2 wiki burst · 3 continuous world dump",
  MEMORY_RECITAL:
    "0 none · 1 natural recall · 2 summary dump · 3 timeline readout",
  STATIC_FACT_BURST:
    "0 none · 1 mild cluster · 2+ independent static facts in one paragraph",
  KNOWLEDGE_LEAK:
    "0/1 HARD — NPC knows not-observable / not-disclosed user info",
  ACTIVE_CANON_USE:
    "0 none · 1+ canon fact changes action/choice/risk/result (GOOD)",
  AMBIENT_CANON_USE:
    "0 none · 1+ habit/env/voice seep without exposition (GOOD)",
} as const;

/** Cross-cutting human quality scores for adapter hard gate (D1+). */
export const QUALITY_GATE_HUMAN_SCHEMA = {
  CHARACTER_FIDELITY: "1–5 character voice/behavior fidelity vs canon",
  ACTIVE_CANON_USE: "1–5 canon facts drive new action/choice (not recital)",
  SETTING_RECITAL: "0–3 aggregate recital severity (see SETTING_RECITAL_HUMAN_SCHEMA)",
  SCENE_PROGRESSION: "1–5 scene advances after prior+input (not rewind)",
} as const;

export const KNOWLEDGE_LEAK_HARD_GATE =
  "KNOWLEDGE_LEAK=1 is a hard fail; cannot be offset by literary score.";

/** Continuity principle (evaluation, not a new production prompt rule). */
export const CONTINUITY_PRINCIPLE = {
  state_not_source:
    "PRIOR CANON / MEMORY / RECENT SCENE = STATE that decides the next beat; NOT source text to re-output.",
  temporal_start:
    "Reply starts after latest canonical assistant scene + latest completed user input.",
  allowed_reference:
    "Short callback that creates a NEW judgment/reaction/action is GOOD; retelling old scene without new value is BAD.",
  adapter_goal_if_needed: "REMEMBER IT · DO NOT REPLAY IT · ACT FROM IT",
} as const;

export function emptyHumanRecitalScores(): SettingRecitalHumanScores {
  return {
    CHARACTER_PROFILE_RECITAL: 0,
    USER_PERSONA_PARROT: 0,
    WORLD_LORE_BRIEFING: 0,
    MEMORY_RECITAL: 0,
    STATIC_FACT_BURST: 0,
    KNOWLEDGE_LEAK: 0,
    ACTIVE_CANON_USE: 0,
    AMBIENT_CANON_USE: 0,
  };
}

export function computeRpQualityVectorV2(input: {
  text: string;
  providerRaw?: string | null;
  finalDisplay?: string | null;
  pairVisibleCharsNoWs?: number | null;
  finishReason?: string | null;
  sawDone?: boolean | null;
  incomplete?: boolean | null;
  settingSources?: SettingSource[];
  currentUserInput?: string | null;
  priorAssistantText?: string | null;
  greetingOrIntroText?: string | null;
}): RpQualityVectorV2 {
  const text = input.text ?? "";
  const length = computeLengthMetrics({
    text,
    providerRaw: input.providerRaw,
    finalDisplay: input.finalDisplay,
    pairVisibleCharsNoWs: input.pairVisibleCharsNoWs,
    finishReason: input.finishReason,
    sawDone: input.sawDone,
    incomplete: input.incomplete,
  });
  const composition = computeCompositionMetrics(text);
  const dialogue_fragmentation = computeDialogueFragmentationMetrics(text);
  const narration_fragmentation = computeNarrationFragmentationMetrics(text);
  const setting_exact_overlap = input.settingSources
    ? computeSettingExactOverlapAudit({
        output: text,
        sources: input.settingSources,
      })
    : null;

  const hasContinuityContext =
    input.currentUserInput != null ||
    input.priorAssistantText != null ||
    input.greetingOrIntroText != null;
  const continuity = hasContinuityContext
    ? computeContinuityAutoAudit({
        output: text,
        currentUserInput: input.currentUserInput,
        priorAssistantText: input.priorAssistantText,
        greetingOrIntroText: input.greetingOrIntroText,
      })
    : null;

  const hard_alarms: string[] = [];
  if (length.length_band === "DENSITY_COLLAPSE") {
    hard_alarms.push("DENSITY_COLLAPSE");
  }
  if (length.incomplete) hard_alarms.push("INCOMPLETE");
  if (composition.strong_dialogue_dominance) {
    hard_alarms.push("STRONG_DIALOGUE_DOMINANCE");
  }
  if (composition.dialogue_heavy_review) {
    hard_alarms.push("DIALOGUE_HEAVY_REVIEW");
  }
  if (dialogue_fragmentation.speaker_split_review_required) {
    hard_alarms.push("SPEAKER_SPLIT_REVIEW_REQUIRED");
  }
  if (setting_exact_overlap?.alarm_18_plus) {
    hard_alarms.push("SETTING_EXACT_OVERLAP_18PLUS");
  }
  if (continuity?.continuity_review_required) {
    hard_alarms.push("CONTINUITY_REVIEW_REQUIRED");
  }
  for (const a of continuity?.alarms ?? []) hard_alarms.push(a);

  return {
    completion: {
      finish_reason: length.finish_reason,
      saw_done: length.saw_done,
      incomplete: length.incomplete,
    },
    length,
    composition,
    dialogue_fragmentation,
    narration_fragmentation,
    setting_exact_overlap,
    continuity,
    hard_alarms,
  };
}
