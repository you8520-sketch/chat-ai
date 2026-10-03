import {
  MAIN_RP_MODEL_IDS,
  selectedAILabel,
  selectedAIOptionMeta,
  type SelectedAI,
} from "@/lib/chatModels";
import { computePublishedStandardPreviewDisplayPoints } from "@/lib/publishedUserCharge";
import type { SitePromotionClientView } from "@/lib/sitePromotionClientView";

/** Picker display workload — not a live charge fixture. */
export const PICKER_BASELINE_ESTIMATE_INPUT_TOKENS = 20_000;
export const PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS = 1_500;

export type ModelPickerBaselineEstimateMap = Partial<Record<SelectedAI, number>>;

export function parseModelPickerBaselineEstimates(
  value: unknown
): ModelPickerBaselineEstimateMap | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: ModelPickerBaselineEstimateMap = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const points = raw[modelId];
    if (typeof points === "number" && Number.isSafeInteger(points) && points > 0) {
      out[modelId] = points;
    }
  }
  return out;
}

export function computeMainRpPickerBaselineEstimates(
  effectiveKrwPerUsd: number
): ModelPickerBaselineEstimateMap {
  const out: ModelPickerBaselineEstimateMap = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const points = computePublishedStandardPreviewDisplayPoints({
      modelId,
      promptTokens: PICKER_BASELINE_ESTIMATE_INPUT_TOKENS,
      outputTokens: PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd,
    });
    if (points != null) out[modelId] = points;
  }
  return out;
}

export function formatPickerBaselineEstimateSuffix(
  points: number | null | undefined
): string {
  if (points == null || !Number.isSafeInteger(points) || points <= 0) return "";
  return ` · 약 ${points}P`;
}

/** Model option label — site promo badge from canonical active promotion only. */
export function selectedAIOptionLabel(
  id: SelectedAI,
  activeSitePromotionsByModelId: Record<string, SitePromotionClientView>,
  baselineEstimates?: ModelPickerBaselineEstimateMap
): string {
  const promoBadge = activeSitePromotionsByModelId[id]?.badge;
  const meta = selectedAIOptionMeta(id);
  const staticBadge =
    meta && "badge" in meta && typeof meta.badge === "string" && meta.badge
      ? meta.badge
      : "";
  const badgeText = promoBadge || staticBadge;
  const badge = badgeText ? ` [${badgeText}]` : "";
  return `${selectedAILabel(id)}${badge}${formatPickerBaselineEstimateSuffix(
    baselineEstimates?.[id]
  )}`;
}
