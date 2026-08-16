import { isCheaperInferenceGemini37FlashModel } from "@/lib/chatModels";

/**
 * Gemini 3.7 Flash — SYSTEM length owner only.
 * One block, once, in the model-specific SYSTEM section.
 * No style, agency, dialogue, world, recovery, or user-tail extras.
 */
export const GEMINI37_FLASH_LENGTH_OWNER_TITLE =
  "[RESPONSE LENGTH — GEMINI 3.7 FLASH]";

export const GEMINI37_FLASH_LENGTH_OWNER_BLOCK = `${GEMINI37_FLASH_LENGTH_OWNER_TITLE}

현재 장면을 충분히 전개하여 한국어 공백 포함 약 4,000~5,500자 분량의 장편 RP 응답으로 작성한다.

짧은 반응 몇 개만 제시하고 종료하지 말고, 현재 입력에서 시작된 상호작용의 반응·행동·감각·환경 변화와 장면 진행을 충분히 이어간다.

분량을 맞추기 위해 같은 의미의 감정, 질문, 관찰, 표현을 반복하지 않는다. 새로운 반응과 행동, 감각 또는 환경 변화로 장면을 계속 전진시킨다.

요약·해설·다음 장면 예고가 아니라 현재 장면 자체를 작성한다.`;

/** Rejected B sentence — must never be reintroduced. */
export const REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE =
  "현재 장면을 충분히 전개하여 한국어 공백 포함 약 3,200~4,000자 분량으로 완성한다. 짧게 마무리하거나 요약하지 않는다.";

export function resolveGemini37FlashLengthAdapterSection(
  modelId?: string | null
): string | null {
  if (!isCheaperInferenceGemini37FlashModel(modelId ?? "")) return null;
  return GEMINI37_FLASH_LENGTH_OWNER_BLOCK;
}

/** Gemini 3.7 owns length in SYSTEM; suppress the generic user-tail owner. */
export function shouldSuppressGenericUserTailLengthOwner(
  modelId?: string | null
): boolean {
  return isCheaperInferenceGemini37FlashModel(modelId ?? "");
}

export function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = hay.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

export function auditGemini37LengthOwners(opts: {
  system: string;
  lastUser: string;
}): {
  GEMINI37_LENGTH_OWNER_COUNT: number;
  systemOwnerCount: number;
  userOwnerCount: number;
  genericUserTailCount: number;
  rejectedBCount: number;
  location: "system" | "user" | "both" | "none";
} {
  const systemOwnerCount = countOccurrences(
    opts.system,
    GEMINI37_FLASH_LENGTH_OWNER_TITLE
  );
  const userOwnerCount = countOccurrences(
    opts.lastUser,
    GEMINI37_FLASH_LENGTH_OWNER_TITLE
  );
  const genericUserTailCount = countOccurrences(
    opts.lastUser,
    "한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다"
  );
  const rejectedBCount =
    countOccurrences(opts.system, REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE) +
    countOccurrences(opts.lastUser, REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE);
  const GEMINI37_LENGTH_OWNER_COUNT = systemOwnerCount + userOwnerCount;
  const location =
    systemOwnerCount > 0 && userOwnerCount > 0
      ? "both"
      : systemOwnerCount > 0
        ? "system"
        : userOwnerCount > 0
          ? "user"
          : "none";
  return {
    GEMINI37_LENGTH_OWNER_COUNT,
    systemOwnerCount,
    userOwnerCount,
    genericUserTailCount,
    rejectedBCount,
    location,
  };
}
