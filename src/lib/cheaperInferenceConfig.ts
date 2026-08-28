import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  isCheaperInferenceClaudeOpus5Model,
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
  isCheaperInferenceGemini31ProModel,
  isCheaperInferenceGemini37FlashModel,
  isCheaperInferenceQwen38MaxModel,
  isDeepSeekV4ProModel,
  isGpt56LunaModel,
  isGpt56TerraModel,
  normalizeDeepSeekV4FlashModelId,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";

/** Cheaper Inference OpenAI-compatible API root. */
export const CHEAPER_INFERENCE_BASE_URL = "https://api.cheaperinference.com/v1";

/** Chat completions endpoint used by interactive RP. */
export const CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL =
  `${CHEAPER_INFERENCE_BASE_URL}/chat/completions`;

export function resolveCheaperInferenceApiKey(): string {
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key) {
    throw new Error("NO_CHEAPER_INFERENCE_KEY");
  }
  return key;
}

export function buildCheaperInferenceHeaders(apiKey?: string): Record<string, string> {
  const key = apiKey?.trim() || resolveCheaperInferenceApiKey();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

export function assertCheaperInferenceEndpoint(url: string): void {
  if (url !== CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL) {
    throw new Error(
      `[CheaperInference] invalid endpoint URL: ${JSON.stringify(url)}`
    );
  }
}

export type CheaperInferenceAdaptOpts = {
  /**
   * Non-DeepSeek → DeepSeek0813 adult-handoff only.
   * Native/user-selected DeepSeek must omit this flag.
   */
  deepSeekAdultHandoffTrueOff?: boolean;
};

/** Adult-handoff TRUE-OFF applies only after a non-DeepSeek source hands off. */
export function resolveDeepSeekAdultHandoffTrueOff(input: {
  selectedModelId: string;
  adultHandoffActuallyApplied: boolean;
  resolvedTargetModelId: string;
}): boolean {
  const target = normalizeDeepSeekV4ProModelId(input.resolvedTargetModelId);
  return (
    !isDeepSeekV4ProModel(input.selectedModelId) &&
    input.adultHandoffActuallyApplied === true &&
    target === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
}

/**
 * Final adult-handoff outbound owner — runs after the generic DeepSeek adapter
 * so `reasoning_effort` is not deleted again.
 */
export function applyDeepSeekAdultHandoffTrueOff(
  body: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...body };
  delete next.enable_thinking;
  delete next.reasoning;
  delete next.include_reasoning;
  next.thinking = { type: "disabled" };
  next.reasoning_effort = "none";
  return next;
}

/**
 * Canonical per-model reasoning/thinking policy for Cheaper Inference chat completions.
 * Shared by RP `adaptCheaperInferenceChatBody` and TRPG transport adapters.
 */
export function applyCheaperInferenceModelReasoningPolicy(
  body: Record<string, unknown>
): Record<string, unknown> {
  const adapted = { ...body };
  if (typeof adapted.model !== "string") return adapted;

  const model = normalizeDeepSeekV4FlashModelId(normalizeDeepSeekV4ProModelId(adapted.model));
  adapted.model = model;
  if (
    isCheaperInferenceDeepSeekV4FlashModel(model) ||
    isCheaperInferenceDeepSeekV4ProModel(model)
  ) {
    if (isCheaperInferenceDeepSeekV4ProModel(model)) {
      adapted.model = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
    } else {
      adapted.model = CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;
    }
    delete adapted.reasoning_effort;
    adapted.thinking = { type: "disabled" };
    return adapted;
  }
  if (isCheaperInferenceClaudeOpus5Model(model)) {
    adapted.thinking = { type: "disabled" };
    adapted.output_config = { effort: "low" };
    adapted.reasoning_effort = "low";
    return adapted;
  }
  if (isGpt56LunaModel(model) || isGpt56TerraModel(model)) {
    adapted.reasoning = { effort: "none" };
    adapted.reasoning_effort = "none";
    delete adapted.thinking;
    return adapted;
  }
  if (isCheaperInferenceGemini37FlashModel(model)) {
    adapted.reasoning_effort = "low";
    delete adapted.thinking;
    delete adapted.reasoning;
    return adapted;
  }
  if (isCheaperInferenceQwen38MaxModel(model)) {
    delete adapted.thinking;
    adapted.reasoning_effort = "none";
    delete adapted.reasoning;
    return adapted;
  }
  adapted.reasoning_effort = isCheaperInferenceGemini31ProModel(model) ? "low" : "none";
  delete adapted.thinking;
  delete adapted.reasoning;
  return adapted;
}

/** Strip OpenRouter-only extensions before sending an OpenAI-compatible request. */
export function adaptCheaperInferenceChatBody(
  body: Record<string, unknown>,
  opts?: CheaperInferenceAdaptOpts
): Record<string, unknown> {
  const adapted = { ...body };
  delete adapted.session_id;
  delete adapted.frequency_penalty;
  delete adapted.presence_penalty;
  delete adapted.repetition_penalty;
  delete adapted.reasoning;
  delete adapted.include_reasoning;

  if (typeof adapted.model === "string") {
    const withPolicy = applyCheaperInferenceModelReasoningPolicy(adapted);
    if (
      opts?.deepSeekAdultHandoffTrueOff === true &&
      isCheaperInferenceDeepSeekV4ProModel(String(withPolicy.model))
    ) {
      return applyDeepSeekAdultHandoffTrueOff(withPolicy);
    }
    return withPolicy;
  }
  return adapted;
}
