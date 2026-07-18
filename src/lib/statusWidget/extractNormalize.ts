import { fieldPlaceholderKey } from "./fieldKeys";
import { collectWidgetJsonKeys } from "./prompt";
import { EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS } from "./prompt";
import { allocateWidgetExtractNarrativeSlices } from "./proseStrip";
import { sanitizeExtractedFacts } from "./extractedFacts";
import {
  isUnknownLikeStatusValue,
  keyLooksLikeCalendarClockSeasonWeather,
  rejectsUnknownLikeTemporalValue,
  sanitizeAndRepairTemporalValues,
} from "./temporalUnknown";
import type {
  ExtractedStatusFact,
  StatusWidget,
  StatusWidgetField,
  StatusWidgetValues,
} from "./types";

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

function findWidgetFieldForKey(
  widget: StatusWidget | null | undefined,
  key: string
): StatusWidgetField | undefined {
  if (!widget) return undefined;
  for (const field of widget.fields) {
    if (fieldPlaceholderKey(field) === key) return field;
    if (field.id === key || field.label === key) return field;
  }
  return undefined;
}

/** Omit unknown-like values only for temporal fields that reject them. */
export function shouldOmitUnknownLikePreviousValue(
  key: string,
  value: string,
  widget?: StatusWidget | null
): boolean {
  if (!isUnknownLikeStatusValue(value)) return false;
  const field = findWidgetFieldForKey(widget, key);
  if (field) return rejectsUnknownLikeTemporalValue(field);
  return keyLooksLikeCalendarClockSeasonWeather(key);
}

export function formatPreviousTurnWidgetValues(
  values: StatusWidgetValues | null | undefined,
  source: "character" | "user",
  widget?: StatusWidget | null
): string {
  if (!values || Object.keys(values).length === 0) {
    return `[PREVIOUS TURN ${source.toUpperCase()} WIDGET VALUES]
(none — first fill; init calendar/clock fields per rules, not "—")`;
  }
  const lines = Object.entries(values)
    .filter(
      ([k, v]) =>
        Boolean(v?.trim()) &&
        !isWidgetPlaceholderValue(v) &&
        !shouldOmitUnknownLikePreviousValue(k, v, widget)
    )
    .map(([k, v]) => `- ${k}: ${v.trim()}`);
  return `[PREVIOUS TURN ${source.toUpperCase()} WIDGET VALUES]
${lines.length > 0 ? lines.join("\n") : "(empty — infer from narrative)"}`;
}

/**
 * 내면 필드의 시점 기준은 "각 필드의 instruction 텍스트"가 최우선이다.
 * instruction이 "NPC의 속마음"이라 하면 NPC 것을, "유저의 속마음"이라 하면 유저 것을 쓴다.
 * source(제작자용/유저용 위젯)는 instruction이 대상 인물을 명시하지 않았을 때의 기본값일 뿐이다.
 */
