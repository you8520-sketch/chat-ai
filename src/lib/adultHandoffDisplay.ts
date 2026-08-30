import {
  isCheaperInferenceClaudeOpus5Model,
  isCheaperInferenceGemini31ProModel,
  isCheaperInferenceGemini37FlashModel,
} from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";

/** Tooltip / model-detail copy. Do not put this on the main picker label. */
export const ADULT_HANDOFF_NOTICE =
  "일부 성인 장면에서는 호환 모델이 자동으로 사용될 수 있으며, 해당 턴은 실제 사용 모델 기준으로 포인트가 계산됩니다.";

/** Optional short badge/hint. Must not name the internal model. */
export const ADULT_HANDOFF_HINT = "성인 장면 자동 호환 지원";

const BANNED_PUBLIC_WORDING = [
  "검열 우회",
  "NSFW 우회",
  "fallback sex model",
  "검열 해제",
  "프록시 모델",
  "Qwen",
  "DeepSeek",
  "마진율",
  "원가",
];

export function modelSupportsAdultHandoffNotice(selectedAI: string): boolean {
  return (
    isCheaperInferenceClaudeOpus5Model(selectedAI) ||
    isCheaperInferenceGemini31ProModel(selectedAI) ||
    isCheaperInferenceGemini37FlashModel(selectedAI)
  );
}

/** Top-level receipt identity stays on the user-selected model. */
export function applySelectedModelIdentity(
  usage: Usage,
  routing: NonNullable<Usage["adultRouting"]>
): Usage {
  const next: Usage = {
    ...usage,
    model: routing.userSelectedModel,
    modelLabel: routing.userSelectedModelLabel,
    selectedAI: routing.userSelectedModel,
  };
  if (routing.userSelectedProvider) {
    next.provider = routing.userSelectedProvider;
  }
  return next;
}

export function collapsePublicHandoffStages(
  usage: Usage,
  routing: NonNullable<Usage["adultRouting"]>
): Usage {
  if (!usage.stages?.length) return usage;
  return {
    ...usage,
    stages: usage.stages.map((stage) => ({
      ...stage,
      model: routing.userSelectedModel,
      stage: "main",
    })),
  };
}

export function publicAdultHandoffCopyIsSafe(text: string): boolean {
  return !BANNED_PUBLIC_WORDING.some((banned) => text.includes(banned));
}

export function selectedModelIdentityIsStable(
  usage: Pick<Usage, "model" | "modelLabel" | "selectedAI">,
  selectedModel: string,
  selectedLabel: string
): boolean {
  return (
    usage.model === selectedModel &&
    usage.modelLabel === selectedLabel &&
    usage.selectedAI === selectedModel
  );
}
