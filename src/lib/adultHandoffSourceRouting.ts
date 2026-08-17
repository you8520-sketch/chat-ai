import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  isCheaperInferenceClaudeOpus5Model,
  isCheaperInferenceGemini31ProModel,
  isCheaperInferenceGemini37FlashModel,
  isCheaperInferenceQwen38MaxModel,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";
import type { AdultSceneHardFailureReason } from "@/lib/adultSceneModelPolicy";

export type AdultHandoffIdentityState = {
  adultHandoffSourceModelId?: string;
  adultHandoffTargetModelId?: string;
};

export const OPUS_QWEN_FRAGMENT_SENTENCE =
  "직전 assistant의 호흡을 기준으로 문단은 한두 문장 수가 아니라 의미 단위로 나눈다. 같은 화자의 짧은 연속 발화·확인·감탄은 가능한 한 하나의 대사 블록으로 묶고, 하나의 행동·감각·생각 흐름에 속한 서술은 한 문단 안에서 충분히 연결하며, 실제 의미 초점이나 행동 단계가 바뀔 때만 새 문단으로 전환한다.";

export const GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK = `[QWEN SOURCE STYLE CONTINUITY — GEMINI 3.1]
직전 assistant의 문체적 특징을 기준으로 장면을 자연스럽게 이어간다.
직전 출력의 문장 길이와 호흡, 설명 밀도, 문단의 평균 크기, 대사의 배치와 서술의 연속성을 같은 흐름으로 유지한다.
하나의 행동·감각·생각·상황 설명이 같은 의미 흐름 안에서 이어질 때는 관련 문장들을 한 문단 안에서 충분히 연결하고, 새로운 의미 단위나 장면의 초점이 바뀌는 지점에서 자연스럽게 다음 문단으로 전환한다.
대사는 직전 assistant와 비슷한 빈도와 간격으로 배치하며, 서술과 대사가 하나의 장면 흐름 안에서 이어지도록 구성한다.
캐릭터의 말투·호칭·감정 표현과 세계관·능력·외형 디테일을 직전 출력이 사용한 방식에 맞춰 이어간다.`;

export function normalizeAdultHandoffSourceModelId(modelId: string): string {
  const id = modelId.trim();
  const lower = id.toLowerCase();
  if (isCheaperInferenceClaudeOpus5Model(lower)) {
    return CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;
  }
  if (
    isCheaperInferenceGemini31ProModel(lower) ||
    lower === "google/gemini-3.1-pro-preview"
  ) {
    return CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
  }
  if (isCheaperInferenceGemini37FlashModel(lower)) {
    return CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
  }
  return id;
}

export function resolvePersistedAdultHandoffSourceModelId(input: {
  selectedModelId: string;
  state: AdultHandoffIdentityState;
}): string {
  if (input.state.adultHandoffSourceModelId?.trim()) {
    return normalizeAdultHandoffSourceModelId(input.state.adultHandoffSourceModelId);
  }
  return normalizeAdultHandoffSourceModelId(input.selectedModelId);
}

export function resolveAdultHandoffModelForSource(
  sourceModelId: string,
  existingAdultModelId: string
): string {
  const source = normalizeAdultHandoffSourceModelId(sourceModelId);
  if (source === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL) {
    return CHEAPER_INFERENCE_QWEN_38_MAX_MODEL;
  }
  if (source === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL) {
    return CHEAPER_INFERENCE_QWEN_38_MAX_MODEL;
  }
  if (source === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL) {
    return CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
  }
  return existingAdultModelId;
}

export function resolveAdultHandoffTargetModelId(input: {
  sourceModelId: string;
  existingAdultModelId: string;
  state: AdultHandoffIdentityState;
}): string {
  if (input.state.adultHandoffTargetModelId?.trim()) {
    return input.state.adultHandoffTargetModelId.trim();
  }
  return resolveAdultHandoffModelForSource(
    input.sourceModelId,
    input.existingAdultModelId
  );
}

export function isAllowedAdultHandoffTargetModel(modelId: string): boolean {
  const id = normalizeDeepSeekV4ProModelId(modelId);
  return (
    id === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL ||
    isCheaperInferenceQwen38MaxModel(id)
  );
}

export function resolveSourceSpecificQwenAdapter(
  sourceModelId?: string,
  adultTargetModelId?: string
): string | null {
  if (!sourceModelId || !adultTargetModelId) return null;
  if (!isCheaperInferenceQwen38MaxModel(adultTargetModelId)) return null;
  const source = normalizeAdultHandoffSourceModelId(sourceModelId);
  if (source === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL) {
    return OPUS_QWEN_FRAGMENT_SENTENCE;
  }
  if (source === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL) {
    return GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK;
  }
  return null;
}

export function appendSourceSpecificQwenAdapter(
  systemPrompt: string,
  sourceModelId?: string,
  adultTargetModelId?: string
): string {
  const adapter = resolveSourceSpecificQwenAdapter(sourceModelId, adultTargetModelId);
  if (!adapter) return systemPrompt;
  if (systemPrompt.includes(adapter)) return systemPrompt;
  return `${systemPrompt.trim()}\n\n${adapter}`;
}

export function stripSourceSpecificQwenAdapters(text: string): string {
  return text
    .split(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK)
    .join("")
    .split(OPUS_QWEN_FRAGMENT_SENTENCE)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function rebuildAdultHandoffPromptForDeepSeekFallback(
  systemPrompt: string,
  sourceModelId?: string
): string {
  return appendSourceSpecificQwenAdapter(
    stripSourceSpecificQwenAdapters(systemPrompt),
    sourceModelId,
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
}

export function rebuildAdultHandoffSystemSplitForDeepSeekFallback<
  T extends { dynamicBlock: string },
>(split: T | undefined, sourceModelId?: string): T | undefined {
  if (!split) return undefined;
  return {
    ...split,
    dynamicBlock: rebuildAdultHandoffPromptForDeepSeekFallback(
      split.dynamicBlock,
      sourceModelId
    ),
  };
}

export function shouldFallbackQwenHandoffToDeepSeek(input: {
  reason: AdultSceneHardFailureReason | null;
  fallbackAttemptCount: number;
  hasVisibleTokens: boolean;
}): boolean {
  return (
    input.reason != null &&
    !input.hasVisibleTokens &&
    input.fallbackAttemptCount < 1
  );
}
