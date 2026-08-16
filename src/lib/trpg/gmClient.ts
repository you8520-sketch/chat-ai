import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  isCheaperInferenceDeepSeekV4ProModel,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";

/**
 * TRPG GM body adapter — isolated from RP `adaptCheaperInferenceChatBody`.
 * Regular chat keeps DeepSeek thinking disabled; GM Pro turns thinking on.
 */
export function adaptTrpgGmChatBody(body: Record<string, unknown>): Record<string, unknown> {
  const adapted = { ...body };
  delete adapted.session_id;
  delete adapted.frequency_penalty;
  delete adapted.presence_penalty;
  delete adapted.repetition_penalty;
  delete adapted.include_reasoning;

  if (typeof adapted.model === "string") {
    const model = normalizeDeepSeekV4ProModelId(adapted.model);
    adapted.model = isCheaperInferenceDeepSeekV4ProModel(model)
      ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
      : model;
    if (isCheaperInferenceDeepSeekV4ProModel(model)) {
      delete adapted.reasoning_effort;
      adapted.thinking = { type: "enabled" };
      return adapted;
    }
  }

  adapted.thinking = { type: "enabled" };
  return adapted;
}

/**
 * Bot-seat Pro call — thinking OFF like regular RP.
 * Isolated from both GM (thinking on) and `adaptCheaperInferenceChatBody`.
 */
export function adaptTrpgBotChatBody(body: Record<string, unknown>): Record<string, unknown> {
  const adapted = { ...body };
  delete adapted.session_id;
  delete adapted.frequency_penalty;
  delete adapted.presence_penalty;
  delete adapted.repetition_penalty;
  delete adapted.include_reasoning;
  delete adapted.reasoning_effort;
  if (typeof adapted.model === "string") {
    const model = normalizeDeepSeekV4ProModelId(adapted.model);
    adapted.model = isCheaperInferenceDeepSeekV4ProModel(model)
      ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
      : model;
  }
  adapted.thinking = { type: "disabled" };
  return adapted;
}
