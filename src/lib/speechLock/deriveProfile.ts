import type { CharacterChunk } from "@/types";
import type {
  EraStyle,
  SocialClass,
  SpeechFormality,
  SpeechProfile,
  VocabularyStyle,
} from "./types";
import {
  CASUAL_DIALOGUE_ENDINGS,
  ERA_KEYWORDS,
  FORMALITY_KEYWORDS,
  GLOBAL_FORBIDDEN_SPEECH,
  SOCIAL_CLASS_KEYWORDS,
  TONE_KEYWORDS,
  isHistoricalEra,
  vocabularyForClass,
} from "./patterns";
import {
  extractDialogueLinesForProfile,
  extractEndingAnchors,
  speechCreatorFromLegacyExampleDialog,
  type SpeechContextualRegister,
} from "@/lib/speechCreatorFields";

export type DeriveSpeechProfileInput = {
  charName: string;
  chunks: CharacterChunk[];
  exampleDialog?: string | null;
  world?: string | null;
  storedProfile?: Partial<SpeechProfile> | null;
};

export type CreatorFormalityIntent =
  | "always_formal"
  | "always_informal"
  | "situational"
  | "unspecified";

export const DERIVED_BANMAL_BAN = "반말·하대·친구 말투";
export const DERIVED_INTRA_TURN_SWITCH_BAN = "말투·존댓말 급변 (한 턴 내 격식 ↔ 반말 전환)";
export const DERIVED_SAME_ADDRESSEE_SWITCH_BAN = "같은 상대에게 이유 없이 격식 ↔ 반말 전환";
export const DERIVED_NOBLE_CASUAL_BAN = "신분에 맞지 않는 과도한 친근·반말";
const DERIVED_MEME_BAN = "캐릭터 성격과 무관한 유행어·밈";
const DERIVED_HISTORICAL_SLANG_BAN = "현대 구어·슬랭·밈 (ㅋㅋ, 레전드, 헐, 대박 등)";
const DERIVED_HISTORICAL_CASUAL_HONORIFIC_BAN = "현대식 캐주얼 존댓말 (~요체 남발, 친구 말투)";
const DERIVED_HISTORICAL_HYBRID_BAN = "혼합 존댓말 (~입니다요, ~하세요요, ~님께서요, ~하신님)";
const DERIVED_HISTORICAL_FANTASY_BAN = "AI 창작 '판타지체' — 예시 대사 어미를 복사할 것";
const DERIVED_NOBLE_COMMONER_BAN = "백성·하인 말투 (거친 반말, '~이놈', '~같은 놈')";

/**
 * 파생 금지 라벨 전체. 저장된 profile에서 "파생"으로 확정할 수 있는 항목만 현재 설정에 맞게 재생성한다.
 * 이 목록에 없는 라벨은 출처를 증명할 수 없으므로 삭제하지 않는다.
 */
const DERIVED_FORBIDDEN_LABELS: ReadonlySet<string> = new Set([
  ...GLOBAL_FORBIDDEN_SPEECH.map((g) => g.label),
  DERIVED_BANMAL_BAN,
  DERIVED_INTRA_TURN_SWITCH_BAN,
  DERIVED_SAME_ADDRESSEE_SWITCH_BAN,
  DERIVED_NOBLE_CASUAL_BAN,
  DERIVED_MEME_BAN,
  DERIVED_HISTORICAL_SLANG_BAN,
  DERIVED_HISTORICAL_CASUAL_HONORIFIC_BAN,
  DERIVED_HISTORICAL_HYBRID_BAN,
  DERIVED_HISTORICAL_FANTASY_BAN,
  DERIVED_NOBLE_COMMONER_BAN,
]);

type RegisterFamily = "formal" | "informal";

type RegisterStatement = {
  families: RegisterFamily[];
  /** 조건·상대·상황이 붙은 진술 — 전역 고정(always_*)의 근거가 되지 못한다 */
  conditional: boolean;
};

const REGISTER_TOKEN_RE =
  /(반말|하대|존댓말)(?:을|를|은|는|이|가|로|만)?\s*(안\s|아니|금지|하지\s*않|쓰지\s*않|쓰지\s*말|하지\s*말|사용하지)?/g;
