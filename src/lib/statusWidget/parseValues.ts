import {
  fieldPlaceholderKey,
  normalizeStatusWidgetLookupKey,
  statusWidgetFieldLookupKeys,
} from "./fieldKeys";
import { mergeExtractedFacts, sanitizeExtractedFacts } from "./extractedFacts";
import {
  isUnknownLikeStatusValue,
  rejectsUnknownLikeTemporalValue,
} from "./temporalUnknown";
import type {
  ExtractedStatusFact,
  ParsedStatusWidgetTurnValues,
  StatusWidget,
  StatusWidgetValues,
} from "./types";

export const STATUS_VALUES_BLOCK = "<<<STATUS_VALUES>>>";
export const STATUS_VALUES_CHAR_BLOCK = "<<<STATUS_VALUES char>>>";
export const STATUS_VALUES_USER_BLOCK = "<<<STATUS_VALUES user>>>";
export const STATUS_VALUES_END = "<<<END_STATUS>>>";

const STATUS_VALUES_MARKERS = [
  STATUS_VALUES_CHAR_BLOCK,
  STATUS_VALUES_USER_BLOCK,
  STATUS_VALUES_BLOCK,
] as const;

/** 스트림 중 — END 없는 <<<STATUS_VALUES>>> tail·부분 마커·미완 ```json 제거 */
export function stripIncompleteStatusWidgetTail(text: string): string {
  let work = text.trimEnd();

  for (const marker of STATUS_VALUES_MARKERS) {
    const idx = work.indexOf(marker);
    if (idx < 0) continue;
    const tail = work.slice(idx);
    if (tail.includes(STATUS_VALUES_END)) continue;
    work = work.slice(0, idx).trimEnd();
  }

  const looseMatch = work.match(/<<<STATUS_VALUES(?:\s+[^>]+)?>>>/i);
  if (looseMatch?.index != null) {
    const tail = work.slice(looseMatch.index);
    if (!tail.includes(STATUS_VALUES_END)) {
      work = work.slice(0, looseMatch.index).trimEnd();
    }
  }

  const partialMarker = work.match(/\n?<<<\s*(?:STATUS(?:_VALUES(?:\s+(?:char|user))?)?(?:\s*>>>?)?)?\s*$/i);
  if (partialMarker?.index != null) {
    work = work.slice(0, partialMarker.index).trimEnd();
  }
  work = work.replace(/<<<\s*$/, "").trimEnd();

  const jsonOpen = work.search(/(?:^|\n)```json\b/i);
  if (jsonOpen >= 0) {
    const tail = work.slice(jsonOpen);
    const fenceCount = (tail.match(/```/g) ?? []).length;
    if (fenceCount % 2 !== 0) {
      work = work.slice(0, jsonOpen).trimEnd();
    }
  }

  const bareOpen = work.match(/\n(\{[\s\S]*)$/);
  if (bareOpen?.index != null && bareOpen[1] && !bareOpen[1].trimEnd().endsWith("}")) {
    const frag = bareOpen[1];
    const tailFromBare = work.slice(bareOpen.index);
    if (
      /"(?:시간|장소|속마음|현재|time|place|mood|location)/i.test(frag) &&
      !tailFromBare.includes(STATUS_VALUES_END)
    ) {
      work = work.slice(0, bareOpen.index).trimEnd();
    }
  }

  return work;
}

function stripTrailingStatusWidgetMarkers(text: string): string {
  let work = text.trimEnd();
  const looseMatch = work.match(/<<<STATUS_VALUES(?:\s+[^>]+)?>>>/i);
  if (looseMatch?.index != null) {
    work = work.slice(0, looseMatch.index).trimEnd();
  }
  return work;
}

type ParsedValuesJson = {
  values: StatusWidgetValues | null;
  facts: ExtractedStatusFact[];
};

