import {
  MAIN_RP_MODEL_IDS,
  selectedAILabel,
  selectedAIOptionMeta,
  type SelectedAI,
} from "@/lib/chatModels";
import type { SitePromotionClientView } from "@/lib/sitePromotionClientView";

/** Room picker label map. Points come from next-turn Published estimates. */
export type ModelPickerEstimateMap = Partial<Record<SelectedAI, number>>;

/**
 * Label confidence only. Does not change the Published point calculation.
 * anchored = same-model actual usage plus history delta.
 * initial = local assembled estimate with no same-model anchor.
 * unavailable = this response could not price the model.
 */
export type ModelPickerEstimateConfidence = "anchored" | "initial" | "unavailable";

export type ModelPickerEstimateConfidenceMap = Partial<
  Record<SelectedAI, ModelPickerEstimateConfidence>
>;

export type ModelPickerEstimatePresentation = {
  points: ModelPickerEstimateMap;
  confidence: ModelPickerEstimateConfidenceMap;
};

/** Shown once beside the picker. Not a cap and not a confirmed charge. */
export const PICKER_ESTIMATE_VARIANCE_NOTE = "실제 사용량에 따라 달라집니다.";

const ANCHORED_FORECAST_SOURCE = "same_model_actual_anchored_delta";
const INITIAL_FORECAST_SOURCE = "uncalibrated_assembled";

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

export function modelPickerConfidenceFromForecastSource(
  source: unknown
): Exclude<ModelPickerEstimateConfidence, "unavailable"> | null {
  if (source === ANCHORED_FORECAST_SOURCE) return "anchored";
  if (source === INITIAL_FORECAST_SOURCE) return "initial";
  return null;
}

export function modelPickerConfidenceFromEstimateRows(
  estimates:
    | Partial<
        Record<string, { forecastSource?: unknown; displayPoints?: unknown } | null | undefined>
      >
    | null
    | undefined
): ModelPickerEstimateConfidenceMap {
  const out: ModelPickerEstimateConfidenceMap = {};
  if (!estimates) return out;
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const row = estimates[modelId];
    if (!row) continue;
    const points = row.displayPoints;
    const hasPoints =
      typeof points === "number" && Number.isSafeInteger(points) && points > 0;
    if (!hasPoints) {
      out[modelId] = "unavailable";
      continue;
    }
    out[modelId] =
      modelPickerConfidenceFromForecastSource(row.forecastSource) ?? "initial";
  }
  return out;
}

/** Reads the existing next-turn payload (`estimates` points + `models` rows). */
export function parseModelPickerEstimatePresentation(
  payload: unknown
): ModelPickerEstimatePresentation | null {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload as { estimates?: unknown; models?: unknown };
  const points = parseModelPickerEstimates(body.estimates);
  if (!points) return null;
  const models =
    body.models != null && typeof body.models === "object" && !Array.isArray(body.models)
      ? (body.models as Record<string, unknown>)
      : null;
  const confidence: ModelPickerEstimateConfidenceMap = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const point = points[modelId];
    const row = models?.[modelId];
    const forecastSource =
      row != null && typeof row === "object" && !Array.isArray(row)
        ? (row as { forecastSource?: unknown }).forecastSource
        : undefined;
    if (point == null) {
      if (models) confidence[modelId] = "unavailable";
      continue;
    }
    confidence[modelId] =
      modelPickerConfidenceFromForecastSource(forecastSource) ?? "initial";
  }
  return { points, confidence };
}

/** Drop a late next-turn response after a newer picker refresh. */
export function acceptPickerEstimateResponse<T>(input: {
  requestId: number;
  latestRequestId: number;
  presentation: T | null;
}): T | null {
  if (input.requestId !== input.latestRequestId) return null;
  return input.presentation;
}

export function formatPickerEstimateSuffix(
  points: number | null | undefined,
  confidence?: ModelPickerEstimateConfidence | null
): string {
  switch (confidence) {
    case "unavailable":
      return " · 예상 —";
    case "initial":
      if (points == null || !Number.isSafeInteger(points) || points <= 0) return "";
      return ` · 약 ${points}P · 초기 추정`;
    case "anchored":
    case null:
    case undefined:
      if (points == null || !Number.isSafeInteger(points) || points <= 0) return "";
      return ` · 약 ${points}P`;
    default: {
      const _never: never = confidence;
      return _never;
    }
  }
}

/** Model option label — site promo badge from canonical active promotion only. */
export function selectedAIOptionLabel(
  id: SelectedAI,
  activeSitePromotionsByModelId: Record<string, SitePromotionClientView>,
  estimates?: ModelPickerEstimateMap,
  confidence?: ModelPickerEstimateConfidenceMap
): string {
  const promoBadge = activeSitePromotionsByModelId[id]?.badge;
  const meta = selectedAIOptionMeta(id);
  const staticBadge =
    meta && "badge" in meta && typeof meta.badge === "string" && meta.badge
      ? meta.badge
      : "";
  const badgeText = promoBadge || staticBadge;
  const badge = badgeText ? ` [${badgeText}]` : "";
  return `${selectedAILabel(id)}${badge}${formatPickerEstimateSuffix(
    estimates?.[id],
    confidence?.[id]
  )}`;
}
