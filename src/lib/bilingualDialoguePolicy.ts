import type { CharacterChunk } from "@/types";

/** 이중언어 대사 1차 언어 — explicit [BILINGUAL: code+ko] 또는 설정 문구에서 감지 */
export type BilingualPrimaryLang =
  | "en"
  | "zh"
  | "ja"
  | "fr"
  | "es"
  | "de"
  | "ru"
  | "vi"
  | "th"
  | "custom";

export type BilingualDialoguePolicy =
  | {
      enabled: true;
      primary: BilingualPrimaryLang;
      /** 프롬프트·예시용 표시명 (English, 中文, 日本語, …) */
      primaryDisplay: string;
      /** 감지 근거 (디버그·메타) */
      source: "explicit_tag" | "creator_text" | "example_dialog";
    }
  | { enabled: false };

const LANG_BY_CODE: Record<
  string,
  { primary: BilingualPrimaryLang; primaryDisplay: string }
> = {
  en: { primary: "en", primaryDisplay: "English" },
  eng: { primary: "en", primaryDisplay: "English" },
  english: { primary: "en", primaryDisplay: "English" },
  zh: { primary: "zh", primaryDisplay: "中文 (Chinese)" },
  cn: { primary: "zh", primaryDisplay: "中文 (Chinese)" },
  chinese: { primary: "zh", primaryDisplay: "中文 (Chinese)" },
  mandarin: { primary: "zh", primaryDisplay: "中文 (Chinese)" },
  ja: { primary: "ja", primaryDisplay: "日本語 (Japanese)" },
  jp: { primary: "ja", primaryDisplay: "日本語 (Japanese)" },
  japanese: { primary: "ja", primaryDisplay: "日本語 (Japanese)" },
  fr: { primary: "fr", primaryDisplay: "Français (French)" },
  french: { primary: "fr", primaryDisplay: "Français (French)" },
  es: { primary: "es", primaryDisplay: "Español (Spanish)" },
  spanish: { primary: "es", primaryDisplay: "Español (Spanish)" },
  de: { primary: "de", primaryDisplay: "Deutsch (German)" },
  german: { primary: "de", primaryDisplay: "Deutsch (German)" },
  ru: { primary: "ru", primaryDisplay: "Russian (Русский)" },
  russian: { primary: "ru", primaryDisplay: "Russian (Русский)" },
  vi: { primary: "vi", primaryDisplay: "Tiếng Việt (Vietnamese)" },
  vietnamese: { primary: "vi", primaryDisplay: "Tiếng Việt (Vietnamese)" },
  th: { primary: "th", primaryDisplay: "ภาษาไทย (Thai)" },
  thai: { primary: "th", primaryDisplay: "ภาษาไทย (Thai)" },
};

const EXPLICIT_TAG_RE =
  /\[(?:BILINGUAL(?:\s+DIALOGUE)?|이중언어(?:\s*대사)?)\s*[:：]\s*([a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4e00-\u9fff\u3040-\u30ff]+)\s*(?:\+|→|->|,)\s*ko\s*\]/i;

const BILINGUAL_INTENT_RE =
  /(?:bilingual\s+dialogue|bilingual\s+speech|이중언어\s*대사|이중언어\s*대화|双语\s*对话|双語\s*對話)/i;

const FORMAT_HINT_RE =
  /(?:먼저|우선|先|first).{0,40}(?:번역|translation|한국어|Korean).{0,40}(?:괄호|parenthes|\(\)|（）)/i;

const EXAMPLE_BILINGUAL_LINE_RE =
  /"[^"]{2,120}"\s*[（(][^"）)\n]{2,80}[）)]/;

const NATURAL_LANG_HINTS: { primary: BilingualPrimaryLang; primaryDisplay: string; re: RegExp }[] = [
  { primary: "en", primaryDisplay: "English", re: /\benglish\b|영어(?:\s*대사|\s*먼저|\s*로)|영문\s*대사|미국(?:인|어)/i },
  { primary: "zh", primaryDisplay: "中文 (Chinese)", re: /chinese|mandarin|中文|汉语|漢語|중국어|普通话|普通話/i },
  { primary: "ja", primaryDisplay: "日本語 (Japanese)", re: /japanese|日本語|일본어|にほんご/i },
  { primary: "fr", primaryDisplay: "Français (French)", re: /\bfrench\b|français|프랑스어/i },
  { primary: "es", primaryDisplay: "Español (Spanish)", re: /\bspanish\b|español|스페인어/i },
  { primary: "de", primaryDisplay: "Deutsch (German)", re: /\bgerman\b|deutsch|독일어/i },
  { primary: "ru", primaryDisplay: "Russian (Русский)", re: /\brussian\b|русский|러시아어/i },
  { primary: "vi", primaryDisplay: "Tiếng Việt (Vietnamese)", re: /vietnamese|tiếng\s*việt|베트남어/i },
  { primary: "th", primaryDisplay: "ภาษาไทย (Thai)", re: /\bthai\b|ภาษาไทย|태국어/i },
];