export function buildWidgetExtractSystem(
  widget: StatusWidget,
  keys: string[],
  source: "character" | "user" = "character"
): string {
  const keyList = keys.map((k) => `"${k}"`).join(", ");
  const defaultSubject = source === "character" ? "[CHARACTER] (the NPC)" : "[USER] (the user persona)";
  return `You extract RP scene status widget field values as JSON only. No prose, no markdown fences.

Return exactly one JSON object with these keys plus "extracted_facts": ${keyList}, "extracted_facts"

Rules:
- Korean values preferred when the scene is Korean.
- The widget reflects the scene state at the END of this turn. If the turn contains multiple scenes or time skips (*** breaks, "다음날", "아침이 밝아" etc.), fill EVERY field from the LAST scene — never an earlier scene.
- Fill every key with a scene-accurate value from the assistant prose and user message.
- Never copy placeholders like "<scene value>", "…", "...", or "—" unless truly unknown.
- Calendar/clock/season/weather: never output "—" just because prose omits them. Priority: (1) explicit prose/user (2) field instruction or initialValue (3) [PREVIOUS TURN WIDGET VALUES] canonical anchor — keep if no time passed; else advance date/clock/season/weather together from that anchor (4) first fill / missing prior clock: MUST invent one scene-consistent real value (valid date, HH:MM, season+weather), not "—". If prose advances time but prior clock is missing, invent a plausible prior then advance. Counters (days-met, D-DAY, elapsed days) follow each field's own instruction/initialValue only — do not auto-sync them to date. "—" only if still impossible after that chain. Anchor is extract-only; never paste previous values as-is.
- Calendar, clock, season, and weather fields require concrete values. Never output —, unknown, 알 수 없음, 미상, 모름, or N/A. When no explicit value exists, use initialValue, a valid previous anchor, or invent one scene-consistent concrete value.
- For location/place fields: update when the scene moves; use the location of the LAST scene.
- Use "—" only when there is truly no usable basis for that field (calendar/clock fields: follow the chain above).
- Inner-state fields (속마음, 의식의 흐름, 감정, thoughts, inner monologue): each field's [WIDGET FIELDS] instruction states WHOSE inner state to write — obey it exactly. If the instruction says the NPC's ("NPC의 속마음" etc.), write [CHARACTER]'s inner state; if it says the user's ("유저의 속마음" etc.), write [USER]'s. If the instruction does not name anyone, default to ${defaultSubject}.
  Never substitute the other person's feelings for the required person's. If the turn's prose is written from the OTHER person's point of view and the required person does not appear on-page, do NOT copy the narrator's feelings — actively infer the required person's OWN separate reaction to what happened to THEM this turn, from their last known state.
  Example — field instruction asks for [CHARACTER]'s inner state, but the turn narrates [USER] anxiously rushing to rescue [CHARACTER] who was just sent to a dangerous frontier:
  ✗ WRONG: "그가 위험에 처했다는 소식에 불안하다. 반드시 구하러 가야 한다" (this is [USER]'s worry, mislabeled as [CHARACTER]'s)
  ✓ RIGHT: "갑작스러운 파병 명령에 당혹스럽지만 군인으로서 임무를 완수해야 한다" ([CHARACTER]'s own inferred reaction to being sent there)
  If [PREVIOUS TURN WIDGET VALUES] has a prior value for that field, or this turn's events affect the required person at all, that IS enough basis — update the prior inner state with this turn's events instead of giving up. Only when the required person has truly zero basis (no prior state AND no relevant event) output exactly "(자리비움)" — never fall back to the other person's emotions.
- Do NOT add keys beyond the required list.
- Do NOT invent lore that contradicts the provided context.
- When [PREVIOUS TURN ASSISTANT] is provided, use it only for continuity (time/place/mood); prefer current-turn evidence.
${EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS}`;
}

