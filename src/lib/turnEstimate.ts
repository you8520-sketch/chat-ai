/**
 * Per-turn estimate owner — Published preview only. Not a live admission or charge.
 *
 * Token derivation lives here. KRW/P conversion stays in publishedUserCharge.ts.
 * Picker label format stays in modelPickerBaselineEstimate.ts.
 * Do not import this from route.ts / chatBillingSettlement.ts until the
 * admission policy is confirmed.
 */
import { MAIN_RP_MODEL_IDS, type SelectedAI } from "@/lib/chatModels";
import { MIN_POINTS_TO_CHAT } from "@/lib/points";
import {
  computePublishedStandardPreviewDisplayPoints,
  computePublishedStandardPreviewPoints,
} from "@/lib/publishedUserCharge";
import {
  KOREAN_CHARS_PER_OUTPUT_TOKEN,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";

/** Soft production aim — estimate floor, not an output cap. */
export const TURN_ESTIMATE_OUTPUT_CHAR_FLOOR = UNIFIED_TIER_AIM_CHARS;

/** Review candidate only. Not a live admission multiplier. */
export const CANDIDATE_ADMISSION_MULTIPLIER = 3;

/** Review candidate only. Not a live overdraft cap. */
export const CANDIDATE_OPEN_OVERDRAFT_CAP_POINTS = 1_000;

export type TurnEstimateWorkload = {
  promptTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type TurnEstimatePoints = {
  modelId: SelectedAI;
  displayPoints: number | null;
  chargeCeilPoints: number | null;
  candidateAdmissionFloor: number | null;
};

export function estimateOutputTokensForTurn(opts?: {
  lastAssistantChars?: number | null;
}): number {
  const last = opts?.lastAssistantChars;
  const chars =
    typeof last === "number" && Number.isFinite(last) && last > TURN_ESTIMATE_OUTPUT_CHAR_FLOOR
      ? Math.floor(last)
      : TURN_ESTIMATE_OUTPUT_CHAR_FLOOR;
  return Math.max(1, Math.ceil(chars / KOREAN_CHARS_PER_OUTPUT_TOKEN));
}

/** Conservative cache: unverified discount is omitted. */
export function buildTurnEstimateWorkload(input: {
  promptTokens: number;
  lastAssistantChars?: number | null;
  extraBillableOutputTokens?: number;
}): TurnEstimateWorkload {
  const promptTokens = Math.max(0, Math.floor(input.promptTokens));
  const extra = Math.max(0, Math.floor(input.extraBillableOutputTokens ?? 0));
  return {
    promptTokens,
    outputTokens: estimateOutputTokensForTurn({
      lastAssistantChars: input.lastAssistantChars,
    }) + extra,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function computeCandidateAdmissionFloor(chargeCeilPoints: number | null): number | null {
  if (chargeCeilPoints == null || !Number.isSafeInteger(chargeCeilPoints) || chargeCeilPoints <= 0) {
    return null;
  }
  return Math.max(
    MIN_POINTS_TO_CHAT,
    Math.ceil(chargeCeilPoints * CANDIDATE_ADMISSION_MULTIPLIER)
  );
}

export function computeTurnEstimateForModel(input: {
  modelId: SelectedAI;
  workload: TurnEstimateWorkload;
  effectiveKrwPerUsd: number;
}): TurnEstimatePoints {
  const displayPoints = computePublishedStandardPreviewDisplayPoints({
    modelId: input.modelId,
    promptTokens: input.workload.promptTokens,
    outputTokens: input.workload.outputTokens,
    cacheReadTokens: input.workload.cacheReadTokens,
    cacheWriteTokens: input.workload.cacheWriteTokens,
    effectiveKrwPerUsd: input.effectiveKrwPerUsd,
  });
  const chargeCeilPoints = computePublishedStandardPreviewPoints({
    modelId: input.modelId,
    promptTokens: input.workload.promptTokens,
    outputTokens: input.workload.outputTokens,
    cacheReadTokens: input.workload.cacheReadTokens,
    cacheWriteTokens: input.workload.cacheWriteTokens,
    effectiveKrwPerUsd: input.effectiveKrwPerUsd,
  });
  return {
    modelId: input.modelId,
    displayPoints,
    chargeCeilPoints,
    candidateAdmissionFloor: computeCandidateAdmissionFloor(chargeCeilPoints),
  };
}

export function computeMainRpTurnEstimates(input: {
  promptTokens: number;
  lastAssistantChars?: number | null;
  extraBillableOutputTokens?: number;
  effectiveKrwPerUsd: number;
}): Partial<Record<SelectedAI, TurnEstimatePoints>> {
  const workload = buildTurnEstimateWorkload({
    promptTokens: input.promptTokens,
    lastAssistantChars: input.lastAssistantChars,
    extraBillableOutputTokens: input.extraBillableOutputTokens,
  });
  const out: Partial<Record<SelectedAI, TurnEstimatePoints>> = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const estimate = computeTurnEstimateForModel({
      modelId,
      workload,
      effectiveKrwPerUsd: input.effectiveKrwPerUsd,
    });
    if (estimate.displayPoints != null && estimate.chargeCeilPoints != null) {
      out[modelId] = estimate;
    }
  }
  return out;
}

export function turnEstimateDisplayMap(
  estimates: Partial<Record<SelectedAI, TurnEstimatePoints>>
): Partial<Record<SelectedAI, number>> {
  const out: Partial<Record<SelectedAI, number>> = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const points = estimates[modelId]?.displayPoints;
    if (points != null) out[modelId] = points;
  }
  return out;
}
