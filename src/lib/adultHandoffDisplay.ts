import {
  isCheaperInferenceClaudeOpus5Model,
  isCheaperInferenceGemini31ProModel,
  isCheaperInferenceGemini37FlashModel,
  selectedAILabel,
} from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";

/** Tooltip / model-detail copy. Do not put this on the main picker label. */
export const ADULT_HANDOFF_NOTICE =
  "일부 성인 장면에서는 문체와 캐릭터 연속성을 유지하기 위해 성인 장면 호환 모델로 자동 전환될 수 있습니다. 해당 턴의 포인트는 실제 사용된 모델 기준으로 계산됩니다.";

/** Optional short badge/hint. Must not name the internal model. */
export const ADULT_HANDOFF_HINT = "성인 장면 자동 호환 지원";

export const ADULT_HANDOFF_REASON = "성인 장면 호환";

/** Optional points-tooltip helper. Must not name the internal model. */
export const ADULT_HANDOFF_POINTS_HINT = "성인 장면 호환 모델 사용";

const BANNED_PUBLIC_WORDING = [
  "검열 우회",
  "NSFW 우회",
  "fallback sex model",
  "검열 해제",
  "프록시 모델",
];

export type PublicAdultHandoffRouting = {
  activeRoute: "adult";
  userSelectedModel: string;
  userSelectedModelLabel: string;
  actualModel: string;
  actualProvider: string;
};

export type AdultHandoffReceiptLines = {
  selectedModelLabel: string;
  actualModelLabel: string;
  reason: string;
};

export function modelSupportsAdultHandoffNotice(selectedAI: string): boolean {
  return (
    isCheaperInferenceClaudeOpus5Model(selectedAI) ||
    isCheaperInferenceGemini31ProModel(selectedAI) ||
    isCheaperInferenceGemini37FlashModel(selectedAI)
  );
}

export function isAdultHandoffDisplayTurn(
  routing?: Usage["adultRouting"] | null
): boolean {
  if (!routing) return false;
  if (routing.activeRoute !== "adult") return false;
  const selected = routing.userSelectedModel?.trim();
  const actual = routing.actualModel?.trim();
  if (!selected || !actual) return false;
  return selected !== actual;
}

export function toPublicAdultHandoffRouting(
  routing?: Usage["adultRouting"] | null
): PublicAdultHandoffRouting | undefined {
  if (!isAdultHandoffDisplayTurn(routing) || !routing) return undefined;
  return {
    activeRoute: "adult",
    userSelectedModel: routing.userSelectedModel,
    userSelectedModelLabel:
      routing.userSelectedModelLabel || selectedAILabel(routing.userSelectedModel),
    actualModel: routing.actualModel,
    actualProvider: routing.actualProvider,
  };
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

export function resolveAdultHandoffReceiptLines(
  usage: Pick<Usage, "adultRouting">
): AdultHandoffReceiptLines | null {
  const routing = usage.adultRouting;
  if (!isAdultHandoffDisplayTurn(routing) || !routing) return null;
  return {
    selectedModelLabel:
      routing.userSelectedModelLabel || selectedAILabel(routing.userSelectedModel),
    actualModelLabel: selectedAILabel(routing.actualModel),
    reason: ADULT_HANDOFF_REASON,
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