export function buildWidgetExtractUserBlock(opts: {
  charName: string;
  characterIdentity?: string | null;
  personaName: string;
  userPersona?: string | null;
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
    formatPreviousTurnWidgetValues(opts.previousValues, opts.source, opts.widget),
    `[WIDGET FIELDS]`,
    opts.widget.fields
      .map((f) => {
        const base = `- ${fieldPlaceholderKey(f)} (${f.label}): ${f.instruction}`;
        const initial = f.initialValue?.trim();
        return initial ? `${base}\n  initialValue: ${initial}` : base;
      })
      .join("\n"),
    `[CHARACTER] ${opts.charName}`,
    opts.characterIdentity?.trim() ? `[CHARACTER IDENTITY — MUST OBEY]\n${opts.characterIdentity.trim()}` : "",
    `[USER] ${opts.personaName}`,
    `[USER MESSAGE]\n${opts.userMessage}`,
    previousSlice ? `[PREVIOUS TURN ASSISTANT — prose only]\n${previousSlice}` : "",
    `[ASSISTANT REPLY — current turn prose only]\n${currentSlice}`,
    buildWidgetSourceReminder(opts.source, opts.charName, opts.personaName),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildWidgetSourceReminder(
  source: "character" | "user",
  charName: string,
  personaName: string
): string {
  const defaultName = source === "character" ? `[CHARACTER](${charName})` : `[USER](${personaName})`;
  return `[REMINDER] 내면 필드(속마음/의식의 흐름 등)는 각 필드의 지시사항이 지정한 인물의 시점으로 써라 — 지시사항이 NPC의 것을 요구하면 [CHARACTER](${charName})의 내면을, 유저의 것을 요구하면 [USER](${personaName})의 내면을 쓴다. 인물이 명시되지 않은 필드는 ${defaultName} 기준. 위 서술이 다른 인물의 시점·감정 위주로 쓰여 있어도 그 감정을 그대로 옮기지 말고, 요구된 인물이 이 사건을 겪는 입장에서 지금 무엇을 느낄지 추정해서 써라. 요구된 인물이 이 턴에 등장하지 않아도, [PREVIOUS TURN WIDGET VALUES]에 그 필드의 직전 값이 있거나 이 턴의 사건이 그 인물에게 영향을 주면 그것이 곧 추정 근거다 — 직전 내면 상태를 이 턴 사건으로 갱신해서 써라. 직전 값도 없고 관련 사건도 전혀 없는 경우에만 "(자리비움)"으로 남겨라.`;
}

export function normalizeWidgetExtraction(
  parsed: Record<string, unknown>,
  widget: StatusWidget
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


    if (
      value &&
      rejectsUnknownLikeTemporalValue(field) &&
      isUnknownLikeStatusValue(value)
    ) {
      // Keep temporarily so sanitizeAndRepairTemporalValues can repair from initialValue.
      out[key] = value;
      continue;
    }

    if (value && !isWidgetPlaceholderValue(value)) {
      out[key] = value;
      if (field.id && field.id !== key) out[field.id] = value;
    }
  }

  const repaired = sanitizeAndRepairTemporalValues(out, widget);
  return repaired.values ?? {};
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

export const REPAIR_PROSE_CHAR_BUDGET = 12_000;

/** Prefer the final scene: keep the last N chars when prose exceeds budget. */
export function sliceAssistantProseForRepair(
  prose: string,
  budget = REPAIR_PROSE_CHAR_BUDGET
): string {
  const t = prose.trim();
  if (t.length <= budget) return t;
  return t.slice(-budget);
}

export function looksLikeInnerStateField(field: StatusWidgetField): boolean {
  const blob = `${field.id} ${field.label} ${field.instruction}`.toLowerCase();
  return /속마음|의식|내면|감정|thought|inner|monologue|feeling|mood/.test(blob);
}

/** Instruction-named subject wins; otherwise default to extract source. */
export function defaultSubjectForRepairField(
  field: StatusWidgetField,
  source: "character" | "user"
): "character" | "user" {
  const instr = field.instruction;
  if (/NPC의|캐릭터의|\[CHARACTER\]/i.test(instr)) return "character";
  if (/유저의|\[USER\]/i.test(instr)) return "user";
  return source;
}

export function resolveRepairMaxTokens(widget: StatusWidget, keys: string[]): number {
  const fieldCount = Math.max(keys.length, widget.fields.length);
  let freeTextHeavy = 0;
  for (const field of widget.fields) {
    if (looksLikeInnerStateField(field) || /자유|서술|문장|흐름/.test(field.instruction)) {
      freeTextHeavy += 1;
    }
  }
  const tokens = 256 + Math.max(0, fieldCount - 6) * 24 + freeTextHeavy * 40;
  return Math.min(512, Math.max(256, Math.round(tokens)));
}

function normalizeEchoCompare(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

const REPAIR_ECHO_META_PHRASES = [
  "NPC의 속마음",
  "유저의 속마음",
  "NPC의 현재 속마음",
  "유저의 현재 속마음",
  "NPC의 의식의 흐름",
  "유저의 의식의 흐름",
];

/**
 * Exact-match anti-echo for repair responses only.
 * Drops individual echoing fields; never discards the whole source for one bad field.
 */
export function dropRepairEchoFields(
  values: StatusWidgetValues,
  widget: StatusWidget
): { values: StatusWidgetValues; droppedKeys: string[] } {
  const out: StatusWidgetValues = { ...values };
  const droppedKeys: string[] = [];
  const meta = new Set(REPAIR_ECHO_META_PHRASES.map(normalizeEchoCompare));

  for (const field of widget.fields) {
    const keys = [fieldPlaceholderKey(field), field.id?.trim(), field.label.trim()].filter(
      Boolean
    ) as string[];
    const instrN = normalizeEchoCompare(field.instruction);
    const labelN = normalizeEchoCompare(field.label);
    const idN = normalizeEchoCompare(field.id ?? "");

    for (const key of keys) {
      const raw = out[key];
      if (raw == null || !raw.trim()) continue;
      const valueN = normalizeEchoCompare(raw);
      const isEcho =
        valueN === instrN ||
        valueN === labelN ||
        (idN.length > 0 && valueN === idN) ||
        meta.has(valueN);
      if (!isEcho) continue;
      delete out[key];
      if (!droppedKeys.includes(key)) droppedKeys.push(key);
    }
  }

  return { values: out, droppedKeys };
}

/**
 * Slim same-model repair prompt — field contract + current RP + previous canonical
 * anchors. No long identity docs / previous assistant prose dumps.
 */
export function buildWidgetExtractRepairSystem(
  keys: string[],
  source: "character" | "user" = "character"
): string {
  const keyList = keys.map((k) => `"${k}"`).join(", ");
  const defaultSubject =
    source === "character" ? "[CHARACTER] (the NPC)" : "[USER] (the user persona)";
  return `Extract status widget field values as JSON only. No prose, no markdown fences.
Return one JSON object with exactly these keys: ${keyList}
Korean values preferred when the scene is Korean.
Never use placeholders like "<scene value>", "…", "...", or "—".
Calendar/clock/season/weather must be concrete values — never unknown/알 수 없음/미상/모름/N/A.
Do not add extra keys.

Return final scene values, not field instructions.
Never copy a field label, instruction, initial-value description, "NPC의 속마음", or "유저의 속마음" as the value.

Inner-state fields: each field's instruction states WHOSE inner state to write — obey it exactly.
If the instruction does not name anyone, default to ${defaultSubject}.
Never substitute the other person's feelings for the required person's.

Fill priority (highest first):
1. Explicit values in the current ASSISTANT RP / CURRENT USER MESSAGE
2. Field initialValue when the widget defines one (use the value, not the instruction text)
3. [PREVIOUS CANONICAL WIDGET VALUES] as continuity anchor — keep if no time/place change; advance date/clock/season/weather together when prose advances time
4. First-fill reasonable inference when no prior anchor exists
Previous values are anchors only — never paste them as-is when current RP explicitly changed the scene.
Prefer the FINAL scene in [ASSISTANT RP — FINAL SCENE PRIORITY].`;
}

/** Refined previous field values for repair (no previous prose dump). */
export function formatPreviousCanonicalWidgetValuesForRepair(
  values: StatusWidgetValues | null | undefined,
  widget?: StatusWidget | null
): string {
  if (!values || Object.keys(values).length === 0) {
    return "[PREVIOUS CANONICAL WIDGET VALUES]\n(none)";
  }
  const lines = Object.entries(values)
    .filter(
      ([k, v]) =>
        Boolean(v?.trim()) &&
        !isWidgetPlaceholderValue(v) &&
        !shouldOmitUnknownLikePreviousValue(k, v, widget)
    )
    .map(([k, v]) => `- ${k}: ${v.trim()}`);
  return `[PREVIOUS CANONICAL WIDGET VALUES]\n${
    lines.length > 0 ? lines.join("\n") : "(none)"
  }`;
}

function formatWidgetFieldContract(
  widget: StatusWidget,
  source: "character" | "user"
): string {
  const blocks = widget.fields.map((field) => {
    const key = fieldPlaceholderKey(field);
    const lines = [`- key: ${key}`, `  instruction: ${field.instruction.trim()}`];
    const initial = field.initialValue?.trim();
    if (initial) lines.push(`  initialValue: ${initial}`);
    if (looksLikeInnerStateField(field)) {
      lines.push(`  defaultSubject: ${defaultSubjectForRepairField(field, source)}`);
    }
    return lines.join("\n");
  });
  return `[WIDGET FIELD CONTRACT]\n${blocks.join("\n\n")}`;
}

export function buildWidgetExtractRepairUserBlock(opts: {
  keys: string[];
  assistantProse: string;
  previousValues?: StatusWidgetValues | null;
  widget: StatusWidget;
  source: "character" | "user";
  charName: string;
  personaName: string;
  userMessage?: string | null;
}): string {
  const defaultLabel =
    opts.source === "character"
      ? `[CHARACTER](${opts.charName})`
      : `[USER](${opts.personaName})`;
  const prose = sliceAssistantProseForRepair(opts.assistantProse);
  const userMessage = opts.userMessage?.trim() || "(empty)";

  return [
    `[SOURCE]\n${opts.source}\nDefault subject: ${defaultLabel}`,
    `[CHARACTER]\n${opts.charName}`,
    `[USER]\n${opts.personaName}`,
    formatWidgetFieldContract(opts.widget, opts.source),
    `[CURRENT USER MESSAGE]\n${userMessage}`,
    `[ASSISTANT RP — FINAL SCENE PRIORITY]\n${prose || "(empty)"}`,
    formatPreviousCanonicalWidgetValuesForRepair(opts.previousValues, opts.widget),
  ].join("\n\n");
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function usableWidgetValueKeys(values: StatusWidgetValues | null): string[] {
  if (!values) return [];
  return Object.entries(values)
    .filter(([, v]) => Boolean(v?.trim()))
    .map(([k]) => k);
}

/** Dual character+user initial extract — flat product field keys, no opaque fids. */
export function buildCombinedDualWidgetExtractSystem(
  characterWidget: StatusWidget,
  userWidget: StatusWidget
): string {
  const charKeys = collectWidgetJsonKeys(characterWidget)
    .map((k) => `"${k}"`)
    .join(", ");
  const userKeys = collectWidgetJsonKeys(userWidget)
    .map((k) => `"${k}"`)
    .join(", ");
  return `You extract RP scene status widget field values as JSON only. No prose, no markdown fences.

Return exactly one JSON object with this shape:
{
  "character_values": { ${charKeys || ""} },
  "user_values": { ${userKeys || ""} },
  "extracted_facts": []
}

Rules:
- character_values and user_values are separate namespaces. Never put user fields into character_values or vice versa.
- Korean values preferred when the scene is Korean.
- The widget reflects the scene state at the END of this turn. If the turn contains multiple scenes or time skips, fill EVERY field from the LAST scene.
- Never copy placeholders like "<scene value>", "…", "...", or "—" unless truly unknown.
- Calendar/clock/season/weather: never output "—" just because prose omits them. Priority: (1) explicit prose/user (2) field instruction or initialValue (3) previous canonical anchor (4) invent one scene-consistent concrete value. Never output unknown/알 수 없음/미상/모름/N/A.
- Inner-state fields (속마음, 의식의 흐름, 감정, thoughts, inner monologue):
  - Infer each source's current scene reaction separately from that source's field instruction.
  - Do not copy character and user emotions/inner states as one shared value across character_values and user_values.
  - When the scene gives cues, write a short grounded current state per source — do not default to placeholders like 알 수 없음 / 미상 / 모름 / unknown.
  - Unknown-like narrative values are allowed only when the scene is truly ambiguous OR the field instruction itself requires uncertainty.
  - Identical strings across sources are fine when the scene genuinely warrants the same state; sameness alone is not an error.
  - Obey each field's instruction for WHOSE inner state to write. Do not swap [CHARACTER] and [USER] subjects.
- Do NOT copy field labels, instructions, or requirement phrases as values.
- Prefer current-turn explicit change over previous canonical anchors.
- Do NOT invent lore that contradicts the provided context.
${EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS}`;
}

export function buildCombinedDualWidgetExtractUserBlock(opts: {
  charName: string;
  characterIdentity?: string | null;
  personaName: string;
  userMessage: string;
  assistantProse: string;
  previousAssistantProse?: string | null;
  characterWidget: StatusWidget;
  userWidget: StatusWidget;
  previousCharacterValues?: StatusWidgetValues | null;
  previousUserValues?: StatusWidgetValues | null;
}): string {
  const { currentSlice, previousSlice } = allocateWidgetExtractNarrativeSlices(
    opts.assistantProse,
    opts.previousAssistantProse
  );
  const formatFields = (widget: StatusWidget) =>
    widget.fields
      .map((f) => {
        const base = `- ${fieldPlaceholderKey(f)} (${f.label}): ${f.instruction}`;
        const initial = f.initialValue?.trim();
        return initial ? `${base}\n  initialValue: ${initial}` : base;
      })
      .join("\n");

  return [
    formatPreviousTurnWidgetValues(opts.previousCharacterValues, "character", opts.characterWidget),
    formatPreviousTurnWidgetValues(opts.previousUserValues, "user", opts.userWidget),
    `[CHARACTER WIDGET FIELDS]\n${formatFields(opts.characterWidget)}`,
    `[USER WIDGET FIELDS]\n${formatFields(opts.userWidget)}`,
    `[CHARACTER] ${opts.charName}`,
    opts.characterIdentity?.trim()
      ? `[CHARACTER IDENTITY — MUST OBEY]\n${opts.characterIdentity.trim()}`
      : "",
    `[USER] ${opts.personaName}`,
    `[USER MESSAGE]\n${opts.userMessage}`,
    previousSlice ? `[PREVIOUS TURN ASSISTANT — prose only]\n${previousSlice}` : "",
    `[ASSISTANT REPLY — current turn prose only]\n${currentSlice}`,
    `[REMINDER] character_values = [CHARACTER](${opts.charName}) widget only; user_values = [USER](${opts.personaName}) widget only. Infer inner-state per source from the current scene — do not share one emotion across both namespaces, and avoid unknown placeholders when scene cues exist. Obey each field instruction's subject. Prefer current explicit change over previous anchors. Do not copy instructions/labels as values.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type CombinedDualWidgetExtractParseResult = {
  character: StatusWidgetValues | null;
  user: StatusWidgetValues | null;
  extracted_facts: ExtractedStatusFact[];
  characterOk: boolean;
  userOk: boolean;
  jsonParseOk: boolean;
  characterEchoDroppedKeys: string[];
  userEchoDroppedKeys: string[];
};

/**
 * Parse combined dual extract JSON with per-source isolation.
 * Facts failures never wipe status; one source failure never wipes the other.
 */
export function parseCombinedDualWidgetExtractResponse(
  text: string,
  opts: {
    characterWidget: StatusWidget;
    userWidget: StatusWidget;
    /** Apply field-local anti-echo drops (does not fail sibling fields/sources). */
    applyEchoFilter?: boolean;
  }
): CombinedDualWidgetExtractParseResult {
  const empty: CombinedDualWidgetExtractParseResult = {
    character: null,
    user: null,
    extracted_facts: [],
    characterOk: false,
    userOk: false,
    jsonParseOk: false,
    characterEchoDroppedKeys: [],
    userEchoDroppedKeys: [],
  };
  const root = extractJsonObjectFromWidgetText(text);
  if (!root) return empty;

  const out: CombinedDualWidgetExtractParseResult = {
    ...empty,
    jsonParseOk: true,
    extracted_facts: sanitizeExtractedFacts(root.extracted_facts),
  };

  const charRaw = asJsonRecord(root.character_values);
  if (charRaw) {
    let normalized = normalizeWidgetExtraction(charRaw, opts.characterWidget);
    if (opts.applyEchoFilter) {
      const filtered = dropRepairEchoFields(normalized, opts.characterWidget);
      normalized = filtered.values;
      out.characterEchoDroppedKeys = filtered.droppedKeys;
    }
    const keys = usableWidgetValueKeys(normalized);
    if (keys.length > 0) {
      out.character = normalized;
      out.characterOk = true;
    }
  }

  const userRaw = asJsonRecord(root.user_values);
  if (userRaw) {
    let normalized = normalizeWidgetExtraction(userRaw, opts.userWidget);
    if (opts.applyEchoFilter) {
      const filtered = dropRepairEchoFields(normalized, opts.userWidget);
      normalized = filtered.values;
      out.userEchoDroppedKeys = filtered.droppedKeys;
    }
    const keys = usableWidgetValueKeys(normalized);
    if (keys.length > 0) {
      out.user = normalized;
      out.userOk = true;
    }
  }

  return out;
}
