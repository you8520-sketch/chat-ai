import { estimateTokens } from "@/lib/tokenEstimate";

import { USER_NOTE_FOCUS_MAX, USER_NOTE_MAX, USER_NOTE_REFERENCE_MAX } from "@/lib/persona";

import { parseStatusWidgetJson } from "./serialize";

import { resolveStatusWidgetTurn } from "./resolve";

import type { StatusWidget } from "./types";

/** 위젯 상태값·지시 토큰 환산 상한 (HTML 제외) */
export const STATUS_WIDGET_CONTEXT_MAX = 500;

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

export function resolveStatusWidgetReservedChars(opts: {
  characterWidgetJson?: string | null;
  chatMode?: string | null;
  userWidgetJson?: string | null;
  stackOrder?: string | null;
  characterAllowUserOverride?: boolean;
  displayMode?: string | null;
}): number {
  const resolved = resolveStatusWidgetTurn(opts);
  if (!resolved.active) return 0;

  let total = 0;
  if (resolved.needsCharacterValues && resolved.characterWidget) {
    total += estimateStatusWidgetContextChars(resolved.characterWidget);
  }
  if (resolved.needsUserValues && resolved.userWidget) {
    total += estimateStatusWidgetContextChars(resolved.userWidget);
  }
  return total;
}

export function validateStatusWidgetContextBudget(
  reservedChars: number
): { ok: true } | { ok: false; error: string } {
  const reserved = Math.max(0, reservedChars);
  if (reserved > STATUS_WIDGET_CONTEXT_MAX) {
    return {
      ok: false,
      error: `위젯 상태값·지시(${reserved.toLocaleString()}자, 토큰 환산)가 한도 ${STATUS_WIDGET_CONTEXT_MAX.toLocaleString()}자를 초과합니다. HTML은 제외됩니다.`,
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
