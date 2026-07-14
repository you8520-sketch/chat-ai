import { fieldPlaceholderKey } from "./fieldKeys";
import { collectWidgetJsonKeys } from "./prompt";
import { EXTRACTED_FACTS_STATUS_VALUES_INSTRUCTIONS } from "./prompt";
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
- For time/datetime fields, in priority order:
  1. An explicit final time/date marker in the prose (e.g. a 📅 date line near the end, or the last scene's stated clock time like "오후 8시") ALWAYS wins.
  2. Only when no explicit final time exists: start from [PREVIOUS TURN WIDGET VALUES] clock anchor and advance by the in-universe duration of this turn (including skips — a turn ending the next evening must NOT keep the previous night's clock).
- For location/place fields: update when the scene moves; use the location of the LAST scene.
- Use "—" only when there is truly no in-scene evidence for that field.
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
    formatPreviousTurnWidgetValues(opts.previousValues, opts.source),
    `[WIDGET FIELDS]`,
    opts.widget.fields
      .map((f) => `- ${fieldPlaceholderKey(f)} (${f.label}): ${f.instruction}`)
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
