import { estimateTokens } from "@/lib/tokenEstimate";

import { USER_NOTE_FOCUS_MAX, USER_NOTE_MAX, USER_NOTE_REFERENCE_MAX } from "@/lib/persona";

import { parseStatusWidgetJson } from "./serialize";

import { resolveStatusWidgetTurn } from "./resolve";

import type { StatusWidget } from "./types";

/** Creator field/instruction budget in estimateTokens units. HTML and JSX source are excluded. */
export const STATUS_WIDGET_CONTEXT_MAX = 600;
/** User persona widget uses the same estimateTokens cap as the creator widget. */
export const STATUS_WIDGET_USER_CONTEXT_MAX = 600;
/** 제작자 + 사용자 위젯이 모두 활성일 때만 각 상한을 더한다. */
export const STATUS_WIDGET_CONTEXT_COMBINED_MAX =
  STATUS_WIDGET_CONTEXT_MAX + STATUS_WIDGET_USER_CONTEXT_MAX;

export type StatusWidgetContextBudgetBreakdown = {
  characterReservedChars: number;
  userReservedChars: number;
  totalReservedChars: number;
};

/**
 * 유저노트 예산 차감 대상 — 케이브덕과 동일하게 상태값(라벨) + 지시사항(+선택 초기값).
 * htmlTemplate(③ 위젯 콘텐츠)은 AI 프롬프트·출력에 포함되지 않으므로 제외.
 */
export function billableStatusWidgetText(widget: StatusWidget): string {
  return widget.fields
    .map((f) => {
      const name = f.label.trim() || f.id.trim();
      const instruction = f.instruction.trim();
      const initial = f.initialValue?.trim() ?? "";
      if (!name && !instruction && !initial) return "";
      const parts = [name, instruction, initial ? `initialValue: ${initial}` : ""]
        .filter(Boolean)
        .join("\n");
      return parts;
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

/** Creator writes use the same field-spec budget as the creator meter. */
export function validateCharacterStatusWidgetContextBudget(widget: StatusWidget | null) {
  const reserved = estimateStatusWidgetContextChars(widget);
  return validateStatusWidgetContextBudget({
    characterReservedChars: reserved,
    userReservedChars: 0,
    totalReservedChars: reserved,
  });
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
          // Legacy callers only know the combined total; validate the summed cap.
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
    ["제작자 위젯", breakdown.characterReservedChars, STATUS_WIDGET_CONTEXT_MAX] as const,
    ["유저 위젯", breakdown.userReservedChars, STATUS_WIDGET_USER_CONTEXT_MAX] as const,
  ].find(([, chars, limit]) => chars > limit);

  if (overLimit) {
    const [label, chars, limit] = overLimit;
    return {
      ok: false,
      error: `${label} 상태값·지시 추정 토큰 ${chars.toLocaleString()}이 개별 한도 ${limit.toLocaleString()}을 초과합니다. HTML과 JSX 소스는 제외됩니다.`,
    };
  }

  if (breakdown.totalReservedChars > STATUS_WIDGET_CONTEXT_COMBINED_MAX) {
    return {
      ok: false,
      error: `위젯 상태값·지시 합계 추정 토큰 ${breakdown.totalReservedChars.toLocaleString()}이 한도 ${STATUS_WIDGET_CONTEXT_COMBINED_MAX.toLocaleString()}을 초과합니다. HTML과 JSX 소스는 제외됩니다.`,
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

export function formatWidgetBudgetHint(
  widgetReservedChars: number,
  limit: number = STATUS_WIDGET_CONTEXT_MAX
): string {
  const reserved = Math.max(0, widgetReservedChars);
  const over =
    reserved > limit ? " 한도를 초과했습니다. 상태값·지시를 줄인 뒤 다시 저장하세요." : "";
  if (reserved <= 0) {
    return `위젯 상태값·지시 추정 토큰 한도 ${limit.toLocaleString()}${over}`;
  }
  return `위젯 상태값·지시 추정 토큰 ${reserved.toLocaleString()} / ${limit.toLocaleString()}${over}`;
}

export function formatCombinedWidgetBudgetHint(
  breakdown: StatusWidgetContextBudgetBreakdown
): string {
  const character = Math.max(0, breakdown.characterReservedChars);
  const user = Math.max(0, breakdown.userReservedChars);
  const total = Math.max(0, breakdown.totalReservedChars);
  if (total <= 0) {
    return `위젯 상태값·지시 추정 토큰 한도: 제작자 ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()} + 유저 ${STATUS_WIDGET_USER_CONTEXT_MAX.toLocaleString()}`;
  }
  if (character > 0 && user > 0) {
    return `위젯 상태값·지시 추정 토큰 제작자 ${character.toLocaleString()} / ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()} · 유저 ${user.toLocaleString()} / ${STATUS_WIDGET_USER_CONTEXT_MAX.toLocaleString()}`;
  }
  const singleLimit = character > 0 ? STATUS_WIDGET_CONTEXT_MAX : STATUS_WIDGET_USER_CONTEXT_MAX;
  return `위젯 상태값·지시 추정 토큰 ${total.toLocaleString()} / ${singleLimit.toLocaleString()}`;
}
