import type { TrpgVisibleActionType } from "./actionTypes";

export const TRPG_REPLY_SUGGESTION_USER_ERROR =
  "행동 예시를 불러오지 못했습니다. 직접 입력하거나 다시 시도해 주세요.";

const TRPG_REPLY_SUGGESTION_BUSINESS_ERRORS = new Set([
  "이미 행동 예시를 만들고 있습니다.",
  "잠시 후 다시 시도하세요.",
  "캠페인을 찾을 수 없습니다.",
  "이 캠페인의 참가자가 아닙니다.",
  "지금은 행동할 수 없습니다.",
  "지금은 행동 예시를 받을 수 없습니다.",
  "이미 제출했습니다.",
  "잘못된 캠페인입니다.",
]);

const TRPG_REPLY_SUGGESTION_INTERNAL_ERROR_RE =
  /\[TRPG reply\]|completion deadline exceeded|body completion deadline exceeded|headers deadline exceeded|header deadline exceeded|unusable backup completion|malformed_json|malformed backup provider response envelope|malformed provider response|NO_OPENROUTER_KEY|NO_CHEAPER_INFERENCE_KEY|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network error|CheaperInference backup failed/i;

export function isTrpgReplySuggestionInternalProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message.trim();
  if (!message) return true;
  if (TRPG_REPLY_SUGGESTION_BUSINESS_ERRORS.has(message)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return TRPG_REPLY_SUGGESTION_INTERNAL_ERROR_RE.test(message);
}

export function normalizeTrpgReplySuggestionClientError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && TRPG_REPLY_SUGGESTION_BUSINESS_ERRORS.has(message)) return message;
  }
  if (isTrpgReplySuggestionInternalProviderError(error)) {
    return TRPG_REPLY_SUGGESTION_USER_ERROR;
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return TRPG_REPLY_SUGGESTION_USER_ERROR;
}

export const TRPG_INPUT_ORIGINS = ["manual", "reply_suggestion"] as const;
export type TrpgInputOrigin = (typeof TRPG_INPUT_ORIGINS)[number];

export const TRPG_REPLY_STANCES = ["good", "neutral", "evil"] as const;
export type TrpgReplyStance = (typeof TRPG_REPLY_STANCES)[number];

const REPLY_STANCE_ALIASES: Record<string, TrpgReplyStance> = {
  good: "good",
  neutral: "neutral",
  evil: "evil",
  선의: "good",
  중립: "neutral",
  악의: "evil",
};

export function isTrpgReplyStance(value: string): value is TrpgReplyStance {
  return (TRPG_REPLY_STANCES as readonly string[]).includes(value);
}

export function replyStanceLabelKo(stance: TrpgReplyStance): string {
  switch (stance) {
    case "good":
      return "선의";
    case "neutral":
      return "중립";
    case "evil":
      return "악의";
    default: {
      const _exhaustive: never = stance;
      return _exhaustive;
    }
  }
}

export function normalizeTrpgReplyStance(value: unknown): TrpgReplyStance | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (isTrpgReplyStance(lower)) return lower;
  return REPLY_STANCE_ALIASES[trimmed] ?? REPLY_STANCE_ALIASES[lower] ?? null;
}

export type TrpgReplySuggestion = {
  stance: TrpgReplyStance;
  actionType: TrpgVisibleActionType;
  text: string;
  stage: string;
  speech: string;
};

export function parseTrpgInputOrigin(value: unknown): TrpgInputOrigin {
  return value === "reply_suggestion" ? "reply_suggestion" : "manual";
}

/** Click a suggestion: fill the composer only. Never submit, roll, or call GM. */
export function applyReplySuggestionClick(item: TrpgReplySuggestion): {
  actionType: TrpgVisibleActionType;
  actionBody: string;
  inputOrigin: "reply_suggestion";
  autoSubmit: false;
} {
  return {
    actionType: item.actionType,
    actionBody: item.text,
    inputOrigin: "reply_suggestion",
    autoSubmit: false,
  };
}