const FORMAL_CUE_RE = /하십시|다나까|하오체|하오(?![가-힣])|경어|높임|공손/;
const CONDITIONAL_SCOPE_RE =
  /에서는|에서도|에게는|에게도|에게|한테|에는|때는|때에는|때만|할\s*때|일\s*때|경우|상대|앞에서|→/;
const CONTEXT_LABEL_RE = /^[^:：]{2,24}[:：]\s*\S/;
const FIELD_HEADER_LABEL_RE = /^(?:구어체|어조|어투|말투|말버릇|특징|성격|어휘|호칭|종결|기본|default)\s*[:：]/i;
const EXPLICIT_GLOBAL_RE = /항상|언제나|누구에게나|어떤\s*상황에서도|무조건|모든\s*상대/;
const NON_INSTRUCTION_LINE_RE =
  /^(?:거의\s*안\s*씀|금지|dialogue_avoid|register_by_context|default_register|dialogue_examples|Apply only when writing|\[|\{|["“「『]|[\s\-*]*(?:유저|user|캐릭터|character)\s*[:：])/i;
const CONTEXTUAL_BLOCK_MARKER = "[상황별 말투 레지스터]";

function collectText(chunks: CharacterChunk[], categories?: CharacterChunk["category"][]): string {
  const filtered = categories ? chunks.filter((c) => categories.includes(c.category)) : chunks;
  return filtered.map((c) => c.content).join("\n");
}

function inferSocialClass(text: string): SocialClass {
  for (const { re, cls } of SOCIAL_CLASS_KEYWORDS) {
    if (re.test(text)) return cls;
  }
  return "unspecified";
}

function inferEraStyle(text: string): EraStyle {
  for (const { re, era } of ERA_KEYWORDS) {
    if (re.test(text)) return era;
  }
  return "unspecified";
}

function registerFamiliesOf(text: string): RegisterFamily[] {
  const families = new Set<RegisterFamily>();
  const remainder = text.replace(
    REGISTER_TOKEN_RE,
    (_match, token: string, negation: string | undefined) => {
      const informalToken = token !== "존댓말";
      const negated = Boolean(negation);
      families.add(informalToken !== negated ? "informal" : "formal");
      return " ";
    }
  );
  if (FORMAL_CUE_RE.test(remainder)) families.add("formal");
  return [...families];
}

function collectRegisterStatements(
  freeText: string,
  registers: SpeechContextualRegister[] | undefined
): RegisterStatement[] {
  const statements: RegisterStatement[] = [];
  for (const raw of freeText.split(/\n+/)) {
    const line = raw.trim();
    if (!line || NON_INSTRUCTION_LINE_RE.test(line)) continue;
    for (const sentence of line.split(/(?<=[.!?。])\s+/)) {
      const families = registerFamiliesOf(sentence);
      if (families.length === 0) continue;
      const scoped =
        CONDITIONAL_SCOPE_RE.test(sentence) ||
        (CONTEXT_LABEL_RE.test(sentence) && !FIELD_HEADER_LABEL_RE.test(sentence));
      statements.push({
        families,
        conditional: scoped && !EXPLICIT_GLOBAL_RE.test(sentence),
      });
    }
  }
  for (const register of registers ?? []) {
    const families = registerFamiliesOf(
      [register.label, register.condition, register.style].filter(Boolean).join(" ")
    );
    if (families.length > 0) statements.push({ families, conditional: true });
  }
  return statements;
}

/**
 * 제작자 입력에서 말투 고정 강도를 판정한다.
 * - 존댓말·반말 진술이 둘 다 있으면 situational.
 * - 한 쪽만 있어도 조건·상대·상황이 붙은 진술뿐이면 전역 범위가 확정되지 않았으므로 situational.
 * - 조건 없는 단일 진술(또는 "항상/언제나")일 때만 always_formal / always_informal.
 * - "친근·캐주얼" 같은 어조 단어는 반말 단서가 아니다.
 */
export function resolveCreatorFormalityIntent(
  creatorText: string,
  registers?: SpeechContextualRegister[]
): CreatorFormalityIntent {
  const statements = collectRegisterStatements(creatorText, registers);
  const families = new Set(statements.flatMap((statement) => statement.families));
  if (families.size === 0) return "unspecified";
  if (families.size > 1) return "situational";
  const [family] = [...families];
  const globalConfirmed = statements.some((statement) => !statement.conditional);
  if (!globalConfirmed) return "situational";
  return family === "formal" ? "always_formal" : "always_informal";
}

function resolveSpeechFormality(
  intent: CreatorFormalityIntent,
  socialClass: SocialClass,
  fallbackText: string
): SpeechFormality {
  switch (intent) {
    case "always_formal":
      return /고어|옛말|고풍|아뢰|하옵|하오|이옵/.test(fallbackText) ? "archaic_formal" : "formal";
    case "always_informal":
      return "informal";
    case "situational":
      return "semi_formal";
    case "unspecified":
      for (const { re, formality } of FORMALITY_KEYWORDS) {
        if (re.test(fallbackText)) return formality;
      }
      if (socialClass === "royalty" || socialClass === "nobility") return "formal";
      if (socialClass === "commoner" || socialClass === "outcast") return "semi_formal";
      if (socialClass === "modern") return "informal";
      return "semi_formal";
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

function inferTone(text: string): string {
  for (const { re, tone } of TONE_KEYWORDS) {
    if (re.test(text)) return tone;
  }
  return "설정에 맞는 일관된 말투";
}

function resolveDialogueExamples(
  exampleDialog: string,
  speechText: string,
  stored: Partial<SpeechProfile> | null | undefined
): string[] {
  const parsed = speechCreatorFromLegacyExampleDialog(exampleDialog);
  const fromCreator = extractDialogueLinesForProfile(parsed.speech_examples);
  if (fromCreator.length > 0) return fromCreator.slice(0, 20);
  const fromStored = extractDialogueLinesForProfile((stored?.dialogue_examples ?? []).join("\n"));
  if (fromStored.length > 0) return fromStored.slice(0, 20);
  const legacy = extractDialogueLinesForProfile(exampleDialog);
  if (legacy.length > 0) return legacy.slice(0, 20);
  return extractDialogueLinesForProfile(`${exampleDialog}\n${speechText}`).slice(0, 12);
}

function buildDerivedForbiddenList(
  socialClass: SocialClass,
  era: EraStyle,
  formality: SpeechFormality,
  intent: CreatorFormalityIntent
): string[] {
  const labels = new Set<string>(GLOBAL_FORBIDDEN_SPEECH.map((g) => g.label));
  labels.add(intent === "situational" ? DERIVED_SAME_ADDRESSEE_SWITCH_BAN : DERIVED_INTRA_TURN_SWITCH_BAN);
  labels.add(DERIVED_MEME_BAN);

  if (isHistoricalEra(era) || socialClass === "royalty" || socialClass === "nobility") {
    labels.add(DERIVED_HISTORICAL_SLANG_BAN);
    labels.add(DERIVED_HISTORICAL_CASUAL_HONORIFIC_BAN);
    labels.add(DERIVED_HISTORICAL_HYBRID_BAN);
    labels.add(DERIVED_HISTORICAL_FANTASY_BAN);
  }

  const informalAllowed = intent === "situational" || intent === "always_informal";
  if (socialClass === "royalty" || socialClass === "nobility") {
    labels.add(DERIVED_NOBLE_COMMONER_BAN);
    if (!informalAllowed) labels.add(DERIVED_NOBLE_CASUAL_BAN);
  }
  if ((formality === "formal" || formality === "archaic_formal") && !informalAllowed) {
    labels.add(DERIVED_BANMAL_BAN);
  }
  return [...labels];
}

/**
 * 제작자 명시 금지(`[dialogue_avoid]`)는 전부 유지한다. 저장된 profile의 항목은 파생 상수로 증명되는 것만
 * 현재 설정에 맞게 다시 만들고, 출처를 알 수 없는 항목은 그대로 둔다.
 */
function mergeForbiddenPatterns(
  derived: string[],
  stored: string[] | undefined,
  explicit: string[]
): string[] {
  const explicitSet = new Set(explicit);
  const storedKept = (stored ?? [])
    .map((label) => label.trim())
    .filter((label) => label && (explicitSet.has(label) || !DERIVED_FORBIDDEN_LABELS.has(label)));
  return [...new Set([...derived, ...storedKept, ...explicit])];
}

function bansCasualSpeech(label: string): boolean {
  return label === DERIVED_BANMAL_BAN || /^(?:반말|하대)(?:\s|·|$)|반말\s*(?:사용\s*)?금지/.test(label);
}

/** 삭제하지 않고 표면화한다 — 제작자 입력끼리 충돌하는 곳. */
function detectRegisterConflicts(
  profile: SpeechProfile,
  explicitForbidden: string[],
  intent: CreatorFormalityIntent
): string[] {
  const conflicts: string[] = [];
  const casualExamples = profile.dialogue_examples.filter((line) => CASUAL_DIALOGUE_ENDINGS.test(line));
  const informalAllowed = intent === "situational" || intent === "always_informal";
  for (const label of explicitForbidden.filter(bansCasualSpeech)) {
    if (informalAllowed) {
      conflicts.push(`금지 말투 "${label}" ↔ 제작자가 명시한 반말/상황별 레지스터`);
    } else if (casualExamples.length > 0) {
      conflicts.push(`금지 말투 "${label}" ↔ 반말 어미 예시 대사 "${casualExamples[0]}"`);
    }
  }
  const formalLocked = profile.speech_formality === "formal" || profile.speech_formality === "archaic_formal";
  if (formalLocked && casualExamples.length > 0) {
    conflicts.push(`존댓말 고정 ↔ 반말 어미 예시 대사 "${casualExamples[0]}"`);
  }
  return [...new Set(conflicts)];
}

function buildLockSummary(profile: Omit<SpeechProfile, "lockSummary">): string {
  const tone =
    profile.creator_speech_traits?.trim() ||
    profile.speech_tone ||
    profile.creator_personality?.trim() ||
    "제작자 정의";
  return [
    `${profile.charName}: ${tone}`,
    profile.creator_personality ? `성격=${profile.creator_personality.slice(0, 40)}` : null,
    `격식=${profile.speech_formality}`,
    profile.ending_anchors?.length ? `대표어미=${profile.ending_anchors.slice(0, 4).join("/")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function parseForbiddenLines(text: string | undefined): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripContextualBlock(text: string | undefined): string {
  if (!text) return "";
  const index = text.indexOf(CONTEXTUAL_BLOCK_MARKER);
  return (index >= 0 ? text.slice(0, index) : text).trim();
}

/**
 * 제작자 말투 입력 수집. 구조화 필드(성격/특징/상황별 레지스터)가 있으면 그것이 우선이며,
 * 청크 말투 텍스트는 구조화 입력이 전혀 없을 때만 쓴다(예시 대사·메타데이터가 단서로 섞이지 않게).
 */
function joinCreatorSpeechText(
  speechText: string,
  exampleDialog: string,
  stored?: Partial<SpeechProfile> | null
): {
  freeText: string;
  corpus: string;
  registers: SpeechContextualRegister[];
  explicitForbidden: string[];
} {
  const parsed = speechCreatorFromLegacyExampleDialog(exampleDialog);
  const registers = parsed.speech_contextual_registers ?? [];
  const structured = [
    parsed.speech_personality,
    parsed.speech_traits,
    stripContextualBlock(stored?.creator_personality),
    stripContextualBlock(stored?.creator_speech_traits),
  ].filter((part) => part.trim());
  const freeText = (
    structured.length > 0
      ? structured
      : [stripContextualBlock(stored?.speech_tone), speechText].filter((part) => part.trim())
  ).join("\n");
  const registerText = registers
    .map((register) => [register.label, register.condition, register.style].filter(Boolean).join(" "))
    .join("\n");
  return {
    freeText,
    corpus: [freeText, registerText].filter((part) => part.trim()).join("\n"),
    registers,
    explicitForbidden: parseForbiddenLines(parsed.speech_forbidden),
  };
}

export function deriveSpeechProfile(input: DeriveSpeechProfileInput): SpeechProfile {
  const speechText = collectText(input.chunks, ["speech"]);
  const identityText = collectText(input.chunks, ["identity", "personality"]);
  const worldText = [input.world ?? "", collectText(input.chunks, ["world"])].join("\n");
  const corpus = [speechText, identityText, worldText].join("\n");
  const stored = input.storedProfile;
  const exampleDialog = input.exampleDialog ?? "";

  const social_class = inferSocialClass(corpus);
  const era_style = inferEraStyle(corpus);
  const creator = joinCreatorSpeechText(speechText, exampleDialog, stored);
  const intent = resolveCreatorFormalityIntent(creator.freeText, creator.registers);
  const speech_formality = resolveSpeechFormality(intent, social_class, creator.corpus || corpus);
  const speech_tone =
    stored?.creator_speech_traits?.trim() ||
    stored?.speech_tone?.trim() ||
    inferTone(speechText || identityText);
  const vocabulary_style: VocabularyStyle = vocabularyForClass(social_class);
  const dialogue_examples = resolveDialogueExamples(exampleDialog, speechText, stored);
  const ending_anchors =
    dialogue_examples.length > 0 ? extractEndingAnchors(dialogue_examples) : undefined;

  const base: SpeechProfile = {
    charName: input.charName.trim() || "캐릭터",
    speech_tone,
    speech_formality,
    vocabulary_style,
    social_class,
    era_style,
    forbidden_speech_patterns: mergeForbiddenPatterns(
      buildDerivedForbiddenList(social_class, era_style, speech_formality, intent),
      stored?.forbidden_speech_patterns,
      creator.explicitForbidden
    ),
    dialogue_examples,
    ending_anchors,
    creator_personality: stored?.creator_personality?.trim() || undefined,
    creator_speech_traits: stored?.creator_speech_traits?.trim() || undefined,
    lockSummary: "",
  };
  const parsed = speechCreatorFromLegacyExampleDialog(exampleDialog);
  if (!base.creator_personality && parsed.speech_personality.trim()) {
    base.creator_personality = parsed.speech_personality.trim();
  }
  if (!base.creator_speech_traits && parsed.speech_traits.trim()) {
    base.creator_speech_traits = parsed.speech_traits.trim();
  }
  const conflicts = detectRegisterConflicts(base, creator.explicitForbidden, intent);
  if (conflicts.length > 0) base.register_conflicts = conflicts;
  base.lockSummary = buildLockSummary(base);
  return base;
}

export function parseStoredSpeechProfile(raw: unknown): Partial<SpeechProfile> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return parseStoredSpeechProfile(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const partial: Partial<SpeechProfile> = {};
  if (typeof o.speech_tone === "string") partial.speech_tone = o.speech_tone;
  if (typeof o.creator_personality === "string") partial.creator_personality = o.creator_personality;
  if (typeof o.creator_speech_traits === "string") partial.creator_speech_traits = o.creator_speech_traits;
  if (typeof o.speech_formality === "string") partial.speech_formality = o.speech_formality as SpeechFormality;
  if (typeof o.vocabulary_style === "string") partial.vocabulary_style = o.vocabulary_style as VocabularyStyle;
  if (typeof o.social_class === "string") partial.social_class = o.social_class as SocialClass;
  if (typeof o.era_style === "string") partial.era_style = o.era_style as EraStyle;
  if (Array.isArray(o.forbidden_speech_patterns)) {
    partial.forbidden_speech_patterns = o.forbidden_speech_patterns.filter((x) => typeof x === "string");
  }
  if (Array.isArray(o.dialogue_examples)) {
    partial.dialogue_examples = o.dialogue_examples.filter((x) => typeof x === "string");
  }
  if (Array.isArray(o.ending_anchors)) {
    partial.ending_anchors = o.ending_anchors.filter((x) => typeof x === "string");
  }
  if (Array.isArray(o.register_conflicts)) {
    partial.register_conflicts = o.register_conflicts.filter((x) => typeof x === "string");
  }
  return Object.keys(partial).length > 0 ? partial : null;
}

export function serializeSpeechProfile(profile: SpeechProfile): string {
  return JSON.stringify({
    speech_tone: profile.speech_tone,
    creator_personality: profile.creator_personality,
    creator_speech_traits: profile.creator_speech_traits,
    speech_formality: profile.speech_formality,
    vocabulary_style: profile.vocabulary_style,
    social_class: profile.social_class,
    era_style: profile.era_style,
    forbidden_speech_patterns: profile.forbidden_speech_patterns,
    dialogue_examples: profile.dialogue_examples,
    ending_anchors: profile.ending_anchors,
    register_conflicts: profile.register_conflicts,
  });
}
