import { ADULT_SCENE_MODEL_POLICY } from "@/lib/adultSceneModelPolicy";

/** Single refusal-replacement target for all eligible general RP models. */
export const ADULT_REFUSAL_FALLBACK_MODEL_ID = ADULT_SCENE_MODEL_POLICY.primaryModelId;

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
  const selected = selectedModelId.trim().toLowerCase();
  const target = fallbackModelId.trim().toLowerCase();
  return selected.length > 0 && selected !== target;
}

export function isAllowedAdultHandoffTargetModel(modelId: string): boolean {
  return modelId.trim().toLowerCase() === ADULT_REFUSAL_FALLBACK_MODEL_ID;
}
