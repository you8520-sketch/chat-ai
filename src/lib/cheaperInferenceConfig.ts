import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  isCheaperInferenceClaudeOpus5Model,
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
  isCheaperInferenceGemini31ProModel,
  isCheaperInferenceGemini37FlashModel,
  isCheaperInferenceQwen38MaxModel,
  isGpt56LunaModel,
  isGpt56TerraModel,
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

/** Strip OpenRouter-only extensions before sending an OpenAI-compatible request. */
export function adaptCheaperInferenceChatBody(
  body: Record<string, unknown>
): Record<string, unknown> {
  const adapted = { ...body };
  delete adapted.session_id;
  delete adapted.frequency_penalty;
  delete adapted.presence_penalty;
  delete adapted.repetition_penalty;
  delete adapted.reasoning;
  delete adapted.include_reasoning;

  if (typeof adapted.model === "string") {
    const model = normalizeDeepSeekV4ProModelId(adapted.model);
    adapted.model = model;
    if (
      isCheaperInferenceDeepSeekV4FlashModel(model) ||
      isCheaperInferenceDeepSeekV4ProModel(model)
    ) {
      if (isCheaperInferenceDeepSeekV4ProModel(model)) {
        adapted.model = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
      }
      delete adapted.reasoning_effort;
      adapted.thinking = { type: "disabled" };
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
