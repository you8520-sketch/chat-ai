import { estimateTokens } from "@/lib/tokenEstimate";

import { USER_NOTE_FOCUS_MAX, USER_NOTE_MAX, USER_NOTE_REFERENCE_MAX } from "@/lib/persona";

import { parseStatusWidgetJson } from "./serialize";

import { resolveStatusWidgetTurn } from "./resolve";

import type { StatusWidget } from "./types";

/** 위젯 1개당 상태값·지시 토큰 환산 상한 (HTML 제외) */
export const STATUS_WIDGET_CONTEXT_MAX = 500;
/** 제작자 위젯 + 유저 위젯을 함께 쓸 때의 합산 상한 */
export const STATUS_WIDGET_CONTEXT_COMBINED_MAX = STATUS_WIDGET_CONTEXT_MAX * 2;

export type StatusWidgetContextBudgetBreakdown = {
  characterReservedChars: number;
  userReservedChars: number;
  totalReservedChars: number;
};

/**
 * 유저노트 예산 차감 대상 — 케이브덕과 동일하게 상태값(라벨) + 지시사항만.
 * htmlTemplate(③ 위젯 콘텐츠)은 AI 프롬프트·출력에 포함되지 않으므로 제외.
 */
export function billableStatusWidgetText(widget: StatusWidget): string {
  return widget.fields
    .map((f) => {
      const name = f.label.trim() || f.id.trim();
      const instruction = f.instruction.trim();
      if (!name && !instruction) return "";
      return instruction ? `${name}\n${instruction}` : name;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Token-equivalent chars for widget field spec (estimateTokens). */
export function estimateStatusWidgetContextChars(widget: StatusWidget | null): number {
  if (!widget) return 0;
  const text = billableStatusWidgetText(widget);
  if (!text.trim()) return 0;
  return estimateTokens(text);
}

export function estimateStatusWidgetContextCharsFromJson(
  widgetJson: string | null | undefined
): number {
  return estimateStatusWidgetContextChars(parseStatusWidgetJson(widgetJson));
}

export function resolveStatusWidgetReservedBreakdown(opts: {
  characterWidgetJson?: string | null;
  chatMode?: string | null;
  userWidgetJson?: string | null;
  stackOrder?: string | null;
  characterAllowUserOverride?: boolean;
  displayMode?: string | null;
}): StatusWidgetContextBudgetBreakdown {
  const resolved = resolveStatusWidgetTurn(opts);
  if (!resolved.active) {
    return { characterReservedChars: 0, userReservedChars: 0, totalReservedChars: 0 };
  }

  const characterReservedChars =
    resolved.needsCharacterValues && resolved.characterWidget
      ? estimateStatusWidgetContextChars(resolved.characterWidget)
      : 0;
  const userReservedChars =
    resolved.needsUserValues && resolved.userWidget
      ? estimateStatusWidgetContextChars(resolved.userWidget)
      : 0;

  return {
    characterReservedChars,
    userReservedChars,
    totalReservedChars: characterReservedChars + userReservedChars,
  };
}

export function resolveStatusWidgetReservedChars(opts: {
  characterWidgetJson?: string | null;
  chatMode?: string | null;
  userWidgetJson?: string | null;
  stackOrder?: string | null;
  characterAllowUserOverride?: boolean;
  displayMode?: string | null;
}): number {
  return resolveStatusWidgetReservedBreakdown(opts).totalReservedChars;
}

export function validateStatusWidgetContextBudget(
  reserved: number | StatusWidgetContextBudgetBreakdown
): { ok: true } | { ok: false; error: string } {
  const breakdown =
    typeof reserved === "number"
      ? {
          // Legacy callers only know the combined total, so validate the combined 1,000자 cap.
          characterReservedChars: 0,
          userReservedChars: 0,
          totalReservedChars: Math.max(0, reserved),
        }
      : {
          characterReservedChars: Math.max(0, reserved.characterReservedChars),
          userReservedChars: Math.max(0, reserved.userReservedChars),
          totalReservedChars: Math.max(0, reserved.totalReservedChars),
        };

  const overLimit = [
    ["제작자 위젯", breakdown.characterReservedChars] as const,
    ["유저 위젯", breakdown.userReservedChars] as const,
  ].find(([, chars]) => chars > STATUS_WIDGET_CONTEXT_MAX);

  if (overLimit) {
    const [label, chars] = overLimit;
    return {
      ok: false,
      error: `${label} 상태값·지시(${chars.toLocaleString()}자, 토큰 환산)가 개별 한도 ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자를 초과합니다. HTML은 제외됩니다.`,
    };
  }

  if (breakdown.totalReservedChars > STATUS_WIDGET_CONTEXT_COMBINED_MAX) {
    return {
      ok: false,
      error: `위젯 상태값·지시 합계(${breakdown.totalReservedChars.toLocaleString()}자, 토큰 환산)가 한도 ${STATUS_WIDGET_CONTEXT_COMBINED_MAX.toLocaleString()}자를 초과합니다. HTML은 제외됩니다.`,
    };
  }
  return { ok: true };
}

/** 고집중 구간 — 위젯과 분리, 항상 1,000자 */
export function effectiveUserNoteFocusMax(_widgetReservedChars = 0): number {
  return USER_NOTE_FOCUS_MAX;
}

export function effectiveUserNoteBodyMax(_widgetReservedChars = 0): number {
  return USER_NOTE_MAX;
}

export function formatWidgetBudgetHint(widgetReservedChars: number): string {
  const reserved = Math.max(0, widgetReservedChars);
  if (reserved <= 0) {
    return `위젯 상태값·지시 한도 ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자`;
  }
  return `위젯 상태값·지시 ${reserved.toLocaleString()} / ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자`;
}

export function formatCombinedWidgetBudgetHint(
  breakdown: StatusWidgetContextBudgetBreakdown
): string {
  const character = Math.max(0, breakdown.characterReservedChars);
  const user = Math.max(0, breakdown.userReservedChars);
  const total = Math.max(0, breakdown.totalReservedChars);
  if (total <= 0) {
    return `위젯 상태값·지시 한도: 제작자 ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자 + 유저 ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자`;
  }
  if (character > 0 && user > 0) {
    return `위젯 상태값·지시 제작자 ${character.toLocaleString()} / ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자 · 유저 ${user.toLocaleString()} / ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자`;
  }
  return `위젯 상태값·지시 ${total.toLocaleString()} / ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자`;
}
