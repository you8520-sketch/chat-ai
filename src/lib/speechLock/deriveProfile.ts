import type { CharacterChunk } from "@/types";
import type {
  EraStyle,
  SocialClass,
  SpeechFormality,
  SpeechProfile,
  VocabularyStyle,
} from "./types";
import {
  ERA_KEYWORDS,
  FORMALITY_KEYWORDS,
  GLOBAL_FORBIDDEN_SPEECH,
  SOCIAL_CLASS_KEYWORDS,
  TONE_KEYWORDS,
  isHistoricalEra,
  vocabularyForClass,
} from "./patterns";
import {
  extractCharacterDialogueLines,
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

const ALWAYS_INFORMAL_RE =
  /항상\s*반말|반말만\s*(?:쓴|사용|유지)|반말(?:을|로)\s*만|존댓말(?:을|를|은|이)?\s*(?:안\s*쓰|쓰지\s*않|하지\s*않|금지|하지\s*말)/;
const ALWAYS_FORMAL_RE =
  /항상\s*존댓|존댓말만\s*(?:쓴|사용|유지)|존댓말(?:을|로)\s*만|반말(?:을|를|은|이)?\s*(?:안\s*쓰|쓰지\s*않|하지\s*않|금지|하지\s*말)/;
const INFORMAL_CUE_RE = /반말|친근|캐주얼|편한\s*말/;
const FORMAL_CUE_RE = /존댓|하십시|합니다|입니다|격식|공손|경어|높임|하오|하십시오/;

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

function stripNegatedRegisterMentions(text: string): string {
  return text
    .replace(
      /반말(?:을|를|은|이|를)?\s*(?:안\s*|아니|금지|하지\s*않|쓰지\s*않|하지\s*말|쓰지\s*말)[가-힣\s]*/g,
      " "
    )
    .replace(
      /존댓말(?:을|를|은|이|를)?\s*(?:안\s*|아니|금지|하지\s*않|쓰지\s*않|하지\s*말|쓰지\s*말)[가-힣\s]*/g,
      " "
    );
}

function stripNonInstructionRegisterLines(text: string): string {
  return text
    .split(/\n+/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^(?:거의\s*안\s*씀|금지|dialogue_avoid)/i.test(trimmed)) return false;
      if (/^\[(?:금지\s*말투|dialogue_avoid)/i.test(trimmed)) return false;
      return true;
    })
    .join("\n");
}

function creatorFormalityCorpus(text: string): string {
  return stripNegatedRegisterMentions(stripNonInstructionRegisterLines(text));
}

function registerStyleFamily(style: string): "formal" | "informal" | "unknown" {
  const stripped = creatorFormalityCorpus(style);
  const hasFormal = FORMAL_CUE_RE.test(stripped);
  const hasInformal = INFORMAL_CUE_RE.test(stripped);
  if (hasFormal && !hasInformal) return "formal";
  if (hasInformal && !hasFormal) return "informal";
  if (hasFormal && hasInformal) return "unknown";
  return "unknown";
}

function contextualRegistersAreMixed(registers: SpeechContextualRegister[] | undefined): boolean {
  if (!registers?.length) return false;
  const families = new Set<"formal" | "informal">();
  for (const register of registers) {
    const blob = `${register.condition} ${register.style} ${register.examples}`;
    const family = registerStyleFamily(blob);
    if (family === "formal" || family === "informal") families.add(family);
    if (FORMAL_CUE_RE.test(creatorFormalityCorpus(blob)) && INFORMAL_CUE_RE.test(creatorFormalityCorpus(blob))) {
      return true;
    }
  }
  return families.size > 1;
}

