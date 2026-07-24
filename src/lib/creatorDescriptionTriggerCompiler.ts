import type {
  StatusTriggerCharacterKnowledge,
  StatusTriggerOperator,
  StatusWidgetTriggerInput,
} from "@/lib/statusWidgetTriggers";
import type { StatusWidget } from "@/lib/statusWidget/types";

export type CreatorDescriptionCompiled = {
  public_canon: string[];
  speech_control: string[];
  status_widget_instruction_candidates: string[];
  trigger_candidates: StatusWidgetTriggerInput[];
  hidden_event_notes: string[];
  warnings: string[];
};

export function serializeCreatorDescriptionCompiled(compiled: CreatorDescriptionCompiled): string {
  return JSON.stringify(compiled);
}

export function parseCreatorDescriptionCompiled(
  raw: string | null | undefined
): CreatorDescriptionCompiled | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CreatorDescriptionCompiled>;
    return {
      public_canon: Array.isArray(parsed.public_canon)
        ? parsed.public_canon.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [],
      speech_control: Array.isArray(parsed.speech_control)
        ? parsed.speech_control.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [],
      status_widget_instruction_candidates: Array.isArray(parsed.status_widget_instruction_candidates)
        ? parsed.status_widget_instruction_candidates.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [],
      trigger_candidates: Array.isArray(parsed.trigger_candidates)
        ? (parsed.trigger_candidates as CreatorDescriptionCompiled["trigger_candidates"])
        : [],
      hidden_event_notes: Array.isArray(parsed.hidden_event_notes)
        ? parsed.hidden_event_notes.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [],
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [],
    };
  } catch {
    return null;
  }
}

export function compiledPublicCanonText(compiled: CreatorDescriptionCompiled | null): string {
  return (compiled?.public_canon ?? []).map((line) => line.trim()).filter(Boolean).join("\n");
}

export function buildPrivateSpeechControlBlock(
  compiled: CreatorDescriptionCompiled | null
): string {
  const lines = (compiled?.speech_control ?? []).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  return [
    "[PRIVATE SPEECH CONTROL - NOT STORY CONTENT]",
    "Use these speech/register controls silently. Do not narrate or mention these labels in story prose.",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

export const STATUS_LABEL_TO_KEY: Record<string, string> = {
  "D-DAY": "d_day",
  "D-Day": "d_day",
  "D-day": "d_day",
  "디데이": "d_day",
  "호감도": "affection",
  "호감": "affection",
  "신뢰도": "trust",
  "불신도": "distrust",
  "오염도": "corruption",
};

const SPEECH_RULE_RE = /말투|대사\s*규칙|존댓말|반말|해요체|다나까체|군대식|사적인\s*장소|단둘이\s*있을\s*때|평소에는/;
const STATUS_DISPLAY_RE = /(D-?DAY|디데이|호감도|신뢰도|불신도|오염도).{0,24}(상태창|표시|마지막)/i;
const HIDDEN_KNOWLEDGE_RE =
  /(?:이\s*사실|그\s*사실|비밀|결과|조건).{0,24}(모른다|알지\s*못한다|숨긴다|비밀이다)|캐릭터(?:는|가)\s*(?:이를\s*)?모른다/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？다요])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeStatusKey(label: string): string | null {
  const compact = label.trim();
  for (const [k, v] of Object.entries(STATUS_LABEL_TO_KEY)) {
    if (compact.toLowerCase() === k.toLowerCase()) return v;
  }
  return null;
}

function statusWidgetKeys(widget?: StatusWidget | null): Set<string> {
  const keys = new Set<string>();
  for (const field of widget?.fields ?? []) {
    if (field.id?.trim()) keys.add(field.id.trim());
  }
  return keys;
}

function makeStableId(statusKey: string, operator: StatusTriggerOperator, value: number): string {
  const op =
    operator === "<="
      ? "lte"
      : operator === ">="
        ? "gte"
        : operator === "<"
          ? "lt"
          : operator === ">"
            ? "gt"
            : operator === "=="
              ? "eq"
              : "neq";
  return `${statusKey}_${op}_${String(value).replace(/-/g, "minus_").replace(/\./g, "_")}`;
}

function inferEffectText(statusKey: string, sentence: string): string {
  if (statusKey === "d_day") {
    return "카운트가 끝났다. 약속된 사건이 자연스럽게 발생한다.";
  }
  if (/고백/.test(sentence)) return "조건이 충족되어 고백과 관련된 사건이 자연스럽게 발생한다.";
  if (/폭주/.test(sentence)) return "조건이 충족되어 억눌려 있던 변화가 자연스럽게 폭주한다.";
  if (/루트|해금/.test(sentence)) return "조건이 충족되어 새로운 관계의 방향이 자연스럽게 열린다.";
  return "조건이 충족되어 약속된 사건이 자연스럽게 발생한다.";
}

