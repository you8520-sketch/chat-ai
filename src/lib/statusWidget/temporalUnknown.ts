/**
 * Unknown-like temporal value detection + field classification.
 * Calendar/clock/season/weather always reject unknown-like values.
 * Counters reject only when instruction/initialValue require a concrete number/D±N.
 */
import { fieldPlaceholderKey, normalizeStatusWidgetLookupKey } from "./fieldKeys";
import type {
  ParsedStatusWidgetTurnValues,
  StatusWidget,
  StatusWidgetField,
  StatusWidgetValues,
} from "./types";

export type StatusWidgetTemporalKind =
  | "date"
  | "clock"
  | "timezone"
  | "season"
  | "weather"
  | "season_weather"
  | "counter";

export type TemporalUnknownDiagCode =
  | "TEMPORAL_UNKNOWN_PREVIOUS"
  | "TEMPORAL_UNKNOWN_RAW"
  | "TEMPORAL_ANCHOR_FIELD_SKIPPED"
  | "TEMPORAL_REPAIR_USED"
  | "TEMPORAL_REPAIR_FAILED";

const UNKNOWN_LIKE_EXACT = new Set(
  [
    "알 수 없음",
    "알수없음",
    "알 수 없다",
    "알수없다",
    "모름",
    "미상",
    "정보 없음",
    "정보없음",
    "확인 불가",
    "확인불가",
    "불명",
    "미정",
    "unknown",
    "n/a",
    "na",
    "not available",
    "unavailable",
    "unspecified",
    "undetermined",
  ].map((s) => s.toLowerCase())
);

export function normalizeUnknownComparable(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。]+$/g, "")
    .toLowerCase();
}

/** True for concrete unknown placeholders (not free-text that merely mentions 모름). */
export function isUnknownLikeStatusValue(value: string): boolean {
  const n = normalizeUnknownComparable(value);
  if (!n) return false;
  if (UNKNOWN_LIKE_EXACT.has(n)) return true;
  const compact = n.replace(/\s+/g, "");
  if (UNKNOWN_LIKE_EXACT.has(compact)) return true;
  return false;
}

export function classifyStatusWidgetTemporalField(
  field: StatusWidgetField
): StatusWidgetTemporalKind | null {
  const blob = `${field.id} ${field.label} ${field.instruction} ${field.initialValue ?? ""}`;
  const norm = normalizeStatusWidgetLookupKey(blob);

  if (/만난일|만난날|경과일|디데이|dday|countdown|counter|일차/.test(norm)) {
    return "counter";
  }
  if (/시간대|timezone|utc|gmt/.test(norm)) return "timezone";
  if (/계절.*날씨|날씨.*계절|season.*weather|weather.*season/.test(norm)) {
    return "season_weather";
  }
  if (/날씨|weather/.test(norm)) return "weather";
  if (/계절|season/.test(norm)) return "season";
  if (/날짜|date|일자|요일|calendar/.test(norm)) return "date";
  if (/현재시각|시각|clock|hhmm|시분/.test(norm)) return "clock";
  if (/^시간$|시간|time/.test(norm) && !/만난|경과|디데이/.test(norm)) return "clock";
  return null;
}

export function isCalendarClockSeasonWeatherField(field: StatusWidgetField): boolean {
  const kind = classifyStatusWidgetTemporalField(field);
  return (
    kind === "date" ||
    kind === "clock" ||
    kind === "timezone" ||
    kind === "season" ||
    kind === "weather" ||
    kind === "season_weather"
  );
}

export function isCounterTemporalField(field: StatusWidgetField): boolean {
  return classifyStatusWidgetTemporalField(field) === "counter";
}

/** Instruction/initialValue explicitly allows 미정 / undetermined as a normal value. */
export function counterAllowsUnsetPlaceholder(field: StatusWidgetField): boolean {
  const blob = `${field.instruction} ${field.initialValue ?? ""}`;
  return /미정\s*허용|결정\s*전(?:에는)?\s*미정|정해지기\s*전(?:에는)?\s*미정|until\s+(?:decided|set).*undetermined|undetermined\s+allowed|미정으로\s*두/i.test(
    blob
  );
}

/** Counter that must be a concrete number / D±N style value. */
export function counterRequiresConcreteValue(field: StatusWidgetField): boolean {
  if (counterAllowsUnsetPlaceholder(field)) return false;
  const blob = `${field.instruction} ${field.initialValue ?? ""}`;
  return (
    /D\s*[+\-]?\s*\d+|디데이\s*\d+|하루마다\s*1\s*감소|매일\s*1\s*감소|숫자로|정수|countdown|d-\d+/i.test(
      blob
    ) || /^\s*D\s*[+\-]?\s*\d+\s*$/i.test(field.initialValue?.trim() ?? "")
  );
}

/**
 * Whether unknown-like values must be rejected for this field.
 * - calendar/clock/season/weather: always
 * - counter: only when concrete numeric/D±N is required
 */
export function rejectsUnknownLikeTemporalValue(field: StatusWidgetField): boolean {
  const kind = classifyStatusWidgetTemporalField(field);
  if (!kind) return false;
  if (kind === "counter") return counterRequiresConcreteValue(field);
  return true;
}

/** Key-only heuristic when widget schema is unavailable (stored JSON keys). */
export function keyLooksLikeCalendarClockSeasonWeather(key: string): boolean {
  const norm = normalizeStatusWidgetLookupKey(key);
  if (!norm) return false;
  if (/만난일|만난날|경과일|디데이|dday|countdown|counter/.test(norm)) return false;
  return /날짜|date|시각|시간|clock|계절|season|날씨|weather|시간대|timezone/.test(norm);
}

