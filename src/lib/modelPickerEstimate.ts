import {
  MAIN_RP_MODEL_IDS,
  selectedAILabel,
  selectedAIOptionMeta,
  type SelectedAI,
} from "@/lib/chatModels";
import type { SitePromotionClientView } from "@/lib/sitePromotionClientView";

/** Room picker label map. Points come from next-turn Published estimates. */
export type ModelPickerEstimateMap = Partial<Record<SelectedAI, number>>;

export function parseModelPickerEstimates(
  value: unknown
): ModelPickerEstimateMap | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: ModelPickerEstimateMap = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const points = raw[modelId];
    if (typeof points === "number" && Number.isSafeInteger(points) && points > 0) {
      out[modelId] = points;
    }
  }
  return out;
}

export function formatPickerEstimateSuffix(
  points: number | null | undefined
): string {
  if (points == null || !Number.isSafeInteger(points) || points <= 0) return "";
  return ` · 약 ${points}P`;
}

/** Model option label — site promo badge from canonical active promotion only. */
export function selectedAIOptionLabel(
  id: SelectedAI,
  activeSitePromotionsByModelId: Record<string, SitePromotionClientView>,
  estimates?: ModelPickerEstimateMap
): string {
  const promoBadge = activeSitePromotionsByModelId[id]?.badge;
  const meta = selectedAIOptionMeta(id);
  const staticBadge =
    meta && "badge" in meta && typeof meta.badge === "string" && meta.badge
      ? meta.badge
      : "";
  const badgeText = promoBadge || staticBadge;
  const badge = badgeText ? ` [${badgeText}]` : "";
  return `${selectedAILabel(id)}${badge}${formatPickerEstimateSuffix(estimates?.[id])}`;
}
