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
    const model = normalizeDeepSeekV4FlashModelId(
      normalizeDeepSeekV4ProModelId(adapted.model)
    );
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
      if (
        opts?.deepSeekAdultHandoffTrueOff === true &&
        isCheaperInferenceDeepSeekV4ProModel(model)
      ) {
        return applyDeepSeekAdultHandoffTrueOff(adapted);
      }
      return adapted;
    }
    if (isCheaperInferenceClaudeOpus5Model(model)) {
      // Anthropic Opus 5: adaptive thinking is ON unless thinking is disabled.
      // Disabled is allowed only at effort high or below; low is the speed/cost floor.
      adapted.thinking = { type: "disabled" };
      adapted.output_config = { effort: "low" };
      adapted.reasoning_effort = "low";
      return adapted;
    }
    if (isGpt56LunaModel(model) || isGpt56TerraModel(model)) {
      // OpenAI GPT-5.6: default effort is medium. Official off is
      // reasoning.effort "none" (Luna/Terra support it). Cheaper Inference
      // chat completions forwards `reasoning`; keep reasoning_effort as the
      // Chat Completions alias some serving routes still read.
      adapted.reasoning = { effort: "none" };
      adapted.reasoning_effort = "none";
      return adapted;
    }
    // Cheaper Inference may default to hidden reasoning. All app calls use
    // visible output only. Gemini 3.1 Pro cannot disable thinking, so use its
    // lowest supported effort; every other compatible model is explicitly off.
    // Gemini 3.7 Flash: compatibility probe confirmed reasoning_effort=low.
    // Do not inherit the generic "none" fallback or Gemini 3.1-only extras.
    if (isCheaperInferenceGemini37FlashModel(model)) {
      adapted.reasoning_effort = "low";
      return adapted;
    }
    if (isCheaperInferenceQwen38MaxModel(model)) {
      delete adapted.thinking;
      adapted.reasoning_effort = "none";
      return adapted;
    }
    adapted.reasoning_effort = isCheaperInferenceGemini31ProModel(model)
      ? "low"
      : "none";
  }
  return adapted;
}
