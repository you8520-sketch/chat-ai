import { fieldPlaceholderKey } from "./fieldKeys";
import { expandStatusWidgetProfilePlaceholders } from "./placeholders";
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

function expandFieldText(
  text: string,
  charName: string,
  personaName: string
): string {
  return expandStatusWidgetProfilePlaceholders(text, {
    characterName: charName,
    personaName,
  });
}

function formatWidgetFieldsForExtract(
  widget: StatusWidget,
  charName: string,
  personaName: string
): string {
  return widget.fields
    .map((f) => {
      const label = expandFieldText(f.label, charName, personaName);
      const instruction = expandFieldText(f.instruction, charName, personaName);
      const base = `- ${fieldPlaceholderKey(f)} (${label}): ${instruction}`;
      const initial = f.initialValue?.trim();
      const expandedInitial = initial
        ? expandFieldText(initial, charName, personaName)
        : "";
      return expandedInitial ? `${base}\n  initialValue: ${expandedInitial}` : base;
    })
    .join("\n");
}

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

/** Header note: previous values are continuity refs, not answer exemplars. */
const PREVIOUS_WIDGET_CONTINUITY_NOTE =
  "(continuity reference — not answer text to copy; derive this turn primarily from current RP)";

/**
 * Soft inner-state quality (속마음/의식의흐름/감정/현재 의도 등) — prompt-only.
 * Full policy owner: system extract only (single / dual / repair). No post-hoc rewrite.
 */
export const INNER_STATE_QUALITY_EN =
  "Prefer the most important current-turn change in judgment, emotion, question, or intent. " +
  "If the underlying emotion remains the same, do not invent a false change, but avoid repeatedly restating the same conclusion with slightly different wording across turns. " +
  "Do not habitually begin every inner-state with the same subject address such as '이 사람/이 신입/저 녀석'. " +
  "When the RP already states an inner thought explicitly, do not merely echo that sentence; express the current resulting judgment or intent instead, without inventing unsupported facts. " +
  "Keep inner-state short natural first-person thought — not analysis, summary, or exposition.";

/**
 * Short Korean reminder nudge only — not a full-equivalent of INNER_STATE_QUALITY_EN.
 * Full semantic axis / subject-start / false-emotion policy stays in the EN system owner.
 */
export const INNER_STATE_QUALITY_KO =
  "현재 턴에서 새로 생긴 판단·의문·의도를 우선하고, 본문에 이미 나온 내면문장을 그대로 복창하지 마라.";

/**
 * Turn-derived free-text fields — previous answer text must not be injected as
 * continuity anchors (answer anchoring). Persistent meters/time/place stay.
 * Includes inner-state and 현재상황 / current-situation style fields.
 */
export function looksLikeVolatileTurnDerivedField(field: StatusWidgetField): boolean {
  if (looksLikeInnerStateField(field)) return true;
  const blob = `${field.id} ${field.label} ${field.instruction}`.toLowerCase();
  return /현재\s*상황|지금\s*벌어지는|현재\s*욕구|현재\s*의도|현재\s*행동|현재\s*반응|current\s*situation|current\s*scene|current\s*reaction|situation\s*summary/.test(
    blob
  );
}

export function looksLikeVolatileTurnDerivedKey(key: string): boolean {
  return /속마음|의식|내면|감정|표정|thought|inner|monologue|feeling|mood|expression|face|현재\s*상황|현재상황|current\s*situation|current\s*scene/i.test(
    key
  );
}

export function shouldOmitVolatilePreviousValue(
  key: string,
  widget?: StatusWidget | null
): boolean {
  const field = findWidgetFieldForKey(widget, key);
  if (field) return looksLikeVolatileTurnDerivedField(field);
  return looksLikeVolatileTurnDerivedKey(key);
}

