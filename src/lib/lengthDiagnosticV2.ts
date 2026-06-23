import { estimateTokens } from "@/lib/ai";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import {
  resolveResponseLengthTarget,
  resolveTierMinimumRequired,
} from "@/lib/responseLength";
import { parseReasoningTokens } from "@/lib/openRouterUsage";

const TIME_DILATION_MARKER = "[TIME DILATION — MICRO-PACING TECHNIQUE]";
const LENGTH_CONTROL_MARKER = "[LENGTH CONTROL & SCENE EXPANSION]";
const SCENE_BLUEPRINT_MARKER = "[SCENE EXPANSION BLUEPRINT]";

const BANNED_ENDING_VERB_PATTERN =
  /(?:기다리며|기다렸다|바라보았다|확인했다|지켜보았다)\s*\.?\s*$/;

/** Anti-resolution / turn-end forbid rules — index in assembled system prompt */
export function probeAntiResolutionRuleIndex(systemPrompt: string): number | null {
  const markers = ["[FORBIDDEN AT END]", "observer closing beats", "[EXIT RULE — LENGTH SHORTFALL]"];
  let best: number | null = null;
  for (const marker of markers) {
    const idx = systemPrompt.indexOf(marker);
    if (idx >= 0 && (best == null || idx < best)) best = idx;
  }
  return best;
}

/** Runtime — model ended on passive observer verb? */
export function logBannedVerbCheck(finalSavedText: string, systemPrompt: string): void {
  console.log("[banned-verb-check]", {
    output_ends_with_banned_verb: BANNED_ENDING_VERB_PATTERN.test(finalSavedText.trim()),
    anti_resolution_rule_index_in_prompt: probeAntiResolutionRuleIndex(systemPrompt),
  });
}

const HANJA_CHAR_PATTERN = /[\u4e00-\u9fff]/g;

/** Runtime — CJK unified ideographs leaked into saved Korean body? */
export function logHanjaLeakCheck(modelId: string, finalSavedText: string): void {
  console.log("[hanja-leak-check]", {
    model: modelId,
    contains_hanja: /[\u4e00-\u9fff]/.test(finalSavedText),
    hanja_chars_found: finalSavedText.match(HANJA_CHAR_PATTERN),
  });
}

export type LengthDiagnosticV2Input = {
  finishReason?: string | null;
  outputText: string;
  /** Total output tokens (primary + recovery sub-calls) */
  outputTokens: number;
  primaryOutputTokens?: number;
  recoveryOutputTokens?: number;
  /** Raw OpenRouter usage object when available (this request) */
  usageData?: unknown;
  /** Fallback when usageData is unavailable */
  reasoningOutputTokens?: number;
  targetResponseChars?: number | null;
  maxTokens: number;
  systemPrompt: string;
  /** API-reported prompt tokens for the full request (not a cache estimate) */
  apiPromptTokens?: number;
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle || !haystack) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) >= 0) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

function indexOfOrNull(haystack: string, needle: string): number | null {
  const idx = haystack.indexOf(needle);
  return idx >= 0 ? idx : null;
}

/** Prompt block presence — derived from actual system string for this turn */
export function probeLengthPromptBlocks(systemPrompt: string): {
  time_dilation_active: boolean;
  scene_blueprint_active: boolean;
  turn_handoff_active: boolean;
  length_control_active: boolean;
  time_dilation_occurrences: number;
  scene_blueprint_occurrences: number;
  length_control_occurrences: number;
  time_dilation_index: number | null;
  scene_blueprint_index: number | null;
  length_control_index: number | null;
} {
  const time_dilation_occurrences = countOccurrences(systemPrompt, TIME_DILATION_MARKER);
  const scene_blueprint_occurrences = countOccurrences(systemPrompt, SCENE_BLUEPRINT_MARKER);
  const length_control_occurrences = countOccurrences(systemPrompt, LENGTH_CONTROL_MARKER);
  const hasBlueprintHeader = scene_blueprint_occurrences > 0;
  const hasBlueprintBody =
    hasBlueprintHeader ||
    (systemPrompt.includes("SCENE EXPANSION BLUEPRINT") &&
      systemPrompt.includes("Phase structure"));

  return {
    time_dilation_active: time_dilation_occurrences > 0,
    scene_blueprint_active: hasBlueprintBody,
    turn_handoff_active:
      systemPrompt.includes("<TURN_HANDOFF_AND_PACING>") ||
      systemPrompt.includes("TURN_HANDOFF_AND_PACING"),
    length_control_active: length_control_occurrences > 0,
    time_dilation_occurrences,
    scene_blueprint_occurrences,
    length_control_occurrences,
    time_dilation_index: indexOfOrNull(systemPrompt, TIME_DILATION_MARKER),
    scene_blueprint_index: indexOfOrNull(systemPrompt, SCENE_BLUEPRINT_MARKER),
    length_control_index: indexOfOrNull(systemPrompt, LENGTH_CONTROL_MARKER),
  };
}

