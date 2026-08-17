import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  isCheaperInferenceDeepSeekV4ProModel,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";

/**
 * TRPG GM body adapter — isolated from RP `adaptCheaperInferenceChatBody`.
 * DeepSeek V4 Pro 0813 does not disable reasoning from `thinking.disabled`
 * alone. True OFF is both fields together.
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
  }
  adapted.thinking = { type: "disabled" };
  adapted.reasoning_effort = "none";
  return adapted;
}

/**
 * Bot-seat Pro call — Thinking OFF is the product contract.
 * DeepSeek V4 Pro 0813 does not actually disable reasoning from
 * `thinking: { type: "disabled" }` alone; `reasoning_effort: "none"` must
 * be sent with it. Isolated from GM (thinking on) and RP chat.
 */
export function adaptTrpgBotChatBody(body: Record<string, unknown>): Record<string, unknown> {
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
  }
  adapted.thinking = { type: "disabled" };
  adapted.reasoning_effort = "none";
  return adapted;
}