function parseValuesJson(raw: string): ParsedValuesJson | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: StatusWidgetValues = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k === "extracted_facts") continue;
      if (typeof v === "string" || typeof v === "number") {
        out[k] = String(v).trim();
      }
    }
    return {
      values: Object.keys(out).length > 0 ? out : null,
      facts: sanitizeExtractedFacts(parsed.extracted_facts),
    };
  } catch {
    return null;
  }
}

function extractBlock(text: string, start: string, end: string): { before: string; inner: string; after: string } | null {
  const startIdx = text.indexOf(start);
  if (startIdx < 0) return null;
  const innerStart = startIdx + start.length;
  const endIdx = text.indexOf(end, innerStart);
  if (endIdx < 0) return null;
  return {
    before: text.slice(0, startIdx),
    inner: text.slice(innerStart, endIdx).trim(),
    after: text.slice(endIdx + end.length),
  };
}

function looksLikeStatusWidgetValues(values: StatusWidgetValues): boolean {
  const keys = Object.keys(values);
  if (keys.length === 0) return false;
  const hint = /시간|장소|속마음|현재|location|time|mood|상태|place/i;
  return keys.some((k) => hint.test(k));
}

/** 레거시 ```json 또는 bare trailing object — <<<STATUS_VALUES>>> 미사용 모델 대비 */
export function captureTrailingLegacyStatusJsonValues(text: string): {
  prose: string;
  values: StatusWidgetValues | null;
} {
  let work = text.trimEnd();

  const fenceMatch = work.match(/```json\s*([\s\S]*?)```\s*$/i);
  if (fenceMatch?.index != null && fenceMatch[1]) {
    const parsed = parseValuesJson(fenceMatch[1]);
    if (parsed?.values && looksLikeStatusWidgetValues(parsed.values)) {
      return { prose: work.slice(0, fenceMatch.index).trimEnd(), values: parsed.values };
    }
  }

  const bareMatch = work.match(/\n(\{[\s\S]*\})\s*$/);
  if (bareMatch?.index != null && bareMatch[1]) {
    const parsed = parseValuesJson(bareMatch[1]);
    if (parsed?.values && looksLikeStatusWidgetValues(parsed.values)) {
      return { prose: work.slice(0, bareMatch.index).trimEnd(), values: parsed.values };
    }
  }

  return { prose: work, values: null };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexibleLabelPattern(label: string): string {
  const compact = label.replace(/\s+/g, "");
  if (!compact) return "";
  return [...compact].map((ch) => escapeRegex(ch)).join("\\s*");
}

function isWidgetPlaceholderValue(value: string): boolean {
  const t = value.trim();
  return (
    !t ||
    t === "—" ||
    t === "…" ||
    t === "..." ||
    t === "<scene value>" ||
    /^[.·…\s-]+$/.test(t)
  );
}

/** JSON 조각·필드 누적 오염 (infer 실패 시 상태창 깨짐) */
export function isCorruptStatusWidgetFieldValue(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (t.length > 320) return true;
  if (/","(?:장소|속마음|현재상황|시간)"/.test(t)) return true;
  if (/^["']/.test(t) && /":/.test(t)) return true;
  if (t.endsWith("}\"") || t.endsWith('}"')) return true;
  return false;
}

export function sanitizeStatusWidgetFieldValue(value: string): string | null {
  const t = value.trim();
  if (isWidgetPlaceholderValue(t) || isCorruptStatusWidgetFieldValue(t)) return null;
  return t;
}

function sanitizeStatusWidgetValues(values: StatusWidgetValues | null | undefined): StatusWidgetValues | null {
  if (!values) return null;
  const out: StatusWidgetValues = {};
  for (const [k, v] of Object.entries(values)) {
    const clean = sanitizeStatusWidgetFieldValue(v);
    if (clean) out[k] = clean;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function sanitizeParsedStatusWidgetValues(
  values: ParsedStatusWidgetTurnValues | null | undefined
): ParsedStatusWidgetTurnValues {
  if (!values) return {};
  const character = sanitizeStatusWidgetValues(values.character);
  const user = sanitizeStatusWidgetValues(values.user);
  const extracted_facts = sanitizeExtractedFacts(values.extracted_facts);
  if (!character && !user && extracted_facts.length === 0) return {};
  return {
    character,
    user,
    ...(extracted_facts.length > 0 ? { extracted_facts } : {}),
  };
}

function mapValuesToWidgetFields(
  values: StatusWidgetValues | null | undefined,
  widget: StatusWidget | null | undefined
): StatusWidgetValues | null {
  if (!values || !widget?.fields?.length) return sanitizeStatusWidgetValues(values);
  const normalizedEntries = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    normalizedEntries.set(normalizeStatusWidgetLookupKey(key), value);
  }

  const out: StatusWidgetValues = {};
  for (const field of widget.fields) {
    const targetKey = fieldPlaceholderKey(field) || field.id.trim();
    if (!targetKey) continue;
    for (const lookup of statusWidgetFieldLookupKeys(field, widget.htmlTemplate)) {
      const raw = values[lookup] ?? normalizedEntries.get(normalizeStatusWidgetLookupKey(lookup));
      const clean = raw != null ? sanitizeStatusWidgetFieldValue(raw) : null;
      if (
        clean &&
        rejectsUnknownLikeTemporalValue(field) &&
        isUnknownLikeStatusValue(clean)
      ) {
        continue;
      }
      if (clean) {
        out[targetKey] = clean;
        if (field.id && field.id !== targetKey) out[field.id] = clean;
        break;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function normalizeParsedStatusWidgetValuesForTurn(
  values: ParsedStatusWidgetTurnValues | null | undefined,
  widgets: { characterWidget?: StatusWidget | null; userWidget?: StatusWidget | null }
): ParsedStatusWidgetTurnValues {
  const sanitized = sanitizeParsedStatusWidgetValues(values);
  const character = mapValuesToWidgetFields(sanitized.character, widgets.characterWidget);
  const user = mapValuesToWidgetFields(sanitized.user, widgets.userWidget);
  const extracted_facts = sanitizeExtractedFacts(sanitized.extracted_facts);
  if (!character && !user && extracted_facts.length === 0) return {};
  return {
    character,
    user,
    ...(extracted_facts.length > 0 ? { extracted_facts } : {}),
  };
}

export function statusWidgetValuesAreCorrupt(
  values: ParsedStatusWidgetTurnValues | null | undefined
): boolean {
  const check = (v?: StatusWidgetValues | null) =>
    Boolean(
      v &&
        Object.values(v).some(
          (x) => x?.trim() && !isWidgetPlaceholderValue(x) && isCorruptStatusWidgetFieldValue(x)
        )
    );
  return check(values?.character) || check(values?.user);
}

/** 모델이 줄글 상태(속ma음 : …)로 출력한 경우 — 위젯 필드 라벨로 역추출 */
export function inferWidgetValuesFromProse(
  text: string,
  widget: StatusWidget | null | undefined
): StatusWidgetValues | null {
  if (!widget?.fields?.length) return null;
  const tail = text.trimEnd();
  const out: StatusWidgetValues = {};

  for (const field of widget.fields) {
    const label = field.label.trim();
    const key = fieldPlaceholderKey(field);
    if (!label) continue;

    const labelRe = flexibleLabelPattern(label);
    const instructionHint = field.instruction.trim().slice(0, 16);
    const patterns = [
      new RegExp(`${labelRe}\\s*(?:한\\s*줄)?\\s*[:：]\\s*(.+?)(?=\\n|$)`, "i"),
      new RegExp(`(?:NPC(?:의)?\\s*)?${labelRe}[^\\n:：]{0,24}[:：]\\s*(.+?)(?=\\n|$)`, "i"),
    ];
    if (instructionHint.length >= 4) {
      const hintRe = escapeRegex(instructionHint).replace(/\s+/g, "\\s+");
      patterns.push(
        new RegExp(`${hintRe}[^\\n:：]{0,16}[:：]\\s*(.+?)(?=\\n|$)`, "i")
      );
    }

    for (const re of patterns) {
      const match = tail.match(re);
      const value = match?.[1]?.trim();
      if (value && value.length > 0 && sanitizeStatusWidgetFieldValue(value)) {
        out[key] = sanitizeStatusWidgetFieldValue(value)!;
        if (field.id && field.id !== key) out[field.id] = value;
        break;
      }
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** 본문에서 상태값 블록 제거 + 파싱 */
export function splitProseAndStatusWidgetValues(fullText: string): {
  prose: string;
  values: ParsedStatusWidgetTurnValues;
} {
  let work = fullText;
  const values: ParsedStatusWidgetTurnValues = {};

  const charBlock = extractBlock(work, STATUS_VALUES_CHAR_BLOCK, STATUS_VALUES_END);
  if (charBlock) {
    const parsed = parseValuesJson(charBlock.inner);
    values.character = parsed?.values ?? null;
    values.extracted_facts = mergeExtractedFacts(values.extracted_facts, parsed?.facts);
    work = (charBlock.before + charBlock.after).trim();
  }

  const userBlock = extractBlock(work, STATUS_VALUES_USER_BLOCK, STATUS_VALUES_END);
  if (userBlock) {
    const parsed = parseValuesJson(userBlock.inner);
    values.user = parsed?.values ?? null;
    values.extracted_facts = mergeExtractedFacts(values.extracted_facts, parsed?.facts);
    work = (userBlock.before + userBlock.after).trim();
  }

  const singleBlock = extractBlock(work, STATUS_VALUES_BLOCK, STATUS_VALUES_END);
  if (singleBlock) {
    const parsed = parseValuesJson(singleBlock.inner);
    if (parsed?.values) {
      if (values.character == null && values.user == null) {
        values.character = parsed.values;
      } else if (values.character == null) {
        values.character = parsed.values;
      } else if (values.user == null) {
        values.user = parsed.values;
      }
    }
    values.extracted_facts = mergeExtractedFacts(values.extracted_facts, parsed?.facts);
    work = (singleBlock.before + singleBlock.after).trim();
  }

  if (values.character == null && values.user == null) {
    const legacy = captureTrailingLegacyStatusJsonValues(work);
    if (legacy.values) {
      values.character = legacy.values;
      work = legacy.prose;
    }
  }

  return { prose: stripTrailingStatusWidgetMarkers(work.trim()), values: sanitizeParsedStatusWidgetValues(values) };
}

export function serializeStatusWidgetValuesJson(values: ParsedStatusWidgetTurnValues): string {
  return JSON.stringify(values);
}

/** strip 전 원본 모델 출력에서 위젯 JSON 캡처 */
export function captureStatusWidgetValuesFromModelText(
  text: string
): ParsedStatusWidgetTurnValues | null {
  const split = splitProseAndStatusWidgetValues(text);
  return split.values.character || split.values.user ? split.values : null;
}

export function parseStoredStatusWidgetValuesJson(raw: string | null | undefined): ParsedStatusWidgetTurnValues {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as ParsedStatusWidgetTurnValues;
    return sanitizeParsedStatusWidgetValues({
      character: parsed.character ?? null,
      user: parsed.user ?? null,
      extracted_facts: parsed.extracted_facts,
    });
  } catch {
    return {};
  }
}

export function stripExtractedFactsForClient(
  values: ParsedStatusWidgetTurnValues | null | undefined
): ParsedStatusWidgetTurnValues {
  const sanitized = sanitizeParsedStatusWidgetValues(values);
  const out: ParsedStatusWidgetTurnValues = {};
  if (sanitized.character) out.character = sanitized.character;
  if (sanitized.user) out.user = sanitized.user;
  return out;
}
