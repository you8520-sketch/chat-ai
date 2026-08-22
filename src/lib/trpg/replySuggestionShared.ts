import type { TrpgVisibleActionType } from "./actionTypes";

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
