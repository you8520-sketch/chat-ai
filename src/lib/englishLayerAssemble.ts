import type { CharacterChunk } from "@/types";
import { isTranslatableChunk } from "@/lib/promptTranslation";

const HANGUL_RE = /[\uac00-\ud7a3]/;

export type EnglishLayerAssembleCheck = {
  usedEnglish: boolean;
  nonSpeechUseEnglish: boolean;
  speechStaysKorean: boolean;
  noRawKoreanSystemPromptDump: boolean;
  noKoreanRawBypass: boolean;
  pass: boolean;
  reasons: string[];
};

function hangulRatio(text: string): number {
  const chars = text.replace(/\s+/g, "");
  if (!chars.length) return 0;
  let hangul = 0;
  for (const ch of chars) {
    if (HANGUL_RE.test(ch)) hangul += 1;
  }
  return hangul / chars.length;
}

/**
 * Dry-run check: English layer is what main RP context consumes.
 * Does not call any model API.
 */
export function inspectEnglishLayerAssembly(opts: {
  usedEnglish: boolean;
  mergedChunks: CharacterChunk[];
  assembledSystemPrompt: string;
  koreanSystemPrompt?: string | null;
}): EnglishLayerAssembleCheck {
  const reasons: string[] = [];
  const { usedEnglish, mergedChunks, assembledSystemPrompt, koreanSystemPrompt } = opts;

  if (!usedEnglish) reasons.push("usedEnglish=false");

  const nonSpeech = mergedChunks.filter(isTranslatableChunk);
  const speech = mergedChunks.filter((c) => c.category === "speech");

  const nonSpeechEnglish =
    nonSpeech.length === 0 ||
    nonSpeech.every((c) => hangulRatio(c.content) < 0.15);
  if (!nonSpeechEnglish) reasons.push("non-speech chunks still Korean");

  const speechKorean =
    speech.length === 0 || speech.some((c) => hangulRatio(c.content) >= 0.2);
  if (speech.length > 0 && !speechKorean) reasons.push("speech chunks lost Korean");

  const raw = koreanSystemPrompt?.trim() ?? "";
  let noRawDump = true;
  if (raw.length >= 80) {
    const needle = raw.slice(0, Math.min(120, raw.length));
    if (assembledSystemPrompt.includes(needle)) {
      noRawDump = false;
      reasons.push("Korean system_prompt dumped into assembled prompt");
    }
  }

  const pass =
    usedEnglish &&
    nonSpeechEnglish &&
    (speech.length === 0 || speechKorean) &&
    noRawDump;

  return {
    usedEnglish,
    nonSpeechUseEnglish: nonSpeechEnglish,
    speechStaysKorean: speech.length === 0 || speechKorean,
    noRawKoreanSystemPromptDump: noRawDump,
    noKoreanRawBypass: noRawDump,
    pass,
    reasons,
  };
}
