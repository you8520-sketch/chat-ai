import { USER_NOTE_MAX, USER_NOTE_FOCUS_MAX, validateUserNoteLength } from "@/lib/persona";
import {
  effectiveUserNoteBodyMax,
  effectiveUserNoteFocusMax,
  validateStatusWidgetContextBudget,
} from "@/lib/statusWidget/contextBudget";

export { USER_NOTE_MAX, USER_NOTE_FOCUS_MAX, USER_NOTE_REFERENCE_MAX } from "@/lib/persona";

/** 고집중 ↔ 확장구간 경계 (DB 단일 필드 저장용 — UI 칸 구분) */
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

export function userNoteZoneBreakdown(
  body: string,
  widgetReservedChars = 0
): {
  focusChars: number;
  referenceChars: number;
} {
  const { focusBody, referenceBody } = splitUserNoteBodyForEditor(body, widgetReservedChars);
  return { focusChars: focusBody.length, referenceChars: referenceBody.length };
}

export function capUserNoteBody(body: string, widgetReservedChars = 0): string {
  const { focusBody, referenceBody } = splitUserNoteBodyForEditor(body, widgetReservedChars);
  return mergeUserNoteBodyFromEditor(focusBody, referenceBody, widgetReservedChars);
}

function splitUserNoteBodyRaw(
  body: string,
  focusBodyMax: number,
  referenceBodyMax: number
): { focusBody: string; referenceBody: string } {
  const sepIdx = body.indexOf(USER_NOTE_ZONE_SEPARATOR);
  if (sepIdx >= 0) {
    return {
      focusBody: body.slice(0, sepIdx).slice(0, focusBodyMax),
      referenceBody: body.slice(sepIdx + USER_NOTE_ZONE_SEPARATOR.length).slice(0, referenceBodyMax),
    };
  }

  // 레거시: 구분자 없이 이어붙인 저장본 — 총 길이 > 고집중 상한일 때만 위치 분할
  if (body.length <= focusBodyMax) {
    return { focusBody: body.slice(0, focusBodyMax), referenceBody: "" };
  }
  return {
    focusBody: body.slice(0, focusBodyMax),
    referenceBody: body.slice(focusBodyMax, focusBodyMax + referenceBodyMax),
  };
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

  const { focusBody, referenceBody } = splitUserNoteBodyRaw(body, focusBodyMax, referenceBodyMax);
  return {
    focusBody,
    referenceBody,
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
  const focus = focusBody.slice(0, focusBodyMax);
  const reference = referenceBody.slice(0, referenceBodyMax);
  if (!reference.trim()) {
    return focus;
  }
  return focus + USER_NOTE_ZONE_SEPARATOR + reference;
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

export function splitUserNotePromptZones(
  raw: string,
  widgetReservedChars = 0
): { mandatory: string; reference: string } {
  const body = parseUserNoteCombined(raw).body;
  const { focusBody, referenceBody } = splitUserNoteBodyForEditor(body, widgetReservedChars);
  return {
    mandatory: focusBody.trim(),
    reference: referenceBody.trim(),
  };
}

export function setUserNoteBody(raw: string, body: string): string {
  return body.trim();
}
