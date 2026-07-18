import type { SpeechProfile } from "@/lib/speechLock/types";
import { formatSpeechSectionAsMetadata } from "@/lib/speechMetadataPolicy";
import {
  SPEECH_CONTEXTUAL_LIMIT,
  SPEECH_EXAMPLES_LIMIT,
  SPEECH_FORBIDDEN_LIMIT,
} from "@/lib/characterFormLimits";

/** 캐릭터 제작 — 말투 세분화 입력 */
export type SpeechContextualRegister = {
  label: string;
  condition: string;
  style: string;
  examples: string;
  priority?: number | undefined;
};

export type SpeechCreatorInput = {
  speech_personality: string;
  speech_traits: string;
  speech_examples: string;
  speech_forbidden?: string;
  speech_contextual_registers?: SpeechContextualRegister[];
};

/** 상황별 말투 레지스터 전체 글자 수 (별도 500자 한도) */
export function speechContextualCharCount(
  registers: SpeechContextualRegister[] | undefined
): number {
  return (registers ?? []).reduce(
    (sum, register) =>
      sum +
      register.label.length +
      register.condition.length +
      register.style.length +
      register.examples.length,
    0
  );
}

/**
 * AI 학습 10k 합산에 포함되는 말투 글자 수.
 * 대사 예시·상황별 말투·금지 말투는 제외(필드별 별도 한도).
 */
export function speechCreatorCharCount(input: SpeechCreatorInput): number {
  return input.speech_personality.length + input.speech_traits.length;
}

function normalizeDialogueLine(line: string): string {
  return line
    .replace(/^[\s\-*]*(?:캐릭터|character|char)\s*[:：]\s*/i, "")
    .replace(/^["「『""]|["」』""]$/g, "")
    .trim();
}

/** 캐릭터 대사 줄만 추출 (유저: 줄 제외) */
export function extractCharacterDialogueLines(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];

  for (const raw of lines) {
    if (/^[\s\-*]*(?:유저|user|나|당신)\s*[:：]/i.test(raw)) continue;

    const line = normalizeDialogueLine(raw);
    if (line.length < 2) continue;

    const quoted = line.match(/^["「『]([^"」』]{2,300})["」』]$/);
    if (quoted) {
      out.push(quoted[1].trim());
      continue;
    }

    if (!/^[\[\]#]/.test(line)) {
      out.push(line);
    }
  }

  return [...new Set(out)].slice(0, 24);
}

/** 예시 대사에서 종결 어미 패턴 추출 — AI가 복사할 앵커 */
export function extractEndingAnchors(lines: string[]): string[] {
  const endings = new Set<string>();
  const endingRe =
    /(?:습니다|십시오|하세요|합니다|이오|하오|하옵|하구|하네|하군|하리|하리오|구나|구려|니까|니오|소|오|요|다|네|지|죠|군요|래요|어요|가요|까요|습니까)$/;

  for (const line of lines) {
    const cleaned = line.replace(/^["「『]|["」』]$/g, "").replace(/[.!?…]+$/g, "").trim();
    if (!cleaned) continue;

    const m = cleaned.match(endingRe);
    if (m) endings.add(m[0]);

    if (cleaned.length >= 3) {
      const tail3 = cleaned.slice(-3);
      if (/[가-힣]/.test(tail3)) endings.add(tail3);
    }
  }

  return [...endings].filter((e) => e.length >= 1).slice(0, 10);
}

function parseForbiddenLines(text: string | undefined): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);
}

const SPEECH_CONSISTENCY_BLOCK = `[SPEECH CONSISTENCY]
Dialogue examples are the strongest reference for demonstrated speech features such as wording, endings, register, vocabulary, and rhythm.
Do not infer unrelated personality, verbosity, emotional restraint, behavior, or relationship traits solely from the length or content of a few example lines.
When examples conflict with abstract style descriptions, examples take priority only for the speech features they actually demonstrate.
Character canon, personality, current emotion, relationship, and scene context still determine what the character says and how much they naturally speak.`;

const CONTEXTUAL_REGISTER_DATA_OPEN = "[상황별 말투 데이터]";

function normalizeContextualRegisters(raw: unknown): SpeechContextualRegister[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): SpeechContextualRegister | null => {
      if (!item || typeof item !== "object") return null;
      const register = item as Record<string, unknown>;
      return {
        label: String(register.label ?? "").trim().slice(0, 40),
        condition: String(register.condition ?? "").trim().slice(0, 160),
        style: String(register.style ?? "").trim().slice(0, 240),
        examples: String(register.examples ?? "").trim().slice(0, 600),
        priority: Number.isFinite(Number(register.priority))
          ? Math.max(0, Math.min(100, Number(register.priority)))
          : undefined,
      };
    })
    .filter((register): register is SpeechContextualRegister =>
      Boolean(register && (register.label || register.condition || register.style || register.examples))
    )
    .slice(0, 8);
}

function splitExampleLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function formatContextualRegisters(registers: SpeechContextualRegister[]): string {
  if (registers.length === 0) return "";
  const lines = [
    "[상황별 말투 레지스터]",
    "현재 장면의 관계/장소/상대에 맞는 말투 레지스터를 선택한다.",
    "상황별 말투가 적용되지 않으면 기본 말투를 사용한다.",
    "유저의 대사나 행동을 대신 작성하지 않는다.",
    "",
  ];

  registers.forEach((register, index) => {
    const label = register.label || `register_${index + 1}`;
    lines.push(`${index + 1}. ${label}`);
    if (register.condition) lines.push(`- 적용 조건: ${register.condition}`);
    if (register.style) lines.push(`- 말투: ${register.style}`);
    const examples = splitExampleLines(register.examples);
    if (examples.length > 0) {
      lines.push(`- 예시: ${examples.map((example) => `"${normalizeDialogueLine(example)}"`).join(", ")}`);
    }
    if (register.priority != null) lines.push(`- 우선도: ${register.priority}`);
    lines.push("");
  });

  lines.push(CONTEXTUAL_REGISTER_DATA_OPEN);
  lines.push(JSON.stringify(registers));
  return lines.join("\n").trim();
}

/** API·DB용 example_dialog (파서 speech 청크용) */
export function composeExampleDialog(input: SpeechCreatorInput): string {
  const parts: string[] = [];
  const contextualRegisters = normalizeContextualRegisters(input.speech_contextual_registers);
  if (input.speech_examples.trim()) {
    const lines = extractCharacterDialogueLines(input.speech_examples);
    const body = lines.length > 0 ? lines.join("\n") : input.speech_examples.trim();
    parts.push(`[예시 대사]\n${body}`);
    parts.push(SPEECH_CONSISTENCY_BLOCK);
  }
  const contextual = formatContextualRegisters(contextualRegisters);
  if (contextual) parts.push(contextual);
  if (input.speech_traits.trim()) {
    parts.push(
      formatSpeechSectionAsMetadata("[말투 — 특징]", input.speech_traits.trim())
    );
  }
  if (input.speech_forbidden?.trim()) {
    parts.push(`[dialogue_avoid — generation only, never narrate]\n${input.speech_forbidden.trim()}`);
  }
  if (input.speech_personality.trim()) {
    parts.push(
      formatSpeechSectionAsMetadata("[말투 — 성격]", input.speech_personality.trim())
    );
  }
  return parts.join("\n\n");
}

/** speech_profile JSON에 저장할 크리에이터 명시 필드 */
export function buildCreatorSpeechProfilePartial(
  input: SpeechCreatorInput,
  charName: string
): Partial<SpeechProfile> {
  const personality = input.speech_personality.trim();
  const traits = input.speech_traits.trim();
  const contextual = formatContextualRegisters(
    normalizeContextualRegisters(input.speech_contextual_registers)
  );
  const charLines = extractCharacterDialogueLines(input.speech_examples);
  const ending_anchors = extractEndingAnchors(charLines);
  const customForbidden = parseForbiddenLines(input.speech_forbidden);

  return {
    charName,
    creator_personality: personality || undefined,
    creator_speech_traits: [traits, contextual].filter(Boolean).join("\n\n") || undefined,
    speech_tone: [traits, contextual, personality].filter(Boolean).join("\n\n") || "제작자 정의 말투",
    dialogue_examples: charLines,
    ending_anchors: ending_anchors.length > 0 ? ending_anchors : undefined,
    forbidden_speech_patterns: customForbidden.length > 0 ? customForbidden : undefined,
  };
}

export function validateSpeechCreatorInput(input: SpeechCreatorInput): string | null {
  if (input.speech_examples.length > SPEECH_EXAMPLES_LIMIT) {
    return `캐릭터 대사 예시는 ${SPEECH_EXAMPLES_LIMIT.toLocaleString()}자 이하여야 합니다.`;
  }
  if ((input.speech_forbidden?.length ?? 0) > SPEECH_FORBIDDEN_LIMIT) {
    return `금지 말투는 ${SPEECH_FORBIDDEN_LIMIT.toLocaleString()}자 이하여야 합니다.`;
  }
  if (speechContextualCharCount(input.speech_contextual_registers) > SPEECH_CONTEXTUAL_LIMIT) {
    return `상황별 말투는 합쳐서 ${SPEECH_CONTEXTUAL_LIMIT.toLocaleString()}자 이하여야 합니다.`;
  }
  return null;
}

