/**
 * DeepSeek V4 Pro — STATUS_VALUES tail 파싱·캡처 (END 마커 누락·inline JSON 대응)
 */

import { mergeExtractedFacts, sanitizeExtractedFacts } from "./extractedFacts";
import { EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS } from "./prompt";
import type { ExtractedStatusFact, ParsedStatusWidgetTurnValues, StatusWidgetValues } from "./types";
import {
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_CHAR_BLOCK,
  STATUS_VALUES_END,
  STATUS_VALUES_USER_BLOCK,
  splitProseAndStatusWidgetValues,
} from "./parseValues";

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

function looksLikeStatusWidgetValues(values: StatusWidgetValues): boolean {
  const keys = Object.keys(values);
  if (keys.length === 0) return false;
  const hint = /시간|장소|속마음|현재|location|time|mood|상태|place/i;
  return keys.some((k) => hint.test(k));
}

/** Balanced `{ ... }` slice — strings/escapes respected */
export function extractBalancedJsonObject(
  raw: string,
  fromIndex = 0
): { json: string; endIndex: number } | null {
  const start = raw.indexOf("{", fromIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString && c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return { json: raw.slice(start, i + 1), endIndex: i + 1 };
      }
    }
  }
  return null;
}

type MarkerExtract = {
  before: string;
  parsed: StatusWidgetValues | null;
  facts: ExtractedStatusFact[];
  after: string;
};

/** `<<<END_STATUS>>>` 없이 marker 뒤 JSON 객체 추출 (DeepSeek 관용) */
export function extractStatusWidgetJsonAfterMarker(
  text: string,
  marker: string
): MarkerExtract | null {
  const startIdx = text.indexOf(marker);
  if (startIdx < 0) return null;

  const tailStart = startIdx + marker.length;
  const tail = text.slice(tailStart);
  const endMarkerRel = tail.indexOf(STATUS_VALUES_END);

  let searchRegion: string;
  let consumeThrough: number;

  if (endMarkerRel >= 0) {
    searchRegion = tail.slice(0, endMarkerRel);
    consumeThrough = tailStart + endMarkerRel + STATUS_VALUES_END.length;
  } else {
    searchRegion = tail;
    consumeThrough = text.length;
  }

  const balanced = extractBalancedJsonObject(searchRegion);
  if (!balanced) {
    return {
      before: text.slice(0, startIdx).trimEnd(),
      parsed: null,
      facts: [],
      after: text.slice(startIdx).trimStart(),
    };
  }

  const parsed = parseValuesJson(balanced.json);
  const jsonEndInText = tailStart + balanced.endIndex;
  const afterStart = endMarkerRel >= 0 ? consumeThrough : jsonEndInText;

  return {
    before: text.slice(0, startIdx).trimEnd(),
    parsed: parsed?.values && looksLikeStatusWidgetValues(parsed.values) ? parsed.values : null,
    facts: parsed?.facts ?? [],
    after: text.slice(afterStart).trimStart(),
  };
}

/** `<<<STATUS_VALUES 백하율>>>` 등 비표준 마커 (char/user 슬러그 없음) */
export const LOOSE_STATUS_VALUES_MARKER_RE = /<<<STATUS_VALUES(?:\s+[^>]+)?>>>/i;

function extractStatusWidgetJsonAfterLooseMarker(text: string): MarkerExtract | null {
  const m = text.match(LOOSE_STATUS_VALUES_MARKER_RE);
  if (!m || m.index == null) return null;
  const startIdx = m.index;
  const tailStart = startIdx + m[0].length;
  const tail = text.slice(tailStart);
  const endMarkerRel = tail.indexOf(STATUS_VALUES_END);

  let searchFrom = tailStart;
  let consumeThrough: number;

  if (endMarkerRel >= 0) {
    consumeThrough = tailStart + endMarkerRel + STATUS_VALUES_END.length;
  } else {
    consumeThrough = tailStart;
  }

  const balanced = extractBalancedJsonObject(text, searchFrom);
  if (!balanced) {
    return {
      before: text.slice(0, startIdx).trimEnd(),
      parsed: null,
      facts: [],
      after: text.slice(startIdx).trimStart(),
    };
  }

  const parsed = parseValuesJson(balanced.json);
  const afterStart = endMarkerRel >= 0 ? consumeThrough : balanced.endIndex;

  return {
    before: text.slice(0, startIdx).trimEnd(),
    parsed: parsed?.values && looksLikeStatusWidgetValues(parsed.values) ? parsed.values : null,
    facts: parsed?.facts ?? [],
    after: text.slice(afterStart).trimStart(),
  };
}

/** DeepSeek / Gemini Pro — strict split 실패 시 marker+JSON 관용 파싱 */
export function splitProseAndStatusWidgetValuesDeepSeek(fullText: string): {
  prose: string;
  values: ParsedStatusWidgetTurnValues;
} {
  const standard = splitProseAndStatusWidgetValues(fullText);
  if (standard.values.character || standard.values.user) {
    return standard;
  }

  let work = fullText;
  const values: ParsedStatusWidgetTurnValues = {};

  const charHit = extractStatusWidgetJsonAfterMarker(work, STATUS_VALUES_CHAR_BLOCK);
  if (charHit?.parsed) {
    values.character = charHit.parsed;
    values.extracted_facts = mergeExtractedFacts(values.extracted_facts, charHit.facts);
    work = `${charHit.before}\n${charHit.after}`.trim();
  }

  const userHit = extractStatusWidgetJsonAfterMarker(work, STATUS_VALUES_USER_BLOCK);
  if (userHit?.parsed) {
    values.user = userHit.parsed;
    values.extracted_facts = mergeExtractedFacts(values.extracted_facts, userHit.facts);
    work = `${userHit.before}\n${userHit.after}`.trim();
  }

  if (!values.character && !values.user) {
    const singleHit = extractStatusWidgetJsonAfterMarker(work, STATUS_VALUES_BLOCK);
    if (singleHit?.parsed) {
      values.character = singleHit.parsed;
      values.extracted_facts = mergeExtractedFacts(values.extracted_facts, singleHit.facts);
      work = `${singleHit.before}\n${singleHit.after}`.trim();
    }
  }

  if (!values.character && !values.user) {
    const looseHit = extractStatusWidgetJsonAfterLooseMarker(work);
    if (looseHit?.parsed) {
      values.character = looseHit.parsed;
      values.extracted_facts = mergeExtractedFacts(values.extracted_facts, looseHit.facts);
      work = `${looseHit.before}\n${looseHit.after}`.trim();
    } else if (looseHit) {
      work = `${looseHit.before}\n${looseHit.after}`.trim();
    }
  }

  return { prose: work.trim(), values };
}

export function captureDeepSeekStatusWidgetValuesFromModelText(
  text: string
): ParsedStatusWidgetTurnValues | null {
  const split = splitProseAndStatusWidgetValuesDeepSeek(text);
  return split.values.character || split.values.user ? split.values : null;
}

export const DEEPSEEK_STATUS_WIDGET_BOTTOM_REMINDER = `[Status widget — required every turn]
After RP prose, append this block (fill JSON from the scene — never skip):
${EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS}
<<<STATUS_VALUES char>>>
{"시간":"<scene>","장소":"<scene>","속마음":"<scene>","현재상황":"<scene>","extracted_facts":[]}
<<<END_STATUS>>>`;
