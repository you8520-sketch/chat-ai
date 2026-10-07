/**
 * Next Main RP turn estimate owner.
 * Local assembled tokens → optional same-model billable-input calibration →
 * optional same-model billable-output-history median → Published user-charge out.
 * `predictedBillableInputTokens` is a user-charge forecast, not a physical
 * provider tokenizer count. Ratio is capped at 1 to match settlement
 * `resolveTurnBillableInput(min(stageInput, promptAuditTotal))`.
 * Output-history samples must already be billable tokens from
 * `usageOutputTokens` → `billableOpenRouterOutputTokens`. This owner does
 * not invent a second output-normalization rule.
 * Picker display and #1400 admission both consume this owner.
 * Output numbers here are a price forecast only — not a generation max/cap.
 * Not a billing settlement or lease owner.
 *
 * Picker assembled snapshots omit the unsent draft (`currentUserMessage=""`).
 * Keyword lorebook that only triggers on future user text cannot be known
 * in advance; do not invent extra prompt to compensate. Send-time admission
 * already uses the production `buildContext` tokens that include the actual
 * current user message and triggered lorebook.
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

export const NEXT_TURN_OUTPUT_HISTORY_MIN_SAMPLES = 3;
export const NEXT_TURN_OUTPUT_HISTORY_MAX_SAMPLES = 5;

export type NextTurnOutputBasis =
  | "aim_floor"
  | "last_visible"
  | "observed_ratio"
  | "same_model_output_history";

export type NextTurnInputCalibrationSource =
  | "uncalibrated_assembled"
  | "same_model_billable_input_ratio";

export type NextTurnInputCalibrationConfidence = "none" | "latest_same_model";

export type NextTurnEstimateRow = {
  promptTokens: number;
  expectedOutputTokens: number;
  outputChars: number;
  displayPoints: number;
  outputBasis: NextTurnOutputBasis;
  localAssembledInputTokens: number;
  predictedBillableInputTokens: number;
  actualBillableInputTokens: number | null;
  calibrationSource: NextTurnInputCalibrationSource;
  calibrationConfidence: NextTurnInputCalibrationConfidence;
  outputHistorySampleCount: number | null;
};

export type NextTurnEstimateMap = Partial<Record<SelectedAI, NextTurnEstimateRow>>;

export type NextTurnProviderInputCalibrationSample = {
  actualBillableInputTokens: number;
  assembledInputTokens: number;
};

function isFinitePositiveToken(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export type NextTurnCalibrationTurnFields = {
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
};

export function isUncontaminatedSameModelCalibrationTurn(
  input: NextTurnCalibrationTurnFields
): boolean {
  if (input.htmlFlashOnly) return false;
  if ((input.model ?? "").trim() === "greeting") return false;
  if ((input.selectedAI ?? "").trim() === "greeting") return false;
  if (!isSuccessfulDurableGenerationStatus(input.generationStatus)) return false;
  if (input.estimated === true) return false;
  if (input.fallback) return false;
  if (input.fallbackAttempted === true) return false;
  if ((input.apiCallCount ?? 1) > 1) return false;
  if ((input.lengthRecoveryPasses ?? 0) > 0) return false;

  const selected =
    resolveMainRpNextTurnCalibrationModelId(input.selectedAI) ??
    resolveMainRpNextTurnCalibrationModelId(input.model);
  if (!selected) return false;

  if (input.actualModel != null && String(input.actualModel).trim() !== "") {
    const actual = resolveMainRpNextTurnCalibrationModelId(input.actualModel);
    if (actual == null || actual !== selected) return false;
  }
  return true;
}

export function meanPositiveTokens(values: number[]): number | null {
  const clean = values.filter(isFinitePositiveToken);
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function trimmedMeanPositiveTokens(values: number[]): number | null {
  const clean = [...values].filter(isFinitePositiveToken).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  if (clean.length < 3) return meanPositiveTokens(clean);
  const inner = clean.slice(1, -1);
  return inner.reduce((sum, value) => sum + value, 0) / inner.length;
}

export function medianPositiveTokens(values: number[]): number | null {
  const clean = [...values].filter(isFinitePositiveToken).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  if (clean.length % 2 === 1) return clean[mid] ?? null;
  const left = clean[mid - 1];
  const right = clean[mid];
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

export function resolveOutputHistoryForecastTokens(
  values: number[] | null | undefined
): number | null {
  if (!values) return null;
  const clean = values.filter(isFinitePositiveToken);
  if (clean.length < NEXT_TURN_OUTPUT_HISTORY_MIN_SAMPLES) return null;
  const window = clean.slice(-NEXT_TURN_OUTPUT_HISTORY_MAX_SAMPLES);
  const median = medianPositiveTokens(window);
  if (median == null) return null;
  return Math.max(1, Math.round(median));
}

export function describeNextTurnOutputBasis(basis: NextTurnOutputBasis): string {
  switch (basis) {
    case "aim_floor":
      return "target_3200_chars";
    case "last_visible":
      return "last_visible_chars";
    case "observed_ratio":
      return "last_visible_over_observed_chars_per_token";
    case "same_model_output_history":
      return "median_recent_billable_output_tokens";
    default: {
      const _never: never = basis;
      return _never;
    }
  }
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
    case "same_model_billable_input_ratio":
      return "latest_same_model";
    default: {
      const _never: never = source;
      return _never;
    }
  }
}

export function resolveProviderInputRatio(input: {
  actualBillableInputTokens: number;
  assembledInputTokens: number;
}): number | null {
  if (
    !isFinitePositiveToken(input.actualBillableInputTokens) ||
    !isFinitePositiveToken(input.assembledInputTokens)
  ) {
    return null;
  }
  const ratio = input.actualBillableInputTokens / input.assembledInputTokens;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.min(1, ratio);
}

export function applyProviderInputCalibration(input: {
  localAssembledInputTokens: number;
  sample?: NextTurnProviderInputCalibrationSample | null;
}): {
  predictedBillableInputTokens: number;
  actualBillableInputTokens: number | null;
  calibrationSource: NextTurnInputCalibrationSource;
  calibrationConfidence: NextTurnInputCalibrationConfidence;
  providerInputRatio: number | null;
} {
  const localAssembled = Math.round(input.localAssembledInputTokens);
  const ratio = input.sample ? resolveProviderInputRatio(input.sample) : null;
  if (ratio == null) {
    const source = "uncalibrated_assembled" as const;
    return {
      predictedBillableInputTokens: localAssembled,
      actualBillableInputTokens: null,
      calibrationSource: source,
      calibrationConfidence: resolveNextTurnInputCalibrationConfidence(source),
      providerInputRatio: null,
    };
  }
  const source = "same_model_billable_input_ratio" as const;
  return {
    predictedBillableInputTokens: Math.max(1, Math.round(localAssembled * ratio)),
    actualBillableInputTokens: Math.round(input.sample!.actualBillableInputTokens),
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
  if (!isUncontaminatedSameModelCalibrationTurn(input)) return false;
  if (!isFinitePositiveToken(input.apiInputTokens)) return false;
  if (!isFinitePositiveToken(input.assembledInputTokens)) return false;
  return (
    resolveProviderInputRatio({
      actualBillableInputTokens: input.apiInputTokens,
      assembledInputTokens: input.assembledInputTokens,
    }) != null
  );
}

export function isUsableOutputHistorySource(input: NextTurnCalibrationTurnFields & {
  billableOutputTokens?: number | null;
}): boolean {
  if (!isUncontaminatedSameModelCalibrationTurn(input)) return false;
  return isFinitePositiveToken(input.billableOutputTokens);
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
      actualBillableInputTokens: candidate.apiInputTokens as number,
      assembledInputTokens: candidate.assembledInputTokens as number,
    };
  }
  return out;
}

export function pickRecentSameModelBillableOutputTokens(
  candidatesOldestFirst: Array<
    NextTurnCalibrationTurnFields & { billableOutputTokens?: number | null }
  >
): Partial<Record<SelectedAI, number[]>> {
  const out: Partial<Record<SelectedAI, number[]>> = {};
  for (const candidate of candidatesOldestFirst) {
    if (!isUsableOutputHistorySource(candidate)) continue;
    const modelId =
      resolveMainRpNextTurnCalibrationModelId(candidate.selectedAI) ??
      resolveMainRpNextTurnCalibrationModelId(candidate.model);
    if (!modelId || !isFinitePositiveToken(candidate.billableOutputTokens)) continue;
    const list = out[modelId] ?? [];
    list.push(candidate.billableOutputTokens);
    if (list.length > NEXT_TURN_OUTPUT_HISTORY_MAX_SAMPLES) list.shift();
    out[modelId] = list;
  }
  return out;
}

export function resolveNextTurnOutputForecast(input: {
  lastVisibleAssistantChars?: number | null;
  observedCharsPerToken?: number | null;
  recentBillableOutputTokens?: number[] | null;
}): {
  expectedOutputTokens: number;
  outputChars: number;
  outputBasis: NextTurnOutputBasis;
  outputHistorySampleCount: number | null;
} {
  const outputChars = resolveNextTurnOutputChars(input.lastVisibleAssistantChars);
  const historyTokens = resolveOutputHistoryForecastTokens(input.recentBillableOutputTokens);
  if (historyTokens != null && input.recentBillableOutputTokens) {
    const count = input.recentBillableOutputTokens.filter(isFinitePositiveToken).length;
    return {
      expectedOutputTokens: historyTokens,
      outputChars,
      outputBasis: "same_model_output_history",
      outputHistorySampleCount: Math.min(count, NEXT_TURN_OUTPUT_HISTORY_MAX_SAMPLES),
    };
  }
  const expectedOutputTokens = estimateNextTurnOutputTokens({
    outputChars,
    observedCharsPerToken: input.observedCharsPerToken,
  });
  const outputBasis: NextTurnOutputBasis =
    typeof input.observedCharsPerToken === "number" && input.observedCharsPerToken > 0
      ? "observed_ratio"
      : outputChars > UNIFIED_TIER_AIM_CHARS
        ? "last_visible"
        : "aim_floor";
  return {
    expectedOutputTokens,
    outputChars,
    outputBasis,
    outputHistorySampleCount: null,
  };
}

export function computeMainRpNextTurnEstimates(input: {
  promptTokensByModel: Partial<Record<SelectedAI, number>>;
  lastVisibleAssistantChars?: number | null;
  observedCharsPerTokenByModel?: Partial<Record<SelectedAI, number | null>>;
  recentBillableOutputTokensByModel?: Partial<Record<SelectedAI, number[] | null>>;
  providerInputCalibrationByModel?: Partial<
    Record<SelectedAI, NextTurnProviderInputCalibrationSample | null>
  >;
  effectiveKrwPerUsd: number;
}): NextTurnEstimateMap {
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
    const predictedBillableInputTokens = calibrated.predictedBillableInputTokens;
    const observed = input.observedCharsPerTokenByModel?.[modelId];
    const outputForecast = resolveNextTurnOutputForecast({
      lastVisibleAssistantChars: input.lastVisibleAssistantChars,
      observedCharsPerToken: observed,
      recentBillableOutputTokens: input.recentBillableOutputTokensByModel?.[modelId],
    });
    const displayPoints = computePublishedStandardPreviewDisplayPoints({
      modelId,
      promptTokens: predictedBillableInputTokens,
      outputTokens: outputForecast.expectedOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: input.effectiveKrwPerUsd,
    });
    if (displayPoints == null) continue;
    out[modelId] = {
      promptTokens: predictedBillableInputTokens,
      expectedOutputTokens: outputForecast.expectedOutputTokens,
      outputChars: outputForecast.outputChars,
      displayPoints,
      outputBasis: outputForecast.outputBasis,
      localAssembledInputTokens,
      predictedBillableInputTokens,
      actualBillableInputTokens: calibrated.actualBillableInputTokens,
      calibrationSource: calibrated.calibrationSource,
      calibrationConfidence: calibrated.calibrationConfidence,
      outputHistorySampleCount: outputForecast.outputHistorySampleCount,
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
