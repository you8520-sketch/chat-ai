import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";

/**
 * Admin finance visibility is intentionally broader than the current picker.
 * Retired models remain observable so historical revenue/cost does not disappear
 * when a model is removed from Main RP selection.
 *
 * Historical finance visibility only. These are not selectable/routable Main RP owners.
 */
export const MAIN_RP_OBSERVABILITY_MODEL_IDS: readonly string[] = [
  ...MAIN_RP_MODEL_IDS,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
];
