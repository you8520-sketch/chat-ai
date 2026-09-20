import { USER_NOTE_FOCUS_MAX, validateUserNoteLength } from "@/lib/persona";
import { validateStatusWidgetContextBudget } from "@/lib/statusWidget/contextBudget";

export { USER_NOTE_FOCUS_MAX } from "@/lib/persona";

/** Legacy separator — only for reading pre-cleanup stored notes (reference suffix strip). */
export const USER_NOTE_ZONE_SEPARATOR = "\u001E";

const LEGACY_STATUS_BLOCK_RE =
  /<<<USER_STATUS_TEMPLATE>>>\s*[\s\S]*?\s*<<<END USER_STATUS>>>/gi;

/** 유저 노트 본문 (레거시 상태창 블록 제거) */
export function parseUserNoteCombined(raw: string): { body: string; statusTemplate: string } {
  const body = (raw ?? "").replace(LEGACY_STATUS_BLOCK_RE, "");
  return { body, statusTemplate: "" };
}

export function composeUserNoteCombined(body: string, _statusTemplate?: string): string {
  return body;
}

export function userNoteCombinedCharCount(body: string, _statusTemplate?: string): number {
  return body.length;
}

export function resolveUserNoteBodyEditorLimits(
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): {
  statusChars: number;
  maxBodyTotal: number;
  focusBodyMax: number;
} {
  const reserved = Math.max(0, widgetReservedChars);
  const focusBodyMax = Math.max(1, focusMaxChars);
  return {
    statusChars: reserved,
    maxBodyTotal: focusBodyMax,
    focusBodyMax,
  };
}

function stripLegacyReferenceSuffix(body: string): string {
  const sepIdx = body.indexOf(USER_NOTE_ZONE_SEPARATOR);
  if (sepIdx >= 0) {
    return body.slice(0, sepIdx);
  }
  return body;
}

/** Full stored Focus — no current-tier truncation. */
export function readStoredFocus(raw: string): string {
  const { body } = parseUserNoteCombined(raw);
  return stripLegacyReferenceSuffix(body);
}

/** Current-tier prompt projection only. */
export function resolveEffectiveFocusForPrompt(raw: string, focusMaxChars: number): string {
  return readStoredFocus(raw).slice(0, focusMaxChars);
}

export function splitUserNoteBodyForEditor(
  body: string,
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): {
  focusBody: string;
  focusBodyMax: number;
  statusChars: number;
  storedFocusChars: number;
  overCurrentPlanLimit: boolean;
} {
  const limits = resolveUserNoteBodyEditorLimits(widgetReservedChars, focusMaxChars);
  const focusBody = readStoredFocus(body);
  const storedFocusChars = focusBody.length;
  return {
    focusBody,
    focusBodyMax: limits.focusBodyMax,
    statusChars: limits.statusChars,
    storedFocusChars,
    overCurrentPlanLimit: storedFocusChars > limits.focusBodyMax,
  };
}

export function userNoteZoneBreakdown(
  body: string,
  _widgetReservedChars = 0,
  _focusMaxChars = USER_NOTE_FOCUS_MAX
): {
  focusChars: number;
} {
  const stored = readStoredFocus(body);
  return { focusChars: stored.length };
}

export function mergeUserNoteBodyFromEditor(focusBody: string): string {
  return focusBody;
}

/** @deprecated Use readStoredFocus for stored reads. */
export function extractFocusZoneNote(fullNote: string, _focusMaxChars?: number): string {
  return readStoredFocus(fullNote);
}

/** @deprecated Use resolveEffectiveFocusForPrompt. */
export function extractFocusZoneForPrompt(fullNote: string, focusMaxChars: number): string {
  return resolveEffectiveFocusForPrompt(fullNote, focusMaxChars);
}

export function isFocusZoneEmpty(fullNote: string): boolean {
  return !readStoredFocus(fullNote).trim();
}

export function mergePresetFocusIntoChatNote(presetFocusNote: string, _chatFullNote: string): string {
  return readStoredFocus(presetFocusNote);
}

export function replaceFocusZoneInNote(_fullNote: string, focusZoneNote: string): string {
  return readStoredFocus(focusZoneNote);
}

export function validateFocusInput(
  raw: string,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): { ok: true } | { ok: false; error: string } {
  const storedLen = readStoredFocus(raw).length;
  if (storedLen > focusMaxChars) {
    return {
      ok: false,
      error: `고집중 구간은 ${focusMaxChars.toLocaleString()}자 이하여야 합니다. (현재 ${storedLen.toLocaleString()}자)`,
    };
  }
  return validateUserNoteLength(storedLen);
}

export function validateUserNoteFocusPreset(
  raw: string,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): { ok: true } | { ok: false; error: string } {
  const check = validateFocusInput(raw, focusMaxChars);
  if (!check.ok) {
    return {
      ok: false,
      error: check.error.replace("고집중 구간", "보관함(고집중 구간)"),
    };
  }
  return check;
}

export function validateUserNoteCombined(
  raw: string,
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): { ok: true } | { ok: false; error: string } {
  const widgetCheck = validateStatusWidgetContextBudget(widgetReservedChars);
  if (!widgetCheck.ok) return widgetCheck;
  return validateFocusInput(raw, focusMaxChars);
}

export function userNoteForPrompt(raw: string, focusMaxChars = USER_NOTE_FOCUS_MAX): string {
  return resolveEffectiveFocusForPrompt(raw, focusMaxChars);
}

export function splitUserNotePromptZones(
  raw: string,
  _widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): { mandatory: string } {
  return {
    mandatory: resolveEffectiveFocusForPrompt(raw, focusMaxChars),
  };
}

export function setUserNoteBody(_raw: string, body: string): string {
  return body;
}