function formatPreviousPersistentValueLines(
  values: StatusWidgetValues,
  widget?: StatusWidget | null
): string[] {
  return Object.entries(values)
    .filter(
      ([k, v]) =>
        Boolean(v?.trim()) &&
        !isWidgetPlaceholderValue(v) &&
        !shouldOmitUnknownLikePreviousValue(k, v, widget) &&
        !shouldOmitVolatilePreviousValue(k, widget)
    )
    .map(([k, v]) => `- ${k}: ${v.trim()}`);
}

export function formatPreviousTurnWidgetValues(
  values: StatusWidgetValues | null | undefined,
  source: "character" | "user",
  widget?: StatusWidget | null
): string {
  if (!values || Object.keys(values).length === 0) {
    return `[PREVIOUS TURN ${source.toUpperCase()} WIDGET VALUES]
${PREVIOUS_WIDGET_CONTINUITY_NOTE}
(none — first fill; init calendar/clock fields per rules, not "—")`;
  }
  const lines = formatPreviousPersistentValueLines(values, widget);
  return `[PREVIOUS TURN ${source.toUpperCase()} WIDGET VALUES]
${PREVIOUS_WIDGET_CONTINUITY_NOTE}
${lines.length > 0 ? lines.join("\n") : "(empty — infer from narrative; turn-derived fields omitted)"}`;
}

/**
 * 내면 필드의 시점 기준은 "각 필드의 instruction 텍스트"가 최우선이다.
 * instruction이 "NPC의 속마음"이라 하면 NPC 것을, "유저의 속마음"이라 하면 유저 것을 쓴다.
 * source(제작자용/유저용 위젯)는 instruction이 대상 인물을 명시하지 않았을 때의 기본값일 뿐이다.
 */
/** Shared final-scene priority — single / combined / repair (minimal wording). */
export const STATUS_WIDGET_FINAL_SCENE_PRIORITY_LINES = [
  "The status widget is a snapshot at the END of the current assistant RP.",
  "If CURRENT USER MESSAGE starts at a place/situation and the assistant RP later moves time/place/state, the LAST scene of the assistant RP wins.",
  "Do not pick an early scene in the RP or a previous canonical location/time.",
  "Do not mix time, date, and place from different scenes.",
  "Keep user-stated facts that the RP did not change.",
  "Use the location, time, and situation of the LAST scene, never an earlier scene.",
].join("\n- ");