export function resolveCreatorFormalityIntent(
  creatorText: string,
  registers?: SpeechContextualRegister[]
): CreatorFormalityIntent {
  const corpus = creatorFormalityCorpus(creatorText);
  const alwaysInformal = ALWAYS_INFORMAL_RE.test(creatorText);
  const alwaysFormal = ALWAYS_FORMAL_RE.test(creatorText);
  if (alwaysFormal && !alwaysInformal) return "always_formal";
  if (alwaysInformal && !alwaysFormal) return "always_informal";
  if (contextualRegistersAreMixed(registers)) return "situational";

  const hasFormal = FORMAL_CUE_RE.test(corpus);
  const hasInformal = INFORMAL_CUE_RE.test(corpus);
  if (hasFormal && hasInformal) return "situational";
  if (hasFormal) return "always_formal";
  if (hasInformal) return "always_informal";
  return "unspecified";
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

function extractDialogueExamples(exampleDialog: string, speechText: string): string[] {
  const parsed = speechCreatorFromLegacyExampleDialog(exampleDialog);
  const preferred = parsed.speech_examples.trim() || exampleDialog;
  const fromCreator = extractCharacterDialogueLines(preferred);
  if (fromCreator.length > 0) return fromCreator.slice(0, 20);
  return extractCharacterDialogueLines(`${exampleDialog}\n${speechText}`).slice(0, 12);
}

function isContradictoryDerivedForbid(label: string, intent: CreatorFormalityIntent): boolean {
  if (intent === "situational" || intent === "always_informal") {
    if (label === DERIVED_BANMAL_BAN || label === DERIVED_NOBLE_CASUAL_BAN) return true;
  }
  if (intent === "situational" && label === DERIVED_INTRA_TURN_SWITCH_BAN) return true;
  return false;
}

function buildForbiddenList(
  socialClass: SocialClass,
  era: EraStyle,
  formality: SpeechFormality,
  intent: CreatorFormalityIntent,
  custom: string[] = []
): string[] {
  const labels = new Set<string>(GLOBAL_FORBIDDEN_SPEECH.map((g) => g.label));
  if (intent === "situational") {
    labels.add(DERIVED_SAME_ADDRESSEE_SWITCH_BAN);
  } else {
    labels.add(DERIVED_INTRA_TURN_SWITCH_BAN);
  }
  labels.add("캐릭터 성격과 무관한 유행어·밈");

  if (isHistoricalEra(era) || socialClass === "royalty" || socialClass === "nobility") {
    labels.add("현대 구어·슬랭·밈 (ㅋㅋ, 레전드, 헐, 대박 등)");
    labels.add("현대식 캐주얼 존댓말 (~요체 남발, 친구 말투)");
    labels.add("혼합 존댓말 (~입니다요, ~하세요요, ~님께서요, ~하신님)");
    labels.add("AI 창작 '판타지체' — 예시 대사 어미를 복사할 것");
  }

  if (socialClass === "royalty" || socialClass === "nobility") {
    labels.add("백성·하인 말투 (거친 반말, '~이놈', '~같은 놈')");
    if (intent !== "situational" && intent !== "always_informal") {
      labels.add(DERIVED_NOBLE_CASUAL_BAN);
    }
  }

  if (
    (formality === "formal" || formality === "archaic_formal") &&
    intent !== "situational" &&
    intent !== "always_informal"
  ) {
    labels.add(DERIVED_BANMAL_BAN);
  }

  for (const c of custom) {
    const trimmed = c.trim();
    if (!trimmed || isContradictoryDerivedForbid(trimmed, intent)) continue;
    labels.add(trimmed);
  }

  return [...labels];
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
    profile.ending_anchors?.length ? `어미앵커=${profile.ending_anchors.slice(0, 4).join("/")}` : null,
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

function joinCreatorSpeechText(
  speechText: string,
  exampleDialog: string,
  stored?: Partial<SpeechProfile> | null
): { corpus: string; registers: SpeechContextualRegister[]; parsedForbidden: string[] } {
  const parsed = speechCreatorFromLegacyExampleDialog(exampleDialog);
  const registerText = (parsed.speech_contextual_registers ?? [])
    .map((register) => [register.label, register.condition, register.style, register.examples].filter(Boolean).join(" "))
    .join("\n");
  const corpus = [
    speechText,
    stored?.creator_personality ?? "",
    stored?.creator_speech_traits ?? "",
    stored?.speech_tone ?? "",
    parsed.speech_personality,
    parsed.speech_traits,
    registerText,
  ]
    .filter((part) => part.trim())
    .join("\n");
  return {
    corpus,
    registers: parsed.speech_contextual_registers ?? [],
    parsedForbidden: parseForbiddenLines(parsed.speech_forbidden),
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
  const intent = resolveCreatorFormalityIntent(creator.corpus, creator.registers);
  const speech_formality = resolveSpeechFormality(intent, social_class, creator.corpus || corpus);
  const speech_tone =
    stored?.creator_speech_traits?.trim() ||
    stored?.speech_tone?.trim() ||
    inferTone(speechText || identityText);
  const vocabulary_style: VocabularyStyle = vocabularyForClass(social_class);
  const storedExamples = stored?.dialogue_examples?.filter((line) => line.trim()) ?? [];
  const dialogue_examples =
    storedExamples.length > 0 ? storedExamples.slice(0, 20) : extractDialogueExamples(exampleDialog, speechText);
  const ending_anchors =
    dialogue_examples.length > 0 ? extractEndingAnchors(dialogue_examples) : undefined;

  const base: SpeechProfile = {
    charName: input.charName.trim() || "캐릭터",
    speech_tone,
    speech_formality,
    vocabulary_style,
    social_class,
    era_style,
    forbidden_speech_patterns: buildForbiddenList(
      social_class,
      era_style,
      speech_formality,
      intent,
      [...(stored?.forbidden_speech_patterns ?? []), ...creator.parsedForbidden]
    ),
    dialogue_examples,
    ending_anchors,
    creator_personality: stored?.creator_personality?.trim() || undefined,
    creator_speech_traits: stored?.creator_speech_traits?.trim() || undefined,
    lockSummary: "",
  };
  base.lockSummary = buildLockSummary(base);
  return enrichCreatorFieldsFromExampleDialog(base, exampleDialog, intent);
}

function enrichCreatorFieldsFromExampleDialog(
  profile: SpeechProfile,
  exampleDialog: string,
  intent: CreatorFormalityIntent
): SpeechProfile {
  if (!exampleDialog.trim()) return profile;
  const parsed = speechCreatorFromLegacyExampleDialog(exampleDialog);
  const out = { ...profile };

  if (!out.creator_personality?.trim() && parsed.speech_personality.trim()) {
    out.creator_personality = parsed.speech_personality.trim();
  }
  if (!out.creator_speech_traits?.trim() && parsed.speech_traits.trim()) {
    out.creator_speech_traits = parsed.speech_traits.trim();
  }
  if (out.dialogue_examples.length === 0 && parsed.speech_examples.trim()) {
    out.dialogue_examples = extractCharacterDialogueLines(parsed.speech_examples);
  }
  if (parsed.speech_forbidden?.trim()) {
    const extra = parseForbiddenLines(parsed.speech_forbidden).filter(
      (label) => !isContradictoryDerivedForbid(label, intent)
    );
    out.forbidden_speech_patterns = [...new Set([...out.forbidden_speech_patterns, ...extra])];
  }
  out.ending_anchors =
    out.dialogue_examples.length > 0 ? extractEndingAnchors(out.dialogue_examples) : undefined;
  out.lockSummary = buildLockSummary(out);
  return out;
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
  });
}