export type CharsPerTokenDiagnosticInput = {
  /** Total billable output tokens for this turn (primary + recovery sub-calls) */
  outputTokens: number;
  /** Primary stream completion tokens only */
  primaryOutputTokens?: number;
  /** Recovery continuation completion tokens (0 when none) */
  recoveryOutputTokens?: number;
  /** Model stream text before any sanitize/normalize */
  rawModelText: string;
  /** Primary stream char length before recovery merge (when recovery ran) */
  primaryRawModelChars?: number;
  /** Final text after all sanitize/normalize stages */
  finalSavedText: string;
  /** Recovery sub-call ran but merge did not extend saved prose */
  recoveryMergeRejected?: boolean;
  usageData?: unknown;
  reasoningOutputTokens?: number;
  systemPrompt: string;
};

/** Output token → saved char ratio — reasoning budget vs sanitize loss vs prompt block presence */
export function logCharsPerTokenDiagnostic(input: CharsPerTokenDiagnosticInput): void {
  const primaryRawChars = input.primaryRawModelChars ?? input.rawModelText.length;
  const finalSavedChars = visibleAssistantDisplayCharCount(input.finalSavedText);
  const outputTokens = input.outputTokens;
  const primaryOutputTokens = input.primaryOutputTokens ?? outputTokens;
  const recoveryOutputTokens = input.recoveryOutputTokens ?? 0;
  const reasoningTokens =
    parseReasoningTokens(input.usageData ?? null) || input.reasoningOutputTokens || 0;
  const blockProbe = probeLengthPromptBlocks(input.systemPrompt);

  const payload: Record<string, unknown> = {
    api_output_tokens: outputTokens,
    raw_model_chars: primaryRawChars,
    final_saved_chars: finalSavedChars,
    reasoning_tokens: reasoningTokens,
    chars_per_output_token:
      outputTokens > 0 ? Math.round((finalSavedChars / outputTokens) * 1000) / 1000 : null,
    time_dilation_index_in_prompt: blockProbe.time_dilation_index,
    scene_blueprint_index_in_prompt: blockProbe.scene_blueprint_index,
  };

  if (recoveryOutputTokens > 0) {
    payload.primary_output_tokens = primaryOutputTokens;
    payload.recovery_output_tokens = recoveryOutputTokens;
    payload.primary_chars_per_output_token =
      primaryOutputTokens > 0
        ? Math.round((primaryRawChars / primaryOutputTokens) * 1000) / 1000
        : null;
    const mergeNet = finalSavedChars - primaryRawChars;
    if (input.recoveryMergeRejected) {
      payload.recovery_merge_rejected = true;
      payload.chars_lost_in_sanitize = primaryRawChars - finalSavedChars;
    } else if (mergeNet !== 0) {
      payload.recovery_merge_net_chars = mergeNet;
    } else {
      payload.chars_lost_in_sanitize = primaryRawChars - finalSavedChars;
    }
  } else {
    payload.chars_lost_in_sanitize = primaryRawChars - finalSavedChars;
  }

  console.log("[chars-per-token-diagnostic]", payload);
}

export function logLengthDiagnosticV2(input: LengthDiagnosticV2Input): void {
  const lengthTarget = resolveResponseLengthTarget(input.targetResponseChars);
  const minimumRequired = resolveTierMinimumRequired(lengthTarget.target);
  const outputText = input.outputText;
  const outputChars = visibleAssistantDisplayCharCount(outputText);
  const reasoningTokens =
    parseReasoningTokens(input.usageData ?? null) || input.reasoningOutputTokens || 0;
  const recoveryOutputTokens = input.recoveryOutputTokens ?? 0;

  const lengthPayload: Record<string, unknown> = {
    finish_reason: input.finishReason ?? null,
    output_chars: outputChars,
    output_tokens: input.outputTokens,
    reasoning_tokens: reasoningTokens,
    target_chars: lengthTarget.target,
    minimum_required: minimumRequired,
    max_tokens_setting: input.maxTokens,
    ...probeLengthPromptBlocks(input.systemPrompt),
    paragraphs_generated: (outputText.match(/\n\n/g) || []).length + 1,
    dialogue_lines_count: (outputText.match(/"/g) || []).length / 2,
  };
  if (recoveryOutputTokens > 0) {
    lengthPayload.primary_output_tokens = input.primaryOutputTokens ?? null;
    lengthPayload.recovery_output_tokens = recoveryOutputTokens;
  }
  console.log("[length-diagnostic-v2]", lengthPayload);

  const blockProbe = probeLengthPromptBlocks(input.systemPrompt);
  console.log("[length-diagnostic-v2-system]", {
    system_prompt_chars: input.systemPrompt.length,
    /** Full request prompt tokens from API usage for this turn */
    api_prompt_tokens_this_request: input.apiPromptTokens ?? null,
    /** System-only slice — char-based estimate (API does not split system vs history) */
    system_prompt_estimated_tokens: estimateTokens(input.systemPrompt),
    api_prompt_tokens_is_estimated: input.apiPromptTokens == null || input.apiPromptTokens <= 0,
    ...blockProbe,
    length_control_before_time_dilation:
      blockProbe.length_control_index != null &&
      blockProbe.time_dilation_index != null
        ? blockProbe.length_control_index < blockProbe.time_dilation_index
        : null,
    time_dilation_before_quality_safe:
      blockProbe.time_dilation_index != null &&
      input.systemPrompt.includes("[QUALITY-SAFE EXPANSION]")
        ? blockProbe.time_dilation_index <
          input.systemPrompt.indexOf("[QUALITY-SAFE EXPANSION]")
        : null,
    system_prompt_tail_preview: input.systemPrompt.slice(-400),
  });
}