function resolveFromExplicitTag(text: string): BilingualDialoguePolicy | null {
  const match = text.match(EXPLICIT_TAG_RE);
  if (!match) return null;
  const raw = match[1]!.trim().toLowerCase();
  const mapped = LANG_BY_CODE[raw];
  if (mapped) {
    return { enabled: true, ...mapped, source: "explicit_tag" };
  }
  return {
    enabled: true,
    primary: "custom",
    primaryDisplay: match[1]!.trim(),
    source: "explicit_tag",
  };
}

function detectNaturalLanguage(text: string): BilingualDialoguePolicy | null {
  if (!BILINGUAL_INTENT_RE.test(text) && !FORMAT_HINT_RE.test(text)) return null;

  for (const hint of NATURAL_LANG_HINTS) {
    if (hint.re.test(text)) {
      return {
        enabled: true,
        primary: hint.primary,
        primaryDisplay: hint.primaryDisplay,
        source: "creator_text",
      };
    }
  }

  if (BILINGUAL_INTENT_RE.test(text)) {
    return {
      enabled: true,
      primary: "en",
      primaryDisplay: "English",
      source: "creator_text",
    };
  }

  return null;
}

function detectFromExampleDialog(exampleDialog: string): BilingualDialoguePolicy | null {
  const trimmed = exampleDialog.trim();
  if (!trimmed || !EXAMPLE_BILINGUAL_LINE_RE.test(trimmed)) return null;

  for (const hint of NATURAL_LANG_HINTS) {
    if (hint.re.test(trimmed)) {
      return {
        enabled: true,
        primary: hint.primary,
        primaryDisplay: hint.primaryDisplay,
        source: "example_dialog",
      };
    }
  }

  const hasCjk = /[\u4e00-\u9fff]/.test(trimmed);
  const hasKana = /[\u3040-\u30ff]/.test(trimmed);
  const hasLatin = /"[A-Za-z][^"]{0,80}"/.test(trimmed);

  if (hasCjk && !hasKana) {
    return {
      enabled: true,
      primary: "zh",
      primaryDisplay: "中文 (Chinese)",
      source: "example_dialog",
    };
  }
  if (hasKana) {
    return {
      enabled: true,
      primary: "ja",
      primaryDisplay: "日本語 (Japanese)",
      source: "example_dialog",
    };
  }
  if (hasLatin) {
    return {
      enabled: true,
      primary: "en",
      primaryDisplay: "English",
      source: "example_dialog",
    };
  }

  return null;
}

export function collectBilingualPolicySourceText(sources: {
  chunks?: CharacterChunk[];
  characterSettingText?: string;
  systemPrompt?: string;
  world?: string;
  exampleDialog?: string;
}): string {
  const parts: string[] = [];
  if (sources.characterSettingText?.trim()) parts.push(sources.characterSettingText.trim());
  if (sources.systemPrompt?.trim()) parts.push(sources.systemPrompt.trim());
  if (sources.world?.trim()) parts.push(sources.world.trim());
  for (const chunk of sources.chunks ?? []) {
    if (chunk.content?.trim()) parts.push(chunk.content.trim());
  }
  return parts.join("\n\n");
}

/** 캐릭터 설정·예시 대화에서 이중언어 대사 정책 감지 */
export function resolveBilingualDialoguePolicyFromSources(sources: {
  chunks?: CharacterChunk[];
  characterSettingText?: string;
  systemPrompt?: string;
  world?: string;
  exampleDialog?: string;
}): BilingualDialoguePolicy {
  const combined = collectBilingualPolicySourceText(sources);

  const fromTag = resolveFromExplicitTag(combined);
  if (fromTag) return fromTag;

  const fromNatural = detectNaturalLanguage(combined);
  if (fromNatural) return fromNatural;

  if (sources.exampleDialog?.trim()) {
    const fromExample = detectFromExampleDialog(sources.exampleDialog);
    if (fromExample) return fromExample;
  }

  return { enabled: false };
}

export function isBilingualDialogueActive(
  policy: BilingualDialoguePolicy
): policy is Extract<BilingualDialoguePolicy, { enabled: true }> {
  return policy.enabled === true;
}