/** Identity + CRITICAL context blocks for extract prompts (single / combined / repair). */
export function formatStatusWidgetCharacterContextBlocks(opts: {
  characterIdentity?: string | null;
  characterCriticalContext?: string | null;
}): string[] {
  const out: string[] = [];
  const identity = opts.characterIdentity?.trim();
  if (identity) {
    out.push(`[CHARACTER IDENTITY — MUST OBEY]\n${identity}`);
  }
  const critical = opts.characterCriticalContext?.trim();
  if (critical) {
    out.push(
      `[CHARACTER CRITICAL CONTEXT — MUST OBEY]\n` +
        `When CRITICAL context conflicts with generic scene inference, obey CRITICAL context.\n` +
        `When the current RP shows a change that CRITICAL context allows, reflect that current RP change.\n` +
        critical
    );
  }
  return out;
}

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
- ${STATUS_WIDGET_FINAL_SCENE_PRIORITY_LINES}
- Fill every key with a scene-accurate value from the assistant prose and user message.
- Previous-turn widget values are continuity references, not answer text to copy. Derive this turn's values primarily from what actually happened in the current RP turn. Persistent state (date/time/place/HP/corruption/currency/ammo/D-DAY/relationship meters) may keep prior values when unchanged; do not invent changes without evidence.
- Never copy placeholders like "<scene value>", "…", "...", or "—" unless truly unknown.
- Calendar/clock/season/weather: never output "—" just because prose omits them. Priority: (1) explicit prose/user (2) field instruction or initialValue (3) [PREVIOUS TURN WIDGET VALUES] canonical anchor — keep if no time passed; else advance date/clock/season/weather together from that anchor (4) first fill / missing prior clock: MUST invent one scene-consistent real value (valid date, HH:MM, season+weather), not "—". If prose advances time but prior clock is missing, invent a plausible prior then advance. Counters (days-met, D-DAY, elapsed days) follow each field's own instruction/initialValue only — do not auto-sync them to date. "—" only if still impossible after that chain. Anchor is extract-only; never paste previous values as-is.
- Calendar, clock, season, and weather fields require concrete values. Never output —, unknown, 알 수 없음, 미상, 모름, or N/A. When no explicit value exists, use initialValue, a valid previous anchor, or invent one scene-consistent concrete value.
- For location/place fields: update when the scene moves; use the location of the LAST scene.
- Use "—" only when there is truly no usable basis for that field (calendar/clock fields: follow the chain above).
- Inner-state fields (속마음, 의식의 흐름, 감정, 표정, thoughts, inner monologue): each field's [WIDGET FIELDS] instruction states WHOSE inner state to write — obey it exactly. If the instruction says the character's ("{{char}}의 속마음", "NPC의 속마음" etc.), write [CHARACTER]'s inner state; if it says the user's ("{{user}}의 속마음", "유저의 속마음" etc.), write [USER]'s. {{char}} means [CHARACTER]'s display name and {{user}} means [USER]'s display name — never output the literals "NPC", "PC", "{{char}}", or "{{user}}" as a name or value when a real name is known. If the instruction does not name anyone, default to ${defaultSubject}.
  Never substitute the other person's feelings for the required person's. If the turn's prose is written from the OTHER person's point of view and the required person does not appear on-page, do NOT copy the narrator's feelings — actively infer the required person's OWN separate reaction to what happened to THEM this turn, from their last known state.
  Example — field instruction asks for [CHARACTER]'s inner state, but the turn narrates [USER] anxiously rushing to rescue [CHARACTER] who was just sent to a dangerous frontier:
  ✗ WRONG: "그가 위험에 처했다는 소식에 불안하다. 반드시 구하러 가야 한다" (this is [USER]'s worry, mislabeled as [CHARACTER]'s)
  ✓ RIGHT: "갑작스러운 파병 명령에 당혹스럽지만 군인으로서 임무를 완수해야 한다" ([CHARACTER]'s own inferred reaction to being sent there)
  Freshly evaluate inner-state at the END of the current turn. Use previous values only for continuity — do not mechanically repeat the previous wording when this turn provides new actions, dialogue, information, or emotional context. If the underlying state genuinely remains unchanged, preserve the meaning rather than inventing a false change; exact wording need not be copied.
  ${INNER_STATE_QUALITY_EN}
  If [PREVIOUS TURN WIDGET VALUES] has a prior value for that field, or this turn's events affect the required person at all, that IS enough basis — update from this turn's events instead of giving up. Only when the required person has truly zero basis (no prior state AND no relevant event) output exactly "(자리비움)" — never fall back to the other person's emotions.
- Do NOT add keys beyond the required list.
- Do NOT invent lore that contradicts the provided context.
- Never copy [CHARACTER CRITICAL CONTEXT] wording into field values.
- When [PREVIOUS TURN ASSISTANT] is provided, use it only for continuity (time/place/mood); prefer current-turn evidence.
${EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS}`;
}

export function buildWidgetExtractUserBlock(opts: {
  charName: string;
  characterIdentity?: string | null;
  characterCriticalContext?: string | null;
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
    formatWidgetFieldsForExtract(opts.widget, opts.charName, opts.personaName),
    `[CHARACTER] ${opts.charName}`,
    ...formatStatusWidgetCharacterContextBlocks({
      characterIdentity: opts.characterIdentity,
      characterCriticalContext: opts.characterCriticalContext,
    }),
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
  return `[REMINDER] 내면 필드(속마음/의식의 흐름/표정 등)는 각 필드의 지시사항이 지정한 인물의 시점으로, 이 턴 끝 기준으로 재평가하라 — 지시사항이 NPC의 것을 요구하면 [CHARACTER](${charName})의 내면을, 유저의 것을 요구하면 [USER](${personaName})의 내면을 쓴다. 인물이 명시되지 않은 필드는 ${defaultName} 기준. 위 서술이 다른 인물의 시점·감정 위주로 쓰여 있어도 그 감정을 그대로 옮기지 말고, 요구된 인물이 이 사건을 겪는 입장에서 지금 무엇을 느낄지 추정해서 써라. [PREVIOUS TURN WIDGET VALUES]는 continuity reference일 뿐 답안 복사용이 아니다 — 이 턴에 새 행동·대사·정보·감정 단서가 있으면 직전 문구를 기계적으로 복사하지 말고 갱신하라. 상태가 진짜로 같으면 의미만 유지하고 거짓 감정 변화는 만들지 마라. 직전 값도 없고 관련 사건도 전혀 없는 경우에만 "(자리비움)"으로 남겨라. ${INNER_STATE_QUALITY_KO}`;
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
  return /속마음|의식|내면|감정|표정|thought|inner|monologue|feeling|mood|expression|face/.test(
    blob
  );
}

function resolveFieldValue(
  values: StatusWidgetValues | null | undefined,
  field: StatusWidgetField
): string {
  for (const c of [fieldPlaceholderKey(field), field.id?.trim(), field.label.trim()].filter(
    Boolean
  ) as string[]) {
    const v = values?.[c]?.trim();
    if (v) return v;
  }
  return "";
}

/**
 * Exact previous==current matches for volatile/turn-derived fields only.
 * Persistent exact matches are expected and must not be listed here.
 */
export function collectVolatileExactEchoKeys(opts: {
  widget?: StatusWidget | null;
  previous?: StatusWidgetValues | null;
  current?: StatusWidgetValues | null;
}): string[] {
  const previous = opts.previous ?? null;
  const current = opts.current ?? null;
  if (!previous || !current) return [];
  const exactKeys: string[] = [];
  if (opts.widget) {
    for (const field of opts.widget.fields) {
      if (!looksLikeVolatileTurnDerivedField(field)) continue;
      const key = fieldPlaceholderKey(field);
      if (!key) continue;
      const prevVal = resolveFieldValue(previous, field);
      const curVal = resolveFieldValue(current, field);
      if (!prevVal || !curVal) continue;
      if (prevVal === curVal) exactKeys.push(key);
    }
    return [...new Set(exactKeys)];
  }
  for (const [k, v] of Object.entries(previous)) {
    if (!v?.trim() || !looksLikeVolatileTurnDerivedKey(k)) continue;
    const cur = current[k]?.trim();
    if (cur && cur === v.trim()) exactKeys.push(k);
  }
  return [...new Set(exactKeys)];
}

/** Observe + guard input: volatile exact echo / whole character (no values logged). */
export type StatusWidgetPreviousEchoStats = {
  compared: number;
  exact: number;
  allExact: boolean;
  wholeCharacterExact: boolean;
  exactKeys: string[];
};

export function measureStatusWidgetPreviousEcho(opts: {
  widget?: StatusWidget | null;
  previous?: StatusWidgetValues | null;
  current?: StatusWidgetValues | null;
}): StatusWidgetPreviousEchoStats {
  const previous = opts.previous ?? null;
  const current = opts.current ?? null;
  const prevEntries = previous
    ? Object.entries(previous).filter(([, v]) => Boolean(v?.trim()))
    : [];
  const curMap = new Map(
    current
      ? Object.entries(current)
          .filter(([, v]) => Boolean(v?.trim()))
          .map(([k, v]) => [k, v.trim()] as const)
      : []
  );

  let wholeCharacterExact = false;
  if (prevEntries.length > 0 && curMap.size === prevEntries.length) {
    wholeCharacterExact = prevEntries.every(([k, v]) => curMap.get(k) === v.trim());
  }

  const exactKeys: string[] = [];
  let compared = 0;
  if (opts.widget) {
    for (const field of opts.widget.fields) {
      if (!looksLikeVolatileTurnDerivedField(field)) continue;
      const key = fieldPlaceholderKey(field);
      const prevVal = resolveFieldValue(previous, field);
      const curVal = resolveFieldValue(current, field);
      if (!prevVal || !curVal) continue;
      compared += 1;
      if (prevVal === curVal) exactKeys.push(key);
    }
  } else if (previous && current) {
    for (const [k, v] of prevEntries) {
      if (!looksLikeVolatileTurnDerivedKey(k)) continue;
      const cur = curMap.get(k);
      if (cur == null) continue;
      compared += 1;
      if (cur === v.trim()) exactKeys.push(k);
    }
  }

  const exact = exactKeys.length;
  return {
    compared,
    exact,
    allExact: compared > 0 && exact === compared,
    wholeCharacterExact,
    exactKeys,
  };
}

export function formatStalePreviousValuesBlock(
  keys: string[],
  previous: StatusWidgetValues | null | undefined,
  widget?: StatusWidget | null
): string {
  const lines: string[] = [];
  for (const k of keys) {
    const field = findWidgetFieldForKey(widget, k);
    const prev = field
      ? resolveFieldValue(previous, field)
      : previous?.[k]?.trim() ?? "";
    if (!prev) continue;
    lines.push(`- ${k}: ${prev}`);
  }
  if (lines.length === 0) {
    return `[STALE PREVIOUS VALUE — DO NOT RETURN UNCHANGED]\n(none)`;
  }
  return `[STALE PREVIOUS VALUE — DO NOT RETURN UNCHANGED]
These exact strings were returned for the previous turn. Do NOT copy them as this turn's values when the current RP has new dialogue, actions, or information.
${lines.join("\n")}`;
}

export function buildVolatileEchoRepairSystem(
  keys: string[],
  source: "character" | "user" = "character"
): string {
  const keyList = keys.map((k) => `"${k}"`).join(", ");
  const defaultSubject =
    source === "character" ? "[CHARACTER] (the NPC)" : "[USER] (the user persona)";
  return `You repair ONLY the listed status-widget field values as JSON only. No prose, no markdown fences.
Return exactly one JSON object with these keys: ${keyList}

Rules:
- Korean values preferred when the scene is Korean.
- Use CURRENT USER MESSAGE + the FINAL SCENE of the assistant RP as primary evidence.
- Do NOT return the exact strings listed under [STALE PREVIOUS VALUE — DO NOT RETURN UNCHANGED].
- Re-evaluate each field at the END of this turn. New dialogue, actions, or information must change the wording when they affect that field.
- If the underlying state genuinely remains unchanged, preserve the meaning with different wording — never paste the stale string.
- Default subject when unspecified: ${defaultSubject}.
- ${STATUS_WIDGET_FINAL_SCENE_PRIORITY_LINES}`;
}

export function buildVolatileEchoRepairUserBlock(opts: {
  keys: string[];
  widget: StatusWidget;
  source: "character" | "user";
  previousValues?: StatusWidgetValues | null;
  assistantProse: string;
  userMessage?: string | null;
  charName: string;
  personaName: string;
  characterIdentity?: string | null;
  characterCriticalContext?: string | null;
}): string {
  const keySet = new Set(opts.keys);
  const fields = opts.widget.fields.filter((f) => keySet.has(fieldPlaceholderKey(f)));
  const contract =
    fields.length > 0
      ? fields
          .map((field) => {
            const key = fieldPlaceholderKey(field);
            const instruction = expandFieldText(
              field.instruction.trim(),
              opts.charName,
              opts.personaName
            );
            const lines = [`- key: ${key}`, `  instruction: ${instruction}`];
            if (looksLikeInnerStateField(field) || looksLikeVolatileTurnDerivedField(field)) {
              lines.push(`  defaultSubject: ${defaultSubjectForRepairField(field, opts.source)}`);
            }
            return lines.join("\n");
          })
          .join("\n\n")
      : opts.keys.map((k) => `- key: ${k}`).join("\n");

  const prose = sliceAssistantProseForRepair(opts.assistantProse);
  const userMessage = opts.userMessage?.trim() || "(empty)";
  const defaultLabel =
    opts.source === "character"
      ? `[CHARACTER](${opts.charName})`
      : `[USER](${opts.personaName})`;

  return [
    `[SOURCE]\n${opts.source}\nDefault subject: ${defaultLabel}`,
    `[CHARACTER]\n${opts.charName}`,
    ...formatStatusWidgetCharacterContextBlocks({
      characterIdentity: opts.characterIdentity,
      characterCriticalContext: opts.characterCriticalContext,
    }),
    `[USER]\n${opts.personaName}`,
    `[WIDGET FIELD CONTRACT — REPAIR TARGETS ONLY]\n${contract}`,
    formatStalePreviousValuesBlock(opts.keys, opts.previousValues, opts.widget),
    `[CURRENT USER MESSAGE]\n${userMessage}`,
    `[ASSISTANT RP — FINAL SCENE PRIORITY]\n${prose || "(empty)"}`,
  ].join("\n\n");
}

/** Merge repaired volatile keys only; never overwrite persistent fields. */
export function mergeVolatileRepairIntoValues(
  base: StatusWidgetValues,
  repaired: StatusWidgetValues | null | undefined,
  keys: string[],
  widget?: StatusWidget | null
): StatusWidgetValues {
  if (!repaired || keys.length === 0) return base;
  const out: StatusWidgetValues = { ...base };
  for (const key of keys) {
    const field = findWidgetFieldForKey(widget, key);
    const next = field ? resolveFieldValue(repaired, field) : repaired[key]?.trim() ?? "";
    if (!next || isWidgetPlaceholderValue(next)) continue;
    out[key] = next;
    if (field?.id && field.id !== key) out[field.id] = next;
  }
  return out;
}

/** Instruction-named subject wins; otherwise default to extract source. */
export function defaultSubjectForRepairField(
  field: StatusWidgetField,
  source: "character" | "user"
): "character" | "user" {
  const instr = field.instruction;
  if (/\{\{\s*char\s*\}\}|NPC의|캐릭터의|\[CHARACTER\]/i.test(instr)) return "character";
  if (/\{\{\s*user\s*\}\}|유저의|PC의|플레이어의|\[USER\]/i.test(instr)) return "user";
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

/**
 * Dual combined initial output budget (combined call only — not single/repair).
 *
 * Reuses per-source resolveRepairMaxTokens as a size proxy, then adds envelope slack:
 *   characterBudget + userBudget + 256
 * clamped to [768, 1536].
 *
 * Rationale:
 * - Global background-status-widget-extract default stays 512 for single/repair paths.
 * - Small dual widgets need at least 768 so character_values + user_values + facts fit.
 * - Large dual widgets (many free-text fields) can approach ~1280 (=512+512+256).
 * - Cap 1536 is a safety ceiling; billed tokens are actual usage, not the maxTokens ask.
 */
export function resolveCombinedDualWidgetExtractMaxTokens(
  characterWidget: StatusWidget,
  userWidget: StatusWidget
): number {
  const characterBudget = resolveRepairMaxTokens(
    characterWidget,
    collectWidgetJsonKeys(characterWidget)
  );
  const userBudget = resolveRepairMaxTokens(userWidget, collectWidgetJsonKeys(userWidget));
  const combined = characterBudget + userBudget + 256;
  return Math.min(1536, Math.max(768, Math.round(combined)));
}

/** Diagnostic-only: does not change repair/persist policy. */
export function isCombinedExtractLikelyTruncated(opts: {
  finishReason?: string | null;
  outputTokens?: number | null;
  maxTokens: number;
  jsonParseOk: boolean;
}): boolean {
  const fr = String(opts.finishReason ?? "").toLowerCase();
  if (/length|max[_-]?tokens/.test(fr)) return true;
  if (!opts.jsonParseOk && (opts.outputTokens ?? 0) >= opts.maxTokens) return true;
  return false;
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
Never copy a field label, instruction, initial-value description, "NPC의 속마음", "유저의 속마음", "{{char}}", "{{user}}", "NPC", or "PC" as the value when a real [CHARACTER]/[USER] name is available.
Never copy [CHARACTER CRITICAL CONTEXT] wording into field values.

Inner-state fields: each field's instruction states WHOSE inner state to write — obey it exactly.
If the instruction does not name anyone, default to ${defaultSubject}.
Never substitute the other person's feelings for the required person's.

Fill priority (highest first):
1. Explicit values in the current ASSISTANT RP / CURRENT USER MESSAGE
2. Field initialValue when the widget defines one (use the value, not the instruction text)
3. [PREVIOUS CANONICAL WIDGET VALUES] as continuity anchor — keep if no time/place change; advance date/clock/season/weather together when prose advances time
4. First-fill reasonable inference when no prior anchor exists
Previous values are continuity references, not answer text to copy — never paste them as-is when current RP changed the scene or adds new dialogue/information/emotional context. Persistent state may keep prior values when unchanged; inner-state: freshly evaluate at END of turn (preserve meaning if truly unchanged; do not invent false change).
Inner-state quality: ${INNER_STATE_QUALITY_EN}
Prefer the FINAL scene in [ASSISTANT RP — FINAL SCENE PRIORITY].
- ${STATUS_WIDGET_FINAL_SCENE_PRIORITY_LINES}`;
}

