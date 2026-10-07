/**
 * Next Main RP turn estimate owner.
 * Local assembled tokens → optional same-model provider-input calibration →
 * Published user-charge out. Picker display and #1400 admission both consume
 * this owner. Not a billing settlement or lease owner.
 */

import { isMainRpModel, MAIN_RP_MODEL_IDS, type SelectedAI } from "@/lib/chatModels";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { computePublishedStandardPreviewDisplayPoints } from "@/lib/publishedUserCharge";
import {
  CATASTROPHIC_MIN_RESPONSE_CHARS,
  KOREAN_CHARS_PER_OUTPUT_TOKEN,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";

export const NEXT_TURN_ESTIMATE_VERSION = "main-rp-next-turn-v1";

export type NextTurnOutputBasis = "aim_floor" | "last_visible" | "observed_ratio";

export type NextTurnInputCalibrationSource =
  | "uncalibrated_assembled"
  | "same_model_provider_ratio";

export type NextTurnInputCalibrationConfidence = "none" | "latest_same_model";

export type NextTurnEstimateRow = {
  promptTokens: number;
  expectedOutputTokens: number;
  outputChars: number;
  displayPoints: number;
  outputBasis: NextTurnOutputBasis;
  localAssembledInputTokens: number;
  predictedProviderInputTokens: number;
  actualProviderInputTokens: number | null;
  calibrationSource: NextTurnInputCalibrationSource;
  calibrationConfidence: NextTurnInputCalibrationConfidence;
};

export type NextTurnEstimateMap = Partial<Record<SelectedAI, NextTurnEstimateRow>>;

export type NextTurnProviderInputCalibrationSample = {
  actualProviderInputTokens: number;
  assembledInputTokens: number;
};

function isFinitePositiveToken(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function resolveMainRpNextTurnCalibrationModelId(
  raw: string | null | undefined
): SelectedAI | null {
  if (typeof raw !== "string") return null;
  const canonical = canonicalizePublishedModelId(raw);
  if (!canonical || canonical === "greeting") return null;
  return isMainRpModel(canonical) ? (canonical as SelectedAI) : null;
}

export function resolveNextTurnInputCalibrationConfidence(
  source: NextTurnInputCalibrationSource
): NextTurnInputCalibrationConfidence {
  switch (source) {
    case "uncalibrated_assembled":
      return "none";
    case "same_model_provider_ratio":
      return "latest_same_model";
    default: {
      const _never: never = source;
      return _never;
    }
  }
}

export function resolveProviderInputRatio(input: {
  actualProviderInputTokens: number;
  assembledInputTokens: number;
}): number | null {
  if (
    !isFinitePositiveToken(input.actualProviderInputTokens) ||
    !isFinitePositiveToken(input.assembledInputTokens)
  ) {
    return null;
  }
  const ratio = input.actualProviderInputTokens / input.assembledInputTokens;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.min(1, ratio);
}

export function applyProviderInputCalibration(input: {
  localAssembledInputTokens: number;
  sample?: NextTurnProviderInputCalibrationSample | null;
}): {
  predictedProviderInputTokens: number;
  actualProviderInputTokens: number | null;
  calibrationSource: NextTurnInputCalibrationSource;
  calibrationConfidence: NextTurnInputCalibrationConfidence;
  providerInputRatio: number | null;
} {
  const localAssembled = Math.round(input.localAssembledInputTokens);
  const ratio = input.sample ? resolveProviderInputRatio(input.sample) : null;
  if (ratio == null) {
    const source = "uncalibrated_assembled" as const;
    return {
      predictedProviderInputTokens: localAssembled,
      actualProviderInputTokens: null,
      calibrationSource: source,
      calibrationConfidence: resolveNextTurnInputCalibrationConfidence(source),
      providerInputRatio: null,
    };
  }
  const source = "same_model_provider_ratio" as const;
  return {
    predictedProviderInputTokens: Math.max(1, Math.round(localAssembled * ratio)),
    actualProviderInputTokens: Math.round(input.sample!.actualProviderInputTokens),
    calibrationSource: source,
    calibrationConfidence: resolveNextTurnInputCalibrationConfidence(source),
    providerInputRatio: ratio,
  };
}

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

export function isUsableProviderInputCalibrationSource(input: {
  generationStatus?: string | null;
  model?: string | null;
  selectedAI?: string | null;
  actualModel?: string | null;
  htmlFlashOnly?: boolean;
  estimated?: boolean;
  fallback?: string | boolean | null;
  fallbackAttempted?: boolean;
  apiCallCount?: number | null;
  lengthRecoveryPasses?: number | null;
  apiInputTokens?: number | null;
  assembledInputTokens?: number | null;
}): boolean {
  if (input.htmlFlashOnly) return false;
  if ((input.model ?? "").trim() === "greeting") return false;
  if ((input.selectedAI ?? "").trim() === "greeting") return false;
  if (!isSuccessfulDurableGenerationStatus(input.generationStatus)) return false;
  if (input.estimated === true) return false;
  if (input.fallback) return false;
  if (input.fallbackAttempted === true) return false;
  if ((input.apiCallCount ?? 1) > 1) return false;
  if ((input.lengthRecoveryPasses ?? 0) > 0) return false;
  if (!isFinitePositiveToken(input.apiInputTokens)) return false;
  if (!isFinitePositiveToken(input.assembledInputTokens)) return false;

  const selected =
    resolveMainRpNextTurnCalibrationModelId(input.selectedAI) ??
    resolveMainRpNextTurnCalibrationModelId(input.model);
  if (!selected) return false;

  if (input.actualModel != null && String(input.actualModel).trim() !== "") {
    const actual = resolveMainRpNextTurnCalibrationModelId(input.actualModel);
    if (actual == null || actual !== selected) return false;
  }

  return (
    resolveProviderInputRatio({
      actualProviderInputTokens: input.apiInputTokens,
      assembledInputTokens: input.assembledInputTokens,
    }) != null
  );
}

export function pickLatestProviderInputCalibrationByModel(
  candidatesNewestLast: Array<
    {
      selectedAI?: string | null;
      model?: string | null;
      actualModel?: string | null;
    } & Omit<
      Parameters<typeof isUsableProviderInputCalibrationSource>[0],
      "selectedAI" | "model" | "actualModel"
    >
  >
): Partial<Record<SelectedAI, NextTurnProviderInputCalibrationSample>> {
  const out: Partial<Record<SelectedAI, NextTurnProviderInputCalibrationSample>> = {};
  for (let i = candidatesNewestLast.length - 1; i >= 0; i -= 1) {
    const candidate = candidatesNewestLast[i];
    if (!candidate) continue;
    if (!isUsableProviderInputCalibrationSource(candidate)) continue;
    const modelId =
      resolveMainRpNextTurnCalibrationModelId(candidate.selectedAI) ??
      resolveMainRpNextTurnCalibrationModelId(candidate.model);
    if (!modelId || out[modelId] != null) continue;
    out[modelId] = {
      actualProviderInputTokens: candidate.apiInputTokens as number,
      assembledInputTokens: candidate.assembledInputTokens as number,
    };
  }
  return out;
}

export function computeMainRpNextTurnEstimates(input: {
  promptTokensByModel: Partial<Record<SelectedAI, number>>;
  lastVisibleAssistantChars?: number | null;
  observedCharsPerTokenByModel?: Partial<Record<SelectedAI, number | null>>;
  providerInputCalibrationByModel?: Partial<
    Record<SelectedAI, NextTurnProviderInputCalibrationSample | null>
  >;
  effectiveKrwPerUsd: number;
}): NextTurnEstimateMap {
  const outputChars = resolveNextTurnOutputChars(input.lastVisibleAssistantChars);
  const out: NextTurnEstimateMap = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const assembled = input.promptTokensByModel[modelId];
    if (typeof assembled !== "number" || !Number.isFinite(assembled) || assembled <= 0) {
      continue;
    }
    const localAssembledInputTokens = Math.round(assembled);
    const calibrated = applyProviderInputCalibration({
      localAssembledInputTokens,
      sample: input.providerInputCalibrationByModel?.[modelId],
    });
    const predictedProviderInputTokens = calibrated.predictedProviderInputTokens;
    const observed = input.observedCharsPerTokenByModel?.[modelId];
    const expectedOutputTokens = estimateNextTurnOutputTokens({
      outputChars,
      observedCharsPerToken: observed,
    });
    const displayPoints = computePublishedStandardPreviewDisplayPoints({
      modelId,
      promptTokens: predictedProviderInputTokens,
      outputTokens: expectedOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: input.effectiveKrwPerUsd,
    });
    if (displayPoints == null) continue;
    const outputBasis: NextTurnOutputBasis =
      typeof observed === "number" && observed > 0
        ? "observed_ratio"
        : outputChars > UNIFIED_TIER_AIM_CHARS
          ? "last_visible"
          : "aim_floor";
    out[modelId] = {
      promptTokens: predictedProviderInputTokens,
      expectedOutputTokens,
      outputChars,
      displayPoints,
      outputBasis,
      localAssembledInputTokens,
      predictedProviderInputTokens,
      actualProviderInputTokens: calibrated.actualProviderInputTokens,
      calibrationSource: calibrated.calibrationSource,
      calibrationConfidence: calibrated.calibrationConfidence,
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