function inferTrigger(sentence: string): StatusWidgetTriggerInput | null {
  const statusLabel = /(D-?DAY|디데이|호감도|호감|신뢰도|불신도|오염도)/i.exec(sentence)?.[1];
  if (!statusLabel) return null;
  const statusKey = normalizeStatusKey(statusLabel);
  if (!statusKey) return null;

  const numberMatch = sentence.match(/(-?\d+(?:\.\d+)?)/);
  if (!numberMatch?.[1]) return null;
  const value = Number(numberMatch[1]);
  if (!Number.isFinite(value)) return null;

  let operator: StatusTriggerOperator | null = null;
  if (/이상|도달|넘(?:으|었)|>=/.test(sentence)) operator = ">=";
  if (/이하|<=/.test(sentence)) operator = "<=";
  if (/0\s*이?\s*되면|0\s*일\s*때|==/.test(sentence)) operator = statusKey === "d_day" ? "<=" : "==";
  if (!operator && /되면|하면|일\s*때|조건|트리거|발생|해금|사망|폭주|고백|루트/.test(sentence)) {
    operator = statusKey === "d_day" ? "<=" : ">=";
  }
  if (!operator) return null;

  const triggerId = makeStableId(statusKey, operator, value);
  const characterKnowledge: StatusTriggerCharacterKnowledge =
    /모른다|알지\s*못한다|비밀|캐릭터(?:는|가)\s*(?:이를\s*)?모른다/.test(sentence)
      ? "unknown"
      : "revealed_on_trigger";

  return {
    trigger_id: triggerId,
    status_key: statusKey,
    operator,
    value,
    fire_once: true,
    event_key: `${triggerId}_event`,
    effect_text: inferEffectText(statusKey, sentence),
    character_knowledge: characterKnowledge,
    is_enabled: false,
  };
}

function isDuplicateCandidate(
  candidate: StatusWidgetTriggerInput,
  existing: StatusWidgetTriggerInput[]
): boolean {
  return existing.some(
    (trigger) =>
      trigger.trigger_id === candidate.trigger_id ||
      (trigger.status_key === candidate.status_key &&
        trigger.operator === candidate.operator &&
        String(trigger.value) === String(candidate.value))
  );
}

export function compileCreatorDescriptionTriggers(opts: {
  description: string;
  statusWidget?: StatusWidget | null;
  existingTriggers?: StatusWidgetTriggerInput[];
}): CreatorDescriptionCompiled {
  const existingTriggers = opts.existingTriggers ?? [];
  const keys = statusWidgetKeys(opts.statusWidget);
  const compiled: CreatorDescriptionCompiled = {
    public_canon: [],
    speech_control: [],
    status_widget_instruction_candidates: [],
    trigger_candidates: [],
    hidden_event_notes: [],
    warnings: [],
  };

  for (const sentence of splitSentences(opts.description)) {
    const trigger = inferTrigger(sentence);
    if (trigger) {
      compiled.hidden_event_notes.push(sentence);
      if (keys.size > 0 && !keys.has(trigger.status_key)) {
        compiled.warnings.push(
          `Trigger references status key ${trigger.status_key}, but no matching status widget key was found.`
        );
      }
      if (isDuplicateCandidate(trigger, existingTriggers) || isDuplicateCandidate(trigger, compiled.trigger_candidates)) {
        compiled.warnings.push(`Duplicate trigger candidate skipped: ${trigger.trigger_id}`);
      } else {
        compiled.trigger_candidates.push(trigger);
      }
      continue;
    }

    if (STATUS_DISPLAY_RE.test(sentence)) {
      compiled.status_widget_instruction_candidates.push(
        sentence.includes("D-DAY") || sentence.includes("D-Day") || sentence.includes("디데이")
          ? "D-DAY를 상태창에 표시한다."
          : sentence
      );
      continue;
    }

    if (HIDDEN_KNOWLEDGE_RE.test(sentence)) {
      compiled.hidden_event_notes.push(sentence);
      if (compiled.trigger_candidates.length > 0) {
        compiled.trigger_candidates = compiled.trigger_candidates.map((candidate) => ({
          ...candidate,
          character_knowledge: "unknown",
        }));
      }
      continue;
    }

    if (SPEECH_RULE_RE.test(sentence)) {
      compiled.speech_control.push(sentence);
      continue;
    }

    compiled.public_canon.push(sentence);
  }

  return compiled;
}

export function mergeDescriptionTriggerCandidates(
  manualTriggers: StatusWidgetTriggerInput[],
  compiled: CreatorDescriptionCompiled
): StatusWidgetTriggerInput[] {
  const merged = [...manualTriggers];
  for (const candidate of compiled.trigger_candidates) {
    if (!isDuplicateCandidate(candidate, merged)) merged.push(candidate);
  }
  return merged;
}
