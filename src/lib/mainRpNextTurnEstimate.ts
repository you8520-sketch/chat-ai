/**
 * Display-only next Main RP turn estimate.
 * Tokens in → Published user-charge out. Not a billing, admission, or lease owner.
 */

import { MAIN_RP_MODEL_IDS, type SelectedAI } from "@/lib/chatModels";
import { computePublishedStandardPreviewDisplayPoints } from "@/lib/publishedUserCharge";
import {
  CATASTROPHIC_MIN_RESPONSE_CHARS,
  KOREAN_CHARS_PER_OUTPUT_TOKEN,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";

export const NEXT_TURN_ESTIMATE_VERSION = "main-rp-next-turn-v1";

export type NextTurnEstimateRow = {
  promptTokens: number;
  expectedOutputTokens: number;
  outputChars: number;
  displayPoints: number;
  outputBasis: "aim_floor" | "last_visible" | "observed_ratio";
};

export type NextTurnEstimateMap = Partial<Record<SelectedAI, NextTurnEstimateRow>>;

export function resolveNextTurnOutputChars(
  lastVisibleAssistantChars: number | null | undefined
): number {
  if (
    typeof lastVisibleAssistantChars === "number" &&
    Number.isFinite(lastVisibleAssistantChars) &&
    lastVisibleAssistantChars > UNIFIED_TIER_AIM_CHARS
  ) {
    return Math.round(lastVisibleAssistantChars);
  }
  return UNIFIED_TIER_AIM_CHARS;
}

export function resolveObservedCharsPerToken(input: {
  visibleChars: number;
  outputTokens: number;
}): number | null {
  if (
    !Number.isFinite(input.visibleChars) ||
    !Number.isFinite(input.outputTokens) ||
    input.visibleChars < CATASTROPHIC_MIN_RESPONSE_CHARS ||
    input.outputTokens <= 0
  ) {
    return null;
  }
  const ratio = input.visibleChars / input.outputTokens;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return ratio;
}

export function estimateNextTurnOutputTokens(input: {
  outputChars: number;
  observedCharsPerToken?: number | null;
}): number {
  const ratio =
    typeof input.observedCharsPerToken === "number" &&
    Number.isFinite(input.observedCharsPerToken) &&
    input.observedCharsPerToken > 0
      ? input.observedCharsPerToken
      : KOREAN_CHARS_PER_OUTPUT_TOKEN;
  return Math.max(1, Math.ceil(input.outputChars / ratio));
}

export function isUsableOutputCalibrationSource(input: {
  generationStatus?: string | null;
  model?: string | null;
  visibleChars: number;
  outputTokens: number | null;
  htmlFlashOnly?: boolean;
}): boolean {
  if (input.htmlFlashOnly) return false;
  if ((input.model ?? "").trim() === "greeting") return false;
  if (!isSuccessfulDurableGenerationStatus(input.generationStatus)) return false;
  if (input.visibleChars < CATASTROPHIC_MIN_RESPONSE_CHARS) return false;
  if (input.outputTokens == null || input.outputTokens <= 0) return false;
  return resolveObservedCharsPerToken({
    visibleChars: input.visibleChars,
    outputTokens: input.outputTokens,
  }) != null;
}

export function computeMainRpNextTurnEstimates(input: {
  promptTokensByModel: Partial<Record<SelectedAI, number>>;
  lastVisibleAssistantChars?: number | null;
  observedCharsPerTokenByModel?: Partial<Record<SelectedAI, number | null>>;
  effectiveKrwPerUsd: number;
}): NextTurnEstimateMap {
  const outputChars = resolveNextTurnOutputChars(input.lastVisibleAssistantChars);
  const out: NextTurnEstimateMap = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const promptTokens = input.promptTokensByModel[modelId];
    if (typeof promptTokens !== "number" || !Number.isFinite(promptTokens) || promptTokens <= 0) {
      continue;
    }
    const observed = input.observedCharsPerTokenByModel?.[modelId];
    const expectedOutputTokens = estimateNextTurnOutputTokens({
      outputChars,
      observedCharsPerToken: observed,
    });
    const displayPoints = computePublishedStandardPreviewDisplayPoints({
      modelId,
      promptTokens: Math.round(promptTokens),
      outputTokens: expectedOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: input.effectiveKrwPerUsd,
    });
    if (displayPoints == null) continue;
    const outputBasis =
      typeof observed === "number" && observed > 0
        ? "observed_ratio"
        : outputChars > UNIFIED_TIER_AIM_CHARS
          ? "last_visible"
          : "aim_floor";
    out[modelId] = {
      promptTokens: Math.round(promptTokens),
      expectedOutputTokens,
      outputChars,
      displayPoints,
      outputBasis,
    };
  }
  return out;
}

export function nextTurnEstimateDisplayMap(
  estimates: NextTurnEstimateMap
): Partial<Record<SelectedAI, number>> {
  const out: Partial<Record<SelectedAI, number>> = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const points = estimates[modelId]?.displayPoints;
    if (typeof points === "number" && Number.isSafeInteger(points) && points > 0) {
      out[modelId] = points;
    }
  }
  return out;
}
