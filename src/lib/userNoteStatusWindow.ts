import { USER_NOTE_FOCUS_MAX, validateUserNoteLength } from "@/lib/persona";
import {
  validateStatusWidgetContextBudget,
} from "@/lib/statusWidget/contextBudget";

export { USER_NOTE_MAX, USER_NOTE_FOCUS_MAX, USER_NOTE_REFERENCE_MAX } from "@/lib/persona";

/** Legacy separator — reference zone removed; kept for one-time cleanup reads only. */
export const USER_NOTE_ZONE_SEPARATOR = "\u001E";

const LEGACY_STATUS_BLOCK_RE =
  /<<<USER_STATUS_TEMPLATE>>>\s*[\s\S]*?\s*<<<END USER_STATUS>>>/gi;

/** 유저 노트 본문 (레거시 상태창 블록 제거) */
export function parseUserNoteCombined(raw: string): { body: string; statusTemplate: string } {
  const body = (raw ?? "").replace(LEGACY_STATUS_BLOCK_RE, "");
  return { body, statusTemplate: "" };
}

export function composeUserNoteCombined(body: string, _statusTemplate?: string): string {
  return body.trim();
}

export function userNoteCombinedCharCount(body: string, _statusTemplate?: string): number {
  return body.trim().length;
}

export function resolveUserNoteBodyEditorLimits(
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): {
  statusChars: number;
  maxBodyTotal: number;
  focusBodyMax: number;
  referenceBodyMax: number;
} {
  const reserved = Math.max(0, widgetReservedChars);
  const focusBodyMax = Math.max(1, focusMaxChars);
  return {
    statusChars: reserved,
    maxBodyTotal: focusBodyMax,
    focusBodyMax,
    referenceBodyMax: 0,
  };
}

function stripLegacyReferenceFromBody(body: string, focusBodyMax: number): string {
  const sepIdx = body.indexOf(USER_NOTE_ZONE_SEPARATOR);
  if (sepIdx >= 0) {
    return body.slice(0, sepIdx).slice(0, focusBodyMax);
  }
  return body.slice(0, focusBodyMax);
}

export function splitUserNoteBodyForEditor(
  body: string,
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): {
  focusBody: string;
  referenceBody: string;
  focusBodyMax: number;
  referenceBodyMax: number;
  statusChars: number;
} {
  const limits = resolveUserNoteBodyEditorLimits(widgetReservedChars, focusMaxChars);
  const focusBody = stripLegacyReferenceFromBody(body, limits.focusBodyMax);
  return {
    focusBody,
    referenceBody: "",
    focusBodyMax: limits.focusBodyMax,
    referenceBodyMax: 0,
    statusChars: limits.statusChars,
  };
}

export function userNoteZoneBreakdown(
  body: string,
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): {
  focusChars: number;
  referenceChars: number;
} {
  const { focusBody } = splitUserNoteBodyForEditor(body, widgetReservedChars, focusMaxChars);
  return { focusChars: focusBody.length, referenceChars: 0 };
}

export function capUserNoteBody(
  body: string,
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): string {
  return splitUserNoteBodyForEditor(body, widgetReservedChars, focusMaxChars).focusBody;
}

export function mergeUserNoteBodyFromEditor(
  focusBody: string,
  _referenceBody = "",
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): string {
  const { focusBodyMax } = resolveUserNoteBodyEditorLimits(widgetReservedChars, focusMaxChars);
  return focusBody.slice(0, focusBodyMax);
}

export function extractFocusZoneNote(
  fullNote: string,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): string {
  const { body } = parseUserNoteCombined(fullNote);
  return splitUserNoteBodyForEditor(body, 0, focusMaxChars).focusBody;
}

/** Prompt injection cap — stored text may exceed current tier until next save. */
export function extractFocusZoneForPrompt(
  fullNote: string,
  focusMaxChars: number
): string {
  return extractFocusZoneNote(fullNote, focusMaxChars).slice(0, focusMaxChars);
}

/** @deprecated Reference zone removed — always returns empty string. */
export function getReferenceBodyFromNote(_fullNote: string): string {
  return "";
}

export function isFocusZoneEmpty(fullNote: string): boolean {
  return !extractFocusZoneNote(fullNote).trim();
}

export function mergePresetFocusIntoChatNote(presetFocusNote: string, chatFullNote: string): string {
  return extractFocusZoneNote(presetFocusNote);
}

export function replaceFocusZoneInNote(_fullNote: string, focusZoneNote: string): string {
  return extractFocusZoneNote(focusZoneNote);
}

export function validateUserNoteFocusPreset(
  raw: string,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): { ok: true } | { ok: false; error: string } {
  const len = userNoteCombinedCharCount(extractFocusZoneNote(raw, focusMaxChars));
  if (len > focusMaxChars) {
    return {
      ok: false,
      error: `보관함(고집중 구간)은 ${focusMaxChars.toLocaleString()}자 이하여야 합니다.`,
    };
  }
  return validateUserNoteLength(len);
}

export function validateUserNoteCombined(
  raw: string,
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): { ok: true } | { ok: false; error: string } {
  const widgetCheck = validateStatusWidgetContextBudget(widgetReservedChars);
  if (!widgetCheck.ok) return widgetCheck;

  const { body } = parseUserNoteCombined(raw);
  const focusBody = stripLegacyReferenceFromBody(body, focusMaxChars);
  if (focusBody.length > focusMaxChars) {
    return {
      ok: false,
      error: `고집중 구간은 ${focusMaxChars.toLocaleString()}자 이하여야 합니다. (현재 ${focusBody.length.toLocaleString()}자)`,
    };
  }
  return validateUserNoteLength(focusBody.length);
}

export function userNoteForPrompt(raw: string, focusMaxChars = USER_NOTE_FOCUS_MAX): string {
  return extractFocusZoneForPrompt(raw, focusMaxChars);
}

export function splitUserNotePromptZones(
  raw: string,
  widgetReservedChars = 0,
  focusMaxChars = USER_NOTE_FOCUS_MAX
): { mandatory: string; reference: string } {
  return {
    mandatory: extractFocusZoneForPrompt(raw, focusMaxChars),
    reference: "",
  };
}

export function setUserNoteBody(_raw: string, body: string): string {
  return body.trim();
}