/** Compact — Konglish + hanja leakage (Qwen/DeepSeek regressions: settle될, 独占). */
export const NO_FOREIGN_LANGUAGE_MIXING_RULE = `[NO FOREIGN LANGUAGE MIXING]
한국어 문장에 외국어(영어·한자·일본어 등)를 섞어 쓰지 마라.
고유명사·스킬명(「」 표기)만 예외.

특히 주의:
영어어간+한국어어미 굴절(settle될/trigger되) 금지.
한자 직접 표기(独占/愛/死) 금지 — 한글로만 (독점/사랑/죽음).
이 규칙은 Qwen, DeepSeek에서 특히 자주 발생하므로 엄격히 적용할 것.`;

export function buildNoForeignLanguageMixingRule(bilingual?: BilingualDialoguePolicy): string {
  if (bilingual && isBilingualDialogueActive(bilingual)) {
    return `${NO_FOREIGN_LANGUAGE_MIXING_RULE}
Bilingual mode: full ${bilingual.primaryDisplay} inside "…" is OK; foreign mixing in Korean narration or ( ) gloss is still forbidden.`;
  }
  return NO_FOREIGN_LANGUAGE_MIXING_RULE;
}

/** @deprecated Use NO_FOREIGN_LANGUAGE_MIXING_RULE */
export const NO_KONGLISH_HYBRID_RULE = NO_FOREIGN_LANGUAGE_MIXING_RULE;

/** @deprecated Use buildNoForeignLanguageMixingRule */
export function buildNoKonglishHybridRule(bilingual?: BilingualDialoguePolicy): string {
  return buildNoForeignLanguageMixingRule(bilingual);
}

/** @deprecated Use NO_FOREIGN_LANGUAGE_MIXING_RULE */
export const NO_HANJA_SUBSTITUTION_RULE = NO_FOREIGN_LANGUAGE_MIXING_RULE;

/** @deprecated Use buildNoForeignLanguageMixingRule */
export function buildNoHanjaSubstitutionRule(bilingual?: BilingualDialoguePolicy): string {
  return buildNoForeignLanguageMixingRule(bilingual);
}

/** [LANG · CRITICAL] — 이중언어 예외 버전 */
export function buildLangCriticalRule(opts?: {
  allowStatusHtml?: boolean;
  bilingual?: BilingualDialoguePolicy;
}): string {
  const bilingual = opts?.bilingual && isBilingualDialogueActive(opts.bilingual) ? opts.bilingual : null;
  const htmlClause = opts?.allowStatusHtml
    ? "NO HTML except creator-mandated status window block at narrative end"
    : "NO HTML";

  if (bilingual) {
    return `[LANG · CRITICAL — BILINGUAL DIALOGUE EXCEPTION]
Narration/scene prose: 100% Korean (-다 style). NO foreign language in narration.
Spoken dialogue in double quotes ONLY: ${bilingual.primaryDisplay} line + Korean gloss in ( ) on EVERY speech line.
Example: "…" (한국어 의역)
NO third language. NO ${htmlClause}/meta ([emotion tag] OK).
Konglish/hanja: see [NO FOREIGN LANGUAGE MIXING] in [OUTPUT LANG]. Part/chapter labels: [CORE RP] §6.`;
  }

  return `[LANG · CRITICAL]
Output 100% Korean. NO English sentences/words/${htmlClause}/meta ([emotion tag] OK).
Konglish/hanja: see [NO FOREIGN LANGUAGE MIXING] in [OUTPUT LANG]. Part/chapter labels: [CORE RP] §6.`;
}

export function buildBilingualDialoguePromptBlock(
  policy: Extract<BilingualDialoguePolicy, { enabled: true }>
): string {
  return `[BILINGUAL DIALOGUE — creator setting override]
The character settings require bilingual OUT-LOUD speech (not narration-only Korean).

Format (every quoted dialogue line):
1. Double quotes: natural ${policy.primaryDisplay} speech in character voice.
2. Immediately after, Korean translation/gloss in half-width or full-width parentheses: (한국어 의역)

Example pattern:
"Hello, are you okay?" (괜찮아?)

Rules:
- Narration, action, inner thought: Korean ONLY (-다 style). Never write narration in ${policy.primaryDisplay}.
- User persona quoted speech: follow [USER_PERSONA] / co-narration rules; if the user speaks Korean in input, mirror that unless settings say otherwise.
- Do NOT mix Korean into the ${policy.primaryDisplay} quote. Korean belongs ONLY in ( ) after the quote.
- Apply to ALL NPCs only if settings say so; default = AI character(s) you play use bilingual lines when settings demand it.
- Status window / Flash HTML: Korean preferred unless user template says otherwise.`;
}