/** 구 API(example_dialog 단일 필드) 호환 */
export function speechCreatorFromLegacyExampleDialog(exampleDialog: string): SpeechCreatorInput {
  const text = exampleDialog.trim();
  if (!text) {
    return {
      speech_personality: "",
      speech_traits: "",
      speech_examples: "",
      speech_forbidden: "",
      speech_contextual_registers: [],
    };
  }

  const personality = extractSection(text, /\[말투\s*[—\-·]\s*성격\]/i);
  const traits = extractSection(text, /\[말투\s*[—\-·]\s*특징\]/i);
  const examples = extractSection(text, /\[예시\s*(?:대화|대사)\]/i);
  const forbidden = extractSection(text, /\[(?:금지\s*말투|dialogue_avoid[^\]]*)\]/i);
  const contextualRegisters = extractContextualRegisterData(text);
  const metadataSpeech = extractSpeechMetadataNotes(text);

  if (personality || traits || examples || forbidden || contextualRegisters.length > 0 || metadataSpeech) {
    return {
      speech_personality: personality || metadataSpeech,
      speech_traits: traits,
      speech_examples: examples,
      speech_forbidden: forbidden,
      speech_contextual_registers: contextualRegisters,
    };
  }

  return {
    speech_personality: "",
    speech_traits: "",
    speech_examples: text,
    speech_forbidden: "",
    speech_contextual_registers: [],
  };
}

function extractSection(text: string, headerRe: RegExp): string {
  const match = text.match(headerRe);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const rest = text.slice(start).replace(/^\s*\n?/, "");
  const nextHeader = rest.search(/\n\[(?:말투|예시|금지|SPEECH|상황별|dialogue_avoid)/i);
  const body = nextHeader >= 0 ? rest.slice(0, nextHeader) : rest;
  return body.trim();
}

function extractSpeechMetadataNotes(text: string): string {
  const headerRe = /(?:^|\n)\[[^\]\n]*GENERATION METADATA[^\]\n]*\]/g;
  const matches = [...text.matchAll(headerRe)];
  if (matches.length === 0) return "";

  const notes: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[i + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    const defaultRegister = block.match(/default_register:\s*([^\n]+)/i)?.[1]?.trim();

    for (const line of block.split(/\n+/)) {
      const trimmed = line.trim();
      const bullet = trimmed.match(/^-\s*(.+)$/);
      if (!bullet) continue;
      const value = bullet[1].trim();
      if (!value) continue;
      if (/^[^\s]+(?:\s*[-→]\s*[^\s]+)?$/.test(value) && value.length <= 12) continue;
      notes.push(value);
    }

    if (notes.length === 0 && defaultRegister) {
      notes.push(`기본 말투: ${defaultRegister}`);
    }
  }

  return [...new Set(notes)].join("\n").trim();
}

function extractContextualRegisterData(text: string): SpeechContextualRegister[] {
  const markerIndex = text.indexOf(CONTEXTUAL_REGISTER_DATA_OPEN);
  if (markerIndex < 0) return [];
  const raw = text.slice(markerIndex + CONTEXTUAL_REGISTER_DATA_OPEN.length).trim();
  const firstLine = raw.split(/\n/)[0]?.trim() ?? "";
  try {
    return normalizeContextualRegisters(JSON.parse(firstLine));
  } catch {
    return [];
  }
}

export function parseSpeechCreatorFromBody(body: Record<string, unknown>): SpeechCreatorInput {
  const hasStructured =
    typeof body.speech_personality === "string" ||
    typeof body.speech_traits === "string" ||
    typeof body.speech_examples === "string" ||
    Array.isArray(body.speech_contextual_registers);

  if (hasStructured) {
    return {
      speech_personality: String(body.speech_personality ?? "").trim(),
      speech_traits: String(body.speech_traits ?? "").trim(),
      speech_examples: String(body.speech_examples ?? "").trim(),
      speech_forbidden: String(body.speech_forbidden ?? "").trim(),
      speech_contextual_registers: normalizeContextualRegisters(body.speech_contextual_registers),
    };
  }

  return speechCreatorFromLegacyExampleDialog(String(body.example_dialog ?? ""));
}
