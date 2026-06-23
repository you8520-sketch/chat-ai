import { USER_NOTE_MAX, USER_NOTE_FOCUS_MAX, validateUserNoteLength } from "@/lib/persona";
import {
  effectiveUserNoteBodyMax,
  effectiveUserNoteFocusMax,
  validateStatusWidgetContextBudget,
} from "@/lib/statusWidget/contextBudget";

export { USER_NOTE_MAX, USER_NOTE_FOCUS_MAX, USER_NOTE_REFERENCE_MAX } from "@/lib/persona";

const LEGACY_STATUS_BLOCK_RE =
  /<<<USER_STATUS_TEMPLATE>>>\s*[\s\S]*?\s*<<<END USER_STATUS>>>/gi;

/** 유저 노트 본문 (레거시 상태창 블록 제거) */
export function parseUserNoteCombined(raw: string): { body: string; statusTemplate: string } {
  const body = (raw ?? "").replace(LEGACY_STATUS_BLOCK_RE, "").trim();
  return { body, statusTemplate: "" };
}

export function composeUserNoteCombined(body: string, _statusTemplate?: string): string {
  return body.trim();
}

export function userNoteCombinedCharCount(body: string, _statusTemplate?: string): number {
  return body.trim().length;
}

export function userNoteZoneBreakdown(
  combinedChars: number,
  widgetReservedChars = 0
): {
  focusChars: number;
  referenceChars: number;
} {
  const total = Math.max(0, combinedChars);
  const focusCap = effectiveUserNoteFocusMax(widgetReservedChars);
  const focusChars = Math.min(total, focusCap);
  const referenceChars = Math.max(0, total - focusCap);
  return { focusChars, referenceChars };
}

export function capUserNoteBody(body: string, widgetReservedChars = 0): string {
  return body.slice(0, effectiveUserNoteBodyMax(widgetReservedChars));
}

export function resolveUserNoteBodyEditorLimits(widgetReservedChars = 0): {
  statusChars: number;
  maxBodyTotal: number;
  focusBodyMax: number;
  referenceBodyMax: number;
} {
  const reserved = Math.max(0, widgetReservedChars);
  const focusBodyMax = effectiveUserNoteFocusMax();
  const referenceBodyMax = USER_NOTE_MAX - USER_NOTE_FOCUS_MAX;
  const maxBodyTotal = effectiveUserNoteBodyMax();
  return { statusChars: reserved, maxBodyTotal, focusBodyMax, referenceBodyMax };
}

export function splitUserNoteBodyForEditor(body: string, widgetReservedChars = 0): {
  focusBody: string;
  referenceBody: string;
  focusBodyMax: number;
  referenceBodyMax: number;
  statusChars: number;
} {
  const { focusBodyMax, referenceBodyMax, statusChars } =
    resolveUserNoteBodyEditorLimits(widgetReservedChars);

  if (body.length <= focusBodyMax) {
    return {
      focusBody: body.slice(0, focusBodyMax),
      referenceBody: "",
      focusBodyMax,
      referenceBodyMax,
      statusChars,
    };
  }

  return {
    focusBody: body.slice(0, focusBodyMax),
    referenceBody: body.slice(focusBodyMax, focusBodyMax + referenceBodyMax),
    focusBodyMax,
    referenceBodyMax,
    statusChars,
  };
}

export function mergeUserNoteBodyFromEditor(
  focusBody: string,
  referenceBody: string,
  widgetReservedChars = 0
): string {
  const { focusBodyMax, referenceBodyMax } = resolveUserNoteBodyEditorLimits(widgetReservedChars);
  return (focusBody.slice(0, focusBodyMax) + referenceBody.slice(0, referenceBodyMax)).trim();
}

export function extractFocusZoneNote(fullNote: string): string {
  const { body } = parseUserNoteCombined(fullNote);
  return splitUserNoteBodyForEditor(body).focusBody;
}

export function getReferenceBodyFromNote(fullNote: string): string {
  const { body } = parseUserNoteCombined(fullNote);
  return splitUserNoteBodyForEditor(body).referenceBody;
}

export function isFocusZoneEmpty(fullNote: string): boolean {
  const { body } = parseUserNoteCombined(extractFocusZoneNote(fullNote));
  return !body.trim();
}

export function mergePresetFocusIntoChatNote(presetFocusNote: string, chatFullNote: string): string {
  const preset = parseUserNoteCombined(extractFocusZoneNote(presetFocusNote));
  const chat = parseUserNoteCombined(chatFullNote);
  const { focusBody } = splitUserNoteBodyForEditor(preset.body);
  const { referenceBody } = splitUserNoteBodyForEditor(chat.body);
  return mergeUserNoteBodyFromEditor(focusBody, referenceBody);
}

export function replaceFocusZoneInNote(fullNote: string, focusZoneNote: string): string {
  const chat = parseUserNoteCombined(fullNote);
  const preset = parseUserNoteCombined(extractFocusZoneNote(focusZoneNote));
  const { focusBody } = splitUserNoteBodyForEditor(preset.body);
  const { referenceBody } = splitUserNoteBodyForEditor(chat.body);
  return mergeUserNoteBodyFromEditor(focusBody, referenceBody);
}

export function validateUserNoteFocusPreset(raw: string): { ok: true } | { ok: false; error: string } {
  const { body } = parseUserNoteCombined(extractFocusZoneNote(raw));
  const len = userNoteCombinedCharCount(body);
  if (len > USER_NOTE_FOCUS_MAX) {
    return {
      ok: false,
      error: `보관함(고집중 구간)은 ${USER_NOTE_FOCUS_MAX.toLocaleString()}자 이하여야 합니다.`,
    };
  }
  return validateUserNoteLength(len);
}

export function validateUserNoteCombined(
  raw: string,
  widgetReservedChars = 0
): { ok: true } | { ok: false; error: string } {
  const widgetCheck = validateStatusWidgetContextBudget(widgetReservedChars);
  if (!widgetCheck.ok) return widgetCheck;

  const { body } = parseUserNoteCombined(raw);
  const bodyChars = userNoteCombinedCharCount(body);
  const { focusBody } = splitUserNoteBodyForEditor(body, widgetReservedChars);
  if (focusBody.length > USER_NOTE_FOCUS_MAX) {
    return {
      ok: false,
      error: `고집중 구간은 ${USER_NOTE_FOCUS_MAX.toLocaleString()}자 이하여야 합니다. (현재 ${focusBody.length.toLocaleString()}자)`,
    };
  }
  if (bodyChars > effectiveUserNoteBodyMax()) {
    return validateUserNoteLength(bodyChars);
  }
  return { ok: true };
}

export function userNoteForPrompt(raw: string): string {
  return parseUserNoteCombined(raw).body.trim();
}

export function splitUserNotePromptZones(raw: string): { mandatory: string; reference: string } {
  const bodyTrim = parseUserNoteCombined(raw).body.trim();
  if (!bodyTrim) return { mandatory: "", reference: "" };
  if (bodyTrim.length <= USER_NOTE_FOCUS_MAX) {
    return { mandatory: bodyTrim, reference: "" };
  }
  return {
    mandatory: bodyTrim.slice(0, USER_NOTE_FOCUS_MAX),
    reference: bodyTrim.slice(USER_NOTE_FOCUS_MAX).trim(),
  };
}

export function setUserNoteBody(raw: string, body: string): string {
  return body.trim();
}