/** Refined previous field values for repair (no previous prose dump). Persistent only. */
export function formatPreviousCanonicalWidgetValuesForRepair(
  values: StatusWidgetValues | null | undefined,
  widget?: StatusWidget | null
): string {
  if (!values || Object.keys(values).length === 0) {
    return `[PREVIOUS CANONICAL WIDGET VALUES]\n${PREVIOUS_WIDGET_CONTINUITY_NOTE}\n(none)`;
  }
  const lines = formatPreviousPersistentValueLines(values, widget);
  return `[PREVIOUS CANONICAL WIDGET VALUES]\n${PREVIOUS_WIDGET_CONTINUITY_NOTE}\n${
    lines.length > 0 ? lines.join("\n") : "(none — turn-derived previous answers omitted)"
  }`;
}

function formatWidgetFieldContract(
  widget: StatusWidget,
  source: "character" | "user",
  charName = "",
  personaName = ""
): string {
  const blocks = widget.fields.map((field) => {
    const key = fieldPlaceholderKey(field);
    const instruction = expandFieldText(field.instruction.trim(), charName, personaName);
    const lines = [`- key: ${key}`, `  instruction: ${instruction}`];
    const initial = field.initialValue?.trim();
    if (initial) {
      lines.push(`  initialValue: ${expandFieldText(initial, charName, personaName)}`);
    }
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
  characterIdentity?: string | null;
  characterCriticalContext?: string | null;
}): string {
  const defaultLabel =
    opts.source === "character"
      ? `[CHARACTER](${opts.charName})`
      : `[USER](${opts.personaName})`;
  const prose = sliceAssistantProseForRepair(opts.assistantProse);
  const userMessage = opts.userMessage?.trim() || "(empty)";

  // Previous before current RP so it is not the last answer-exemplar position.
  return [
    `[SOURCE]\n${opts.source}\nDefault subject: ${defaultLabel}`,
    `[CHARACTER]\n${opts.charName}`,
    ...formatStatusWidgetCharacterContextBlocks({
      characterIdentity: opts.characterIdentity,
      characterCriticalContext: opts.characterCriticalContext,
    }),
    `[USER]\n${opts.personaName}`,
    formatWidgetFieldContract(opts.widget, opts.source, opts.charName, opts.personaName),
    formatPreviousCanonicalWidgetValuesForRepair(opts.previousValues, opts.widget),
    `[CURRENT USER MESSAGE]\n${userMessage}`,
    `[ASSISTANT RP — FINAL SCENE PRIORITY]\n${prose || "(empty)"}`,
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
- ${STATUS_WIDGET_FINAL_SCENE_PRIORITY_LINES}
- Never copy placeholders like "<scene value>", "…", "...", or "—" unless truly unknown.
- Calendar/clock/season/weather: never output "—" just because prose omits them. Priority: (1) explicit prose/user (2) field instruction or initialValue (3) previous canonical anchor (4) invent one scene-consistent concrete value. Never output unknown/알 수 없음/미상/모름/N/A.
- Previous-turn widget values are continuity references, not answer text to copy. Derive primarily from the current RP turn. Persistent state may keep prior values when unchanged; do not invent changes without evidence.
- Inner-state fields (속마음, 의식의 흐름, 감정, 표정, thoughts, inner monologue):
  - Infer each source's current scene reaction separately from that source's field instruction.
  - Freshly evaluate at END of turn; do not mechanically repeat previous wording when this turn has new actions/dialogue/information/emotional context. If underlying state is unchanged, preserve meaning (exact wording need not be copied); do not invent false change.
  - ${INNER_STATE_QUALITY_EN}
  - Do not copy character and user emotions/inner states as one shared value across character_values and user_values.
  - When the scene gives cues, write a short grounded current state per source — do not default to placeholders like 알 수 없음 / 미상 / 모름 / unknown.
  - Unknown-like narrative values are allowed only when the scene is truly ambiguous OR the field instruction itself requires uncertainty.
  - Identical strings across sources are fine when the scene genuinely warrants the same state; sameness alone is not an error.
  - Obey each field's instruction for WHOSE inner state to write. Do not swap [CHARACTER] and [USER] subjects.
- Do NOT copy field labels, instructions, or requirement phrases as values.
- Never copy [CHARACTER CRITICAL CONTEXT] wording into field values.
- Prefer current-turn explicit change over previous canonical anchors.
- Do NOT invent lore that contradicts the provided context.
${EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS}`;
}

export function buildCombinedDualWidgetExtractUserBlock(opts: {
  charName: string;
  characterIdentity?: string | null;
  characterCriticalContext?: string | null;
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
  return [
    formatPreviousTurnWidgetValues(opts.previousCharacterValues, "character", opts.characterWidget),
    formatPreviousTurnWidgetValues(opts.previousUserValues, "user", opts.userWidget),
    `[CHARACTER WIDGET FIELDS]\n${formatWidgetFieldsForExtract(opts.characterWidget, opts.charName, opts.personaName)}`,
    `[USER WIDGET FIELDS]\n${formatWidgetFieldsForExtract(opts.userWidget, opts.charName, opts.personaName)}`,
    `[CHARACTER] ${opts.charName}`,
    ...formatStatusWidgetCharacterContextBlocks({
      characterIdentity: opts.characterIdentity,
      characterCriticalContext: opts.characterCriticalContext,
    }),
    `[USER] ${opts.personaName}`,
    `[USER MESSAGE]\n${opts.userMessage}`,
    previousSlice ? `[PREVIOUS TURN ASSISTANT — prose only]\n${previousSlice}` : "",
    `[ASSISTANT REPLY — current turn prose only]\n${currentSlice}`,
    `[REMINDER] character_values = [CHARACTER](${opts.charName}) widget only; user_values = [USER](${opts.personaName}) widget only. Previous widget values are continuity references, not answer text to copy. Infer inner-state per source from the current scene end — do not mechanically repeat previous wording when this turn has new cues; preserve meaning if truly unchanged. Do not share one emotion across both namespaces, and avoid unknown placeholders when scene cues exist. Obey each field instruction's subject. Prefer current explicit change over previous anchors. Use the location, time, and situation of the LAST scene, never an earlier scene. Do not copy instructions/labels or CRITICAL context wording as values. ${INNER_STATE_QUALITY_KO}`,
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