export function keyLooksLikeCounter(key: string): boolean {
  const norm = normalizeStatusWidgetLookupKey(key);
  return /만난일|만난날|경과일|디데이|dday|countdown|counter/.test(norm);
}

export function stripUnknownLikeFromValues(
  values: StatusWidgetValues | null | undefined,
  widget?: StatusWidget | null
): {
  values: StatusWidgetValues | null;
  skippedKeys: string[];
  codes: TemporalUnknownDiagCode[];
} {
  if (!values) return { values: null, skippedKeys: [], codes: [] };
  const out: StatusWidgetValues = {};
  const skippedKeys: string[] = [];
  const codes: TemporalUnknownDiagCode[] = [];

  const fields = widget?.fields ?? [];
  const fieldByKey = new Map<string, StatusWidgetField>();
  for (const field of fields) {
    const key = fieldPlaceholderKey(field);
    if (key) fieldByKey.set(key, field);
    if (field.id) fieldByKey.set(field.id, field);
    fieldByKey.set(field.label, field);
  }

  for (const [key, raw] of Object.entries(values)) {
    const value = raw?.trim() ?? "";
    if (!value) continue;
    const field = fieldByKey.get(key);
    let reject = false;
    if (field) {
      reject = rejectsUnknownLikeTemporalValue(field) && isUnknownLikeStatusValue(value);
    } else if (keyLooksLikeCalendarClockSeasonWeather(key)) {
      reject = isUnknownLikeStatusValue(value);
    } else if (keyLooksLikeCounter(key)) {
      // Without field schema, keep counter unknown-like (may be intentional 미정).
      reject = false;
    }
    if (reject) {
      skippedKeys.push(key);
      codes.push("TEMPORAL_ANCHOR_FIELD_SKIPPED");
      continue;
    }
    out[key] = value;
  }

  return {
    values: Object.keys(out).length > 0 ? out : null,
    skippedKeys,
    codes,
  };
}

export function stripUnknownLikeTemporalFromParsed(
  parsed: ParsedStatusWidgetTurnValues | null | undefined,
  widgets?: { characterWidget?: StatusWidget | null; userWidget?: StatusWidget | null }
): {
  values: ParsedStatusWidgetTurnValues | null;
  skippedKeys: string[];
  codes: TemporalUnknownDiagCode[];
} {
  if (!parsed) return { values: null, skippedKeys: [], codes: [] };
  const char = stripUnknownLikeFromValues(parsed.character, widgets?.characterWidget);
  const user = stripUnknownLikeFromValues(parsed.user, widgets?.userWidget);
  const skippedKeys = [...char.skippedKeys, ...user.skippedKeys];
  const codes = [...char.codes, ...user.codes];
  if (skippedKeys.length > 0 && !codes.includes("TEMPORAL_UNKNOWN_PREVIOUS")) {
    codes.unshift("TEMPORAL_UNKNOWN_PREVIOUS");
  }
  const values: ParsedStatusWidgetTurnValues = {
    character: char.values,
    user: user.values,
    ...(parsed.extracted_facts ? { extracted_facts: parsed.extracted_facts } : {}),
  };
  if (!values.character && !values.user && !(values.extracted_facts?.length)) {
    return { values: null, skippedKeys, codes };
  }
  return { values, skippedKeys, codes };
}

/**
 * After V3 normalize: drop rejected unknown-like temporal values.
 * Repair from initialValue only for keys that were unknown-like (not merely absent).
 */
export function sanitizeAndRepairTemporalValues(
  values: StatusWidgetValues | null | undefined,
  widget: StatusWidget | null | undefined
): {
  values: StatusWidgetValues | null;
  droppedUnknownKeys: string[];
  repairedKeys: string[];
  codes: TemporalUnknownDiagCode[];
} {
  const codes: TemporalUnknownDiagCode[] = [];
  const droppedUnknownKeys: string[] = [];
  const repairedKeys: string[] = [];
  if (!values) return { values: null, droppedUnknownKeys, repairedKeys, codes };

  const out: StatusWidgetValues = { ...values };

  if (!widget?.fields?.length) {
    for (const [key, raw] of Object.entries(out)) {
      if (keyLooksLikeCalendarClockSeasonWeather(key) && isUnknownLikeStatusValue(raw)) {
        delete out[key];
        droppedUnknownKeys.push(key);
        codes.push("TEMPORAL_UNKNOWN_RAW");
      }
    }
    return {
      values: Object.keys(out).length > 0 ? out : null,
      droppedUnknownKeys,
      repairedKeys,
      codes,
    };
  }

  for (const field of widget.fields) {
    if (!rejectsUnknownLikeTemporalValue(field)) continue;
    const key = fieldPlaceholderKey(field);
    if (!key) continue;
    const raw = out[key] ?? (field.id ? out[field.id] : undefined);
    if (raw == null) continue;
    if (!isUnknownLikeStatusValue(raw)) continue;

    delete out[key];
    if (field.id && field.id !== key) delete out[field.id];
    droppedUnknownKeys.push(key);
    codes.push("TEMPORAL_UNKNOWN_RAW");

    const initial = field.initialValue?.trim();
    if (initial && !isUnknownLikeStatusValue(initial)) {
      out[key] = initial;
      if (field.id && field.id !== key) out[field.id] = initial;
      repairedKeys.push(key);
      codes.push("TEMPORAL_REPAIR_USED");
    } else if (isCalendarClockSeasonWeatherField(field)) {
      codes.push("TEMPORAL_REPAIR_FAILED");
    }
  }

  return {
    values: Object.keys(out).length > 0 ? out : null,
    droppedUnknownKeys,
    repairedKeys,
    codes,
  };
}
