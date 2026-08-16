import { isCheaperInferenceGemini37FlashModel } from "@/lib/chatModels";

/**
 * Gemini 3.7 Flash — length-only placement experiment (C).
 * Same sentence as the B system/model-specific trial.
 * Injected once at the assembled user-turn terminal (after the common length owner).
 * Must not appear in system/model-specific sections.
 * Must not edit `USER_TAIL_LENGTH_OWNER_SENTENCE`.
 */
export const GEMINI37_FLASH_LENGTH_SENTENCE =
  "현재 장면을 충분히 전개하여 한국어 공백 포함 약 3,200~4,000자 분량으로 완성한다. 짧게 마무리하거나 요약하지 않는다.";

export function isGemini37FlashLengthAdapterEnabled(
  modelId?: string | null
): boolean {
  return isCheaperInferenceGemini37FlashModel(modelId ?? "");
}

/** System/model-specific injection is disabled. Placement is user-turn terminal only. */
export function resolveGemini37FlashLengthAdapterSection(
  _modelId?: string | null
): string | null {
  return null;
}

/** Append the length sentence once as the last user-turn instruction. Dedup if present. */
export function appendGemini37FlashLengthToUserTurn(
  userContent: string,
  modelId?: string | null
): string {
  if (!isGemini37FlashLengthAdapterEnabled(modelId)) return userContent;
  const body = userContent.trimEnd();
  if (body.includes(GEMINI37_FLASH_LENGTH_SENTENCE)) return userContent;
  if (!body) return GEMINI37_FLASH_LENGTH_SENTENCE;
  return `${body}\n\n${GEMINI37_FLASH_LENGTH_SENTENCE}`;
}
