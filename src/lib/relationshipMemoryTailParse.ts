const RELATIONSHIP_MEMORY_JSON_KEYS = new Set([
  "honorifics",
  "items",
  "thoughts",
  "promisesAdd",
  "promisesRemove",
]);

const RELATIONSHIP_TAIL_HINT =
  /"honorifics"|"items"|"thoughts"|"promisesAdd"|"promisesRemove"/;

export function looksLikeRelationshipMemoryObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  return keys.every((k) => RELATIONSHIP_MEMORY_JSON_KEYS.has(k));
}

export function parseRelationshipMemoryJsonText(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```\s*$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!looksLikeRelationshipMemoryObject(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Balanced `{ ... }` at end — relationship memory tail */
export function extractTrailingRelationshipJsonObject(
  text: string
): { prose: string; json: string } | null {
  const trimmed = text.trimEnd();
  const lastBrace = trimmed.lastIndexOf("{");
  if (lastBrace < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = lastBrace; i < trimmed.length; i++) {
    const c = trimmed[i];
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
        const json = trimmed.slice(lastBrace, i + 1);
        const prose = trimmed.slice(0, lastBrace).trimEnd();
        return { prose, json };
      }
    }
  }
  return null;
}

export type RelationshipMemoryTailParse = {
  prose: string;
  parseOk: boolean;
  rawJson: Record<string, unknown> | null;
};

export function splitProseAndRelationshipMemoryTail(fullText: string): RelationshipMemoryTailParse {
  const fail = (): RelationshipMemoryTailParse => ({
    prose: fullText.trimEnd(),
    parseOk: false,
    rawJson: null,
  });

  const work = fullText.trimEnd();
  if (!work) return fail();

  const trailing = extractTrailingRelationshipJsonObject(work);
  if (!trailing) return fail();

  const parsed = parseRelationshipMemoryJsonText(trailing.json);
  if (!parsed) return fail();

  return {
    prose: trailing.prose.trimEnd(),
    parseOk: true,
    rawJson: parsed,
  };
}

/** 스트림 중 — 관계메모 JSON tail·부분 `{` 제거 (완성본은 즉시 prose만 노출) */
export function stripRelationshipMemoryTailForStream(text: string): string {
  let work = text.trimEnd();
  if (!work) return work;

  const complete = splitProseAndRelationshipMemoryTail(work);
  if (complete.parseOk) {
    return complete.prose;
  }

  const markerIdx = work.search(/\{"honorifics"/i);
  if (markerIdx >= 0) {
    work = work.slice(0, markerIdx).trimEnd();
  }

  const lastBrace = work.lastIndexOf("{");
  if (lastBrace >= 0) {
    const fragment = work.slice(lastBrace);
    const parsed = parseRelationshipMemoryJsonText(fragment);
    if (parsed) {
      work = work.slice(0, lastBrace).trimEnd();
    } else if (
      RELATIONSHIP_TAIL_HINT.test(fragment) ||
      /"honorifics/i.test(fragment) ||
      (fragment.startsWith("{") && !fragment.trimEnd().endsWith("}"))
    ) {
      work = work.slice(0, lastBrace).trimEnd();
    }
  }

  const partialMarker = work.match(/\n\{\s*"?$/);
  if (partialMarker?.index != null) {
    work = work.slice(0, partialMarker.index).trimEnd();
  }

  return work;
}
