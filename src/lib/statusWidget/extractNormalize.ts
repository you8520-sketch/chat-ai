import { fieldPlaceholderKey } from "./fieldKeys";
import { collectWidgetJsonKeys } from "./prompt";
import { allocateWidgetExtractNarrativeSlices } from "./proseStrip";
import type { StatusWidget, StatusWidgetValues } from "./types";

function isWidgetPlaceholderValue(value: string): boolean {
  const t = value.trim();
  return (
    !t ||
    t === "…" ||
    t === "..." ||
    t === "<scene value>" ||
    /^[.·…\s-—–]+$/.test(t)
  );
}

export function formatPreviousTurnWidgetValues(
  values: StatusWidgetValues | null | undefined,
  source: "character" | "user"
): string {
  if (!values || Object.keys(values).length === 0) {
    return `[PREVIOUS TURN ${source.toUpperCase()} WIDGET VALUES]
(none — first widget fill in this chat; infer from narrative only)`;
  }
  const lines = Object.entries(values)
    .filter(([, v]) => v?.trim() && !isWidgetPlaceholderValue(v))
    .map(([k, v]) => `- ${k}: ${v.trim()}`);
  return `[PREVIOUS TURN ${source.toUpperCase()} WIDGET VALUES]
${lines.length > 0 ? lines.join("\n") : "(empty — infer from narrative)"}`;
}

export function buildWidgetExtractSystem(widget: StatusWidget, keys: string[]): string {
  const keyList = keys.map((k) => `"${k}"`).join(", ");
  return `You extract RP scene status widget field values as JSON only. No prose, no markdown fences.

Return exactly one JSON object with these keys: ${keyList}

Rules:
- Korean values preferred when the scene is Korean.
- Fill every key with a scene-accurate value from the assistant prose and user message.
- Never copy placeholders like "<scene value>", "…", "...", or "—" unless truly unknown.
- For time/datetime fields: start from [PREVIOUS TURN WIDGET VALUES] clock anchor when provided, then advance by in-universe duration of this turn.
- For location/place fields: update when the scene moves.
- Use "—" only when there is truly no in-scene evidence for that field.
- Do NOT add keys beyond the required list.
- Do NOT invent lore that contradicts the provided context.
- When [PREVIOUS TURN ASSISTANT] is provided, use it only for continuity (time/place/mood); prefer current-turn evidence.`;
}

export function buildWidgetExtractUserBlock(opts: {
  charName: string;
  personaName: string;
  userMessage: string;
  assistantProse: string;
  previousAssistantProse?: string | null;
  widget: StatusWidget;
  source: "character" | "user";
  previousValues?: StatusWidgetValues | null;
  userNote?: string;
}): string {
  const { currentSlice, previousSlice } = allocateWidgetExtractNarrativeSlices(
    opts.assistantProse,
    opts.previousAssistantProse
  );

  return [
    formatPreviousTurnWidgetValues(opts.previousValues, opts.source),
    `[WIDGET FIELDS]`,
    opts.widget.fields
      .map((f) => `- ${fieldPlaceholderKey(f)} (${f.label}): ${f.instruction}`)
      .join("\n"),
    opts.userNote?.trim() ? `[USER NOTE]\n${opts.userNote.trim()}` : "",
    `[CHARACTER] ${opts.charName}`,
    `[USER] ${opts.personaName}`,
    `[USER MESSAGE]\n${opts.userMessage}`,
    previousSlice ? `[PREVIOUS TURN ASSISTANT — prose only]\n${previousSlice}` : "",
    `[ASSISTANT REPLY — current turn prose only]\n${currentSlice}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function normalizeWidgetExtraction(
  parsed: Record<string, unknown>,
  widget: StatusWidget,
  previousValues?: StatusWidgetValues | null
): StatusWidgetValues {
  const out: StatusWidgetValues = {};
  const rawEntries = new Map<string, string>();

  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string" || typeof v === "number") {
      rawEntries.set(k.trim(), String(v).trim());
    }
  }

  for (const field of widget.fields) {
    const key = fieldPlaceholderKey(field);
    const candidates = [key, field.id?.trim(), field.label.trim()].filter(Boolean);
    let value = "";
    for (const candidate of candidates) {
      const hit = rawEntries.get(candidate!);
      if (hit && !isWidgetPlaceholderValue(hit)) {
        value = hit;
        break;
      }
    }

    if (!value && previousValues) {
      for (const candidate of candidates) {
        const prev = previousValues[candidate!]?.trim();
        if (prev && !isWidgetPlaceholderValue(prev)) {
          value = prev;
          break;
        }
      }
    }

    if (value && !isWidgetPlaceholderValue(value)) {
      out[key] = value;
      if (field.id && field.id !== key) out[field.id] = value;
    }
  }

  return out;
}

export function extractJsonObjectFromWidgetText(text: string): Record<string, unknown> | null {
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
