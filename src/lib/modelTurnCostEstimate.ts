/**
 * Client-safe model picker display helpers.
 * Cost calculation is server-authoritative — see /api/chat/model-picker-preview.
 */
export {
  formatModelPickerCostLabel,
  formatModelPickerCostLabelFromPreview,
  modelPickerOptionLabel,
  type ModelPickerPreviewModelResult,
  type ModelPickerPreviewResult,
  type ModelPickerUsageSample,
} from "@/lib/modelPickerPreviewTypes";

export type { ModelPickerUsageSample as UsageLikeForEstimate } from "@/lib/modelPickerPreviewTypes";

/** @deprecated Server preview — kept for legacy imports only. */
export const MODEL_PICKER_DEFAULT_INPUT_TOKENS = 4000;

/** @deprecated Server preview — kept for legacy imports only. */
export const MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS = 1500;
