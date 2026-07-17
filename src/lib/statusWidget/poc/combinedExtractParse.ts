/**
 * POC-only combined V3 extract parser.
 * Not imported by product extract/telemetry/finalize paths.
 */
import { fieldPlaceholderKey } from "../fieldKeys";
import { normalizeWidgetExtraction } from "../extractNormalize";
import { sanitizeExtractedFacts, mergeExtractedFacts } from "../extractedFacts";
import type { ExtractedStatusFact, StatusWidget, StatusWidgetValues } from "../types";

export type CombinedExtractRaw = {
  character_values?: unknown;
  user_values?: unknown;
  extracted_facts?: unknown;
};

export type CombinedExtractParseResult = {
  character: StatusWidgetValues | null;
  user: StatusWidgetValues | null;
  extracted_facts: ExtractedStatusFact[];
  characterParseOk: boolean;
  userParseOk: boolean;
  factsParseOk: boolean;
  jsonParseOk: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Extract a JSON object from model text (fenced or bare). */
export function extractJsonObjectFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1]!.trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Parse combined extract JSON with per-source isolation.
 * - Whole-JSON failure → both sources null
 * - Bad/missing source object → that source null only
 * - Bad facts → empty facts; does not invalidate widget values
 */
export function parseCombinedWidgetExtractResponse(
  text: string,
  opts: {
    characterWidget?: StatusWidget | null;
    userWidget?: StatusWidget | null;
  }
): CombinedExtractParseResult {
  const empty: CombinedExtractParseResult = {
    character: null,
    user: null,
    extracted_facts: [],
    characterParseOk: false,
    userParseOk: false,
    factsParseOk: false,
    jsonParseOk: false,
  };

  const root = extractJsonObjectFromText(text);
  if (!root) return empty;

  const out: CombinedExtractParseResult = {
    ...empty,
    jsonParseOk: true,
  };

  if (opts.characterWidget) {
    const rawChar = asRecord(root.character_values);
    if (rawChar) {
      const normalized = normalizeWidgetExtraction(rawChar, opts.characterWidget);
      out.character = Object.keys(normalized).length > 0 ? normalized : null;
      out.characterParseOk = true;
    } else {
      out.character = null;
      out.characterParseOk = false;
    }
  }

  if (opts.userWidget) {
    const rawUser = asRecord(root.user_values);
    if (rawUser) {
      const normalized = normalizeWidgetExtraction(rawUser, opts.userWidget);
      out.user = Object.keys(normalized).length > 0 ? normalized : null;
      out.userParseOk = true;
    } else {
      out.user = null;
      out.userParseOk = false;
    }
  }

  if ("extracted_facts" in root) {
    try {
      const facts = sanitizeExtractedFacts(root.extracted_facts);
      out.extracted_facts = mergeExtractedFacts(facts);
      out.factsParseOk = Array.isArray(root.extracted_facts);
    } catch {
      out.extracted_facts = [];
      out.factsParseOk = false;
    }
  } else {
    out.extracted_facts = [];
    out.factsParseOk = true;
  }

  return out;
}

export function buildCombinedWidgetExtractSystem(opts: {
  characterKeys: string[];
  userKeys: string[];
}): string {
  const charList = opts.characterKeys.map((k) => `"${k}"`).join(", ");
  const userList = opts.userKeys.map((k) => `"${k}"`).join(", ");
  return `You extract RP scene status widget field values as JSON only. No prose, no markdown fences.

Return exactly one JSON object with this shape (source namespaces — never flatten keys):
{
  "character_values": { ${charList} },
  "user_values": { ${userList} },
  "extracted_facts": []
}

Rules:
- character_values and user_values are separate objects. Identical key names (e.g. "시간", "장소", "속마음") must NOT overwrite across sources.
- Fill character_values from [CHARACTER WIDGET FIELDS] using [CHARACTER] POV defaults for unnamed inner-state fields.
- Fill user_values from [USER WIDGET FIELDS] using [USER] POV defaults for unnamed inner-state fields.
- Never swap character vs user inner feelings.
- Calendar/clock/season/weather: never "—" only because prose omits them. Priority: explicit prose/user → instruction/initialValue → previous canonical anchor → invent scene-consistent start. Counters follow each field's own instruction only.
- extracted_facts: at most 3, dedupe conceptually, once for the whole turn. NEVER include source_turn, id, uuid, request, generation, or provenance fields.
- Use "—" only when still impossible after the time-field chain (non-time free-text may use "—" when no basis).`;
}

export function buildCombinedWidgetExtractUserBlock(opts: {
  charName: string;
  personaName: string;
  userMessage: string;
  assistantProse: string;
  characterWidget: StatusWidget;
  userWidget: StatusWidget;
  previousCharacterValues?: StatusWidgetValues | null;
  previousUserValues?: StatusWidgetValues | null;
}): string {
  const formatFields = (widget: StatusWidget) =>
    widget.fields
      .map((f) => {
        const base = `- ${fieldPlaceholderKey(f)} (${f.label}): ${f.instruction}`;
        const initial = f.initialValue?.trim();
        return initial ? `${base}\n  initialValue: ${initial}` : base;
      })
      .join("\n");

  const formatPrev = (label: string, values: StatusWidgetValues | null | undefined) => {
    if (!values || Object.keys(values).length === 0) {
      return `[PREVIOUS ${label} WIDGET VALUES]\n(none — first fill; init calendar/clock fields per rules, not "—")`;
    }
    const lines = Object.entries(values)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `- ${k}: ${v.trim()}`);
    return `[PREVIOUS ${label} WIDGET VALUES]\n${lines.join("\n") || "(empty)"}`;
  };

  return [
    formatPrev("CHARACTER", opts.previousCharacterValues),
    formatPrev("USER", opts.previousUserValues),
    `[CHARACTER WIDGET FIELDS]\n${formatFields(opts.characterWidget)}`,
    `[USER WIDGET FIELDS]\n${formatFields(opts.userWidget)}`,
    `[CHARACTER] ${opts.charName}`,
    `[USER] ${opts.personaName}`,
    `[USER MESSAGE]\n${opts.userMessage}`,
    `[ASSISTANT REPLY — current turn prose only]\n${opts.assistantProse}`,
    `[REMINDER] character_values 속마음 = [CHARACTER](${opts.charName}) 시점. user_values 속마음 = [USER](${opts.personaName}) 시점. 서로 바꿔 쓰지 마라. JSON은 character_values / user_values / extracted_facts 네스트만 사용.`,
  ].join("\n\n");
}
