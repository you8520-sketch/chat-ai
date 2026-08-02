import {
  isCheaperInferenceGemini31ProModel,
  isGpt56LunaModel,
  isGpt56TerraModel,
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
    if (isCheaperInferenceGemini31ProModel(adapted.model)) {
      adapted.reasoning_effort = "low";
    } else if (isGpt56LunaModel(adapted.model) || isGpt56TerraModel(adapted.model)) {
      // Production (main #199): Cheaper Inference defaults to hidden reasoning unless off.
      adapted.reasoning_effort = "none";
    }
  }
  return adapted;
}
