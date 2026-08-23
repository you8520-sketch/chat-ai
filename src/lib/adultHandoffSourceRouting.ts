import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";

/** Single refusal-replacement target for all eligible general RP models. */
export const ADULT_REFUSAL_FALLBACK_MODEL_ID = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

export function resolveAdultRefusalFallbackModelId(
  _selectedModelId?: string
): string {
  return ADULT_REFUSAL_FALLBACK_MODEL_ID;
}

/** @deprecated use resolveAdultRefusalFallbackModelId */
export function resolveAdultHandoffTargetModelId(input: {
  sourceModelId: string;
  existingAdultModelId: string;
}): string {
  void input;
  return ADULT_REFUSAL_FALLBACK_MODEL_ID;
}

export function isAdultRefusalHandoffCase(
  selectedModelId: string,
  fallbackModelId: string = ADULT_REFUSAL_FALLBACK_MODEL_ID
): boolean {
  const selected = normalizeDeepSeekV4ProModelId(selectedModelId).trim().toLowerCase();
  const target = normalizeDeepSeekV4ProModelId(fallbackModelId).trim().toLowerCase();
  return selected.length > 0 && selected !== target;
}

export function isAllowedAdultHandoffTargetModel(modelId: string): boolean {
  return (
    normalizeDeepSeekV4ProModelId(modelId) === ADULT_REFUSAL_FALLBACK_MODEL_ID
  );
}
