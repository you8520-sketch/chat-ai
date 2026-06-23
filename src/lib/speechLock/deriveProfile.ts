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
} from "@/lib/speechCreatorFields";

export type DeriveSpeechProfileInput = {
  charName: string;
  chunks: CharacterChunk[];
  exampleDialog?: string | null;
  world?: string | null;
  storedProfile?: Partial<SpeechProfile> | null;
};

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

function inferFormality(text: string, socialClass: SocialClass): SpeechFormality {
  for (const { re, formality } of FORMALITY_KEYWORDS) {
    if (re.test(text)) return formality;
  }
  if (socialClass === "royalty" || socialClass === "nobility") return "formal";
  if (socialClass === "commoner" || socialClass === "outcast") return "semi_formal";
  if (socialClass === "modern") return "informal";
  return "semi_formal";
}

function inferTone(text: string): string {
  for (const { re, tone } of TONE_KEYWORDS) {
    if (re.test(text)) return tone;
  }
  return "설정에 맞는 일관된 말투";
}

function extractDialogueExamples(exampleDialog: string, speechText: string): string[] {
  const combined = `${exampleDialog}\n${speechText}`;
  const fromCreator = extractCharacterDialogueLines(combined);
  if (fromCreator.length > 0) return fromCreator.slice(0, 20);
  return combined
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function buildForbiddenList(
  socialClass: SocialClass,
  era: EraStyle,
  formality: SpeechFormality,
  custom: string[] = []
): string[] {
  const labels = new Set<string>(GLOBAL_FORBIDDEN_SPEECH.map((g) => g.label));
  labels.add("말투·존댓말 급변 (한 턴 내 격식 ↔ 반말 전환)");
  labels.add("캐릭터 성격과 무관한 유행어·밈");

  if (isHistoricalEra(era) || socialClass === "royalty" || socialClass === "nobility") {
    labels.add("현대 구어·슬랭·밈 (ㅋㅋ, 레전드, 헐, 대박 등)");
    labels.add("현대식 캐주얼 존댓말 (~요체 남발, 친구 말투)");
    labels.add("혼합 존댓말 (~입니다요, ~하세요요, ~님께서요, ~하신님)");
    labels.add("AI 창작 '판타지체' — 예시 대사 어미를 복사할 것");
  }

  if (socialClass === "royalty" || socialClass === "nobility") {
    labels.add("백성·하인 말투 (거친 반말, '~이놈', '~같은 놈')");
    labels.add("신분에 맞지 않는 과도한 친근·반말");
  }

  if (formality === "formal" || formality === "archaic_formal") {
    labels.add("반말·하대·친구 말투");
  }

  for (const c of custom) {
    if (c.trim()) labels.add(c.trim());
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

function mergeStored(
  derived: SpeechProfile,
  stored?: Partial<SpeechProfile> | null
): SpeechProfile {
  if (!stored) return derived;
  const merged: SpeechProfile = {
    ...derived,
    ...stored,
    charName: stored.charName?.trim() || derived.charName,
    forbidden_speech_patterns: [
      ...new Set([
        ...derived.forbidden_speech_patterns,
        ...(stored.forbidden_speech_patterns ?? []),
      ]),
    ],
    dialogue_examples:
      stored.dialogue_examples && stored.dialogue_examples.length > 0
        ? stored.dialogue_examples.slice(0, 20)
        : derived.dialogue_examples,
    creator_personality: stored.creator_personality?.trim() || derived.creator_personality,
    creator_speech_traits: stored.creator_speech_traits?.trim() || derived.creator_speech_traits,
    ending_anchors:
      stored.ending_anchors && stored.ending_anchors.length > 0
        ? stored.ending_anchors
        : derived.ending_anchors ??
          (derived.dialogue_examples.length > 0
            ? extractEndingAnchors(derived.dialogue_examples)
            : undefined),
    speech_tone:
      stored.creator_speech_traits?.trim() ||
      stored.speech_tone?.trim() ||
      derived.creator_speech_traits ||
      derived.speech_tone,
  };
  merged.lockSummary = buildLockSummary(merged);
  return merged;
}

function enrichCreatorFieldsFromExampleDialog(
  profile: SpeechProfile,
  exampleDialog: string
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
  if (!out.ending_anchors?.length && out.dialogue_examples.length > 0) {
    out.ending_anchors = extractEndingAnchors(out.dialogue_examples);
  }
  if (parsed.speech_forbidden?.trim()) {
    const extra = parsed.speech_forbidden.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    out.forbidden_speech_patterns = [...new Set([...out.forbidden_speech_patterns, ...extra])];
  }
  out.lockSummary = buildLockSummary(out);
  return out;
}

export function deriveSpeechProfile(input: DeriveSpeechProfileInput): SpeechProfile {
  const speechText = collectText(input.chunks, ["speech"]);
  const identityText = collectText(input.chunks, ["identity", "personality"]);
  const worldText = [input.world ?? "", collectText(input.chunks, ["world"])].join("\n");
  const corpus = [speechText, identityText, worldText].join("\n");

  const social_class = inferSocialClass(corpus);
  const era_style = inferEraStyle(corpus);
  const speech_formality = inferFormality(speechText || corpus, social_class);
  const speech_tone = inferTone(speechText || identityText);
  const vocabulary_style: VocabularyStyle = vocabularyForClass(social_class);
  const dialogue_examples = extractDialogueExamples(input.exampleDialog ?? "", speechText);
  const ending_anchors =
    dialogue_examples.length > 0 ? extractEndingAnchors(dialogue_examples) : undefined;

  const base: SpeechProfile = {
    charName: input.charName.trim() || "캐릭터",
    speech_tone,
    speech_formality,
    vocabulary_style,
    social_class,
    era_style,
    forbidden_speech_patterns: buildForbiddenList(social_class, era_style, speech_formality),
    dialogue_examples,
    ending_anchors,
    lockSummary: "",
  };
  base.lockSummary = buildLockSummary(base);
  const merged = mergeStored(base, input.storedProfile);
  return enrichCreatorFieldsFromExampleDialog(merged, input.exampleDialog ?? "");
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
