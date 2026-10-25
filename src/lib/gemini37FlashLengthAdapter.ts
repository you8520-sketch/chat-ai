import { isCheaperInferenceGemini37FlashModel } from "@/lib/chatModels";

/**
 * Gemini 3.7 Flash — length-only experiment adapter.
 * One sentence. No style, agency, dialogue, world, or reasoning extras.
 */
export const GEMINI37_FLASH_LENGTH_SENTENCE =
  "현재 장면을 충분히 전개하여 한국어 공백 포함 약 3,200~4,000자 분량으로 완성한다. 짧게 마무리하거나 요약하지 않는다.";

export function resolveGemini37FlashLengthAdapterSection(
  modelId?: string | null
): string | null {
  if (!isCheaperInferenceGemini37FlashModel(modelId ?? "")) return null;
  return GEMINI37_FLASH_LENGTH_SENTENCE;
}
