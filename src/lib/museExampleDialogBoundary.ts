/**
 * Muse Example-Dialog Boundary — runtime sanitization for the Muse admin canary.
 *
 * Removes semantic/scene content from creator example dialogue (names, code names,
 * affiliations, current relationship, proximity, touch assumptions, current emotions,
 * events, example-specific facts) while preserving form-level speech style signals:
 * register, honorific level, sentence endings, cadence, hesitation, self-correction,
 * apology pattern, directness, punctuation habits, and address convention.
 *
 * Does not alter stored creator data. No LLM is used.
 */

import {
  formatSpeechSectionAsMetadata,
  isSpeechMetadataSection,
} from "@/lib/speechMetadataPolicy";
import { parseCharacterSettingIntoSections } from "@/lib/characterSettingSections";
import { extractCharacterDialogueLines, extractEndingAnchors } from "@/lib/speechCreatorFields";

export const MUSE_EXAMPLE_DIALOG_TRAP_PHRASES = [
  "생각보다 활발하시군요",
  "그렇게 가까이 오시면",
  "조금 곤란합니다",
] as const;

const EXAMPLE_DIALOG_HEADER_RE = /\[예시\s*(?:대화|대사)\]\s*\n?/i;
const SPEECH_CONSISTENCY_HEADER_RE = /\[SPEECH\s+CONSISTENCY\]\s*\n?/i;
const DIALOGUE_EXAMPLES_HEADER_RE = /dialogue_examples\s*[:\(].*/i;

const QUOTED_EXAMPLE_RE = /[""""""「『]([^""""""」』\n]{2,})[""""""」』]/g;
const GENERATION_METADATA_HEADER_RE = /\[말투\s*[—\-·]\s*GENERATION\s+METADATA[^\]]*\]/i;

function normalizeSmartQuotes(text: string): string {
  return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

const SENTENCE_ENDING_RE =
  /(?:습니다|십시오|하세요|합니다|이오|하오|하옵|하구|하네|하군|하리|하리오|구나|구려|니까|니오|소|오|요|다|네|지|죠|군요|래요|어요|가요|까요|습니까)$/;

const HESITATION_MARKERS = /\.{3}|\.\.\.|…|음|어|저|그|글쎄|잠깐|잠시|아니|아직/;
const SELF_CORRECTION_MARKERS = /아니|아니면|아, |그러니까|다시|취소|정정|아까|말을 바꿔|고치|수정/;
const APOLOGY_MARKERS = /죄송|미안|잘못|실수|변명|용서|괜찮|괜찮으|방해|폐/;
const INDIRECT_MARKERS = /조금|조금은|약간|혹시|아마|것 같|듯|던지|면 좋|어떨지|어떠신지|괜찮으|될까|주시|부탁|여쭤|여쭤봐/;
const ELLIPSIS_PATTERN_RE = /\.{3}|…/g;

/** Style fingerprint fields — no semantic content. */
export type MuseSpeechStyleFingerprint = {
  register: string;
  honorificLevel: string;
  formality: string;
  sentenceEndings: string[];
  cadence: string;
  averageSentenceLength: number;
  hesitationPattern: string;
  selfCorrectionPattern: string;
  apologyPattern: string;
  directness: string;
  emotionalExplicitness: string;
  punctuationPattern: string;
  addressStyle: string;
};

export type MuseStyleCoverageResult = {
  fingerprint: MuseSpeechStyleFingerprint;
  coverage: "ok" | "STYLE_COVERAGE_INSUFFICIENT";
  missingFields: string[];
  signals: string[];
};

/** Extract a deterministic, semantic-free style fingerprint from raw examples. */
function extractDialogueLinesForFingerprint(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) =>
      l
        .trim()
        .replace(/^[-*•]\s*/, "")
        .replace(/^[""""「『]/, "")
        .replace(/[""""」』][,;]?\s*$/, "")
        .trim()
    )
    .filter((l) => l.length >= 3 && !l.startsWith("[") && !l.startsWith("style_notes") && !l.startsWith("Apply only"));
  return [...new Set(lines)];
}

export function extractSpeechStyleFingerprint(
  exampleDialog: string,
  speechPersonality: string,
  speechTraits: string,
  characterPersonality: string
): MuseStyleCoverageResult {
  const normalizedExample = normalizeSmartQuotes(exampleDialog);
  const lines = extractDialogueLinesForFingerprint(normalizedExample);
  const endings = extractEndingAnchors(lines).slice(0, 6);

  const lengths = lines.map((l) => l.length).filter((n) => n > 0);
  const avgLen = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;

  const hesitationCount = lines.filter((l) => HESITATION_MARKERS.test(l)).length;
  const selfCorrectionCount = lines.filter((l) => SELF_CORRECTION_MARKERS.test(l)).length;
  const apologyCount = lines.filter((l) => APOLOGY_MARKERS.test(l)).length;
  const indirectCount = lines.filter((l) => INDIRECT_MARKERS.test(l)).length;
  const ellipsisCount = lines.reduce(
    (sum, l) => sum + (l.match(ELLIPSIS_PATTERN_RE) ?? []).length,
    0
  );

  const joinedSpeechMeta = `${speechPersonality}\n${speechTraits}`;
  const joinedPersonality = characterPersonality;
  const combined = `${joinedSpeechMeta}\n${joinedPersonality}`;

  const formality =
    /합니다체|격식|공손|존댓|하십시|합니다|입니다|경어|높임|공식|\bformal\b|\bpolite\b|\bhonorific\b/i.test(combined)
      ? "formal"
      : /반말|친근|편한\s*말|캐주얼|\bcasual\b|\binformal\b/i.test(combined)
        ? "informal"
        : "semi_formal";

  const honorificLevel =
    /합니까|십시오|하십시|하옵|아뢰|옵니다|하오/i.test(combined) || endings.some((e) => /십시오|이오|하오|옵니다/.test(e))
      ? "high"
      : /합니다|입니다|세요|요|다나까/i.test(combined) || endings.some((e) => /습니다|합니다|세요|요/.test(e))
        ? "standard"
        : /반말|야|어|지\?|냐\?/i.test(combined) || endings.some((e) => /야|어|지|냐/.test(e))
          ? "none"
          : "standard";

  const register =
    /다나까체|군대식|군대|명령|보고|각하|이하/i.test(combined)
      ? "military"
      : /하십시오체|옵니다|아뢰|하옵/i.test(combined)
        ? "high_formal"
        : /합니다체|격식|공식|업무/i.test(combined) || endings.some((e) => /습니다|합니다|십시오/.test(e))
          ? "formal"
          : /해요체|부드러운|일상/i.test(combined) || endings.some((e) => /요|세요|해요/.test(e))
            ? "polite"
            : "neutral";

  const cadence =
    hesitationCount > 0 || ellipsisCount > 0
      ? "hesitant"
      : avgLen > 60
        ? "measured"
        : avgLen > 30
          ? "brief"
          : "undetermined";

  const hesitationPattern =
    hesitationCount > 0 ? "hesitates" : "none";

  const selfCorrectionPattern =
    selfCorrectionCount > 0 ? "self-corrects" : "none";

  const apologyPattern =
    apologyCount > 0 ? "apologetic" : "none";

  const directness =
    lines.length > 0 && indirectCount > lines.length * 0.2
      ? "indirect"
      : /간접|indirect|soften|조심|조심스|완곡|말을 돌려|돌려/i.test(combined)
        ? "indirect"
        : lines.length > 0
          ? "direct"
          : "undetermined";

  const emotionalExplicitness =
    /감정|느낌|기쁘|슬프|화가|분노|좌절|두렵|설렘|외롭/i.test(combined)
      ? "explicit"
      : "low";

  const punctuationPattern =
    ellipsisCount > 0 ? "ellipsis" : "standard";

  const addressStyle =
    /님\b|nim|씨|님께|귀하|분/i.test(combined)
      ? "formal"
      : /자네|네|너|당신|그대/i.test(combined)
        ? "familiar"
        : "neutral";

  const fingerprint: MuseSpeechStyleFingerprint = {
    register,
    honorificLevel,
    formality,
    sentenceEndings: endings.length > 0 ? endings : ["undetermined"],
    cadence,
    averageSentenceLength: avgLen,
    hesitationPattern,
    selfCorrectionPattern,
    apologyPattern,
    directness,
    emotionalExplicitness,
    punctuationPattern,
    addressStyle,
  };

  const requiredFields: (keyof MuseSpeechStyleFingerprint)[] = [
    "register",
    "honorificLevel",
    "formality",
    "sentenceEndings",
    "cadence",
  ];
  const missingFields: string[] = [];
  for (const key of requiredFields) {
    const v = fingerprint[key];
    if (Array.isArray(v) ? v.length === 0 || (v.length === 1 && v[0] === "undetermined") : v === "undetermined" || v === "") {
      missingFields.push(key);
    }
  }
  // Hesitation is not a required style dimension. A direct, fluent character is
  // valid, so hesitationPattern: "none" must not trigger coverage failure.

  const signals: string[] = [];
  if (endings.length > 0) signals.push(`endings: ${endings.join(", ")}`);
  if (hesitationCount > 0) signals.push(`hesitation lines: ${hesitationCount}`);
  if (selfCorrectionCount > 0) signals.push(`self-correction lines: ${selfCorrectionCount}`);
  if (apologyCount > 0) signals.push(`apology lines: ${apologyCount}`);
  if (indirectCount > 0) signals.push(`indirect/softened lines: ${indirectCount}`);

  const coverage = missingFields.length > 0 ? "STYLE_COVERAGE_INSUFFICIENT" : "ok";
  return { fingerprint, coverage, missingFields, signals };
}

/**
 * Format a semantic-free style fingerprint as a runtime prompt block.
 */
function isNonTrivial(value: string): boolean {
  return value !== "none" && value !== "low" && value !== "neutral" && value !== "undetermined";
}

export function formatSpeechStyleFingerprint(fingerprint: MuseSpeechStyleFingerprint): string {
  const lines = ["[말투 · GENERATION METADATA]"];
  if (isNonTrivial(fingerprint.register)) lines.push("register: " + fingerprint.register);
  if (isNonTrivial(fingerprint.honorificLevel)) lines.push("honorificLevel: " + fingerprint.honorificLevel);
  if (isNonTrivial(fingerprint.formality)) lines.push("formality: " + fingerprint.formality);
  if (fingerprint.sentenceEndings.length > 0 && fingerprint.sentenceEndings[0] !== "undetermined") {
    lines.push("sentenceEndings: " + fingerprint.sentenceEndings.join(", "));
  }
  if (isNonTrivial(fingerprint.cadence)) lines.push("cadence: " + fingerprint.cadence);
  if (fingerprint.averageSentenceLength > 0) lines.push("averageSentenceLength: " + fingerprint.averageSentenceLength);
  if (isNonTrivial(fingerprint.hesitationPattern)) lines.push("hesitationPattern: " + fingerprint.hesitationPattern);
  if (isNonTrivial(fingerprint.selfCorrectionPattern)) lines.push("selfCorrectionPattern: " + fingerprint.selfCorrectionPattern);
  if (isNonTrivial(fingerprint.apologyPattern)) lines.push("apologyPattern: " + fingerprint.apologyPattern);
  if (isNonTrivial(fingerprint.directness)) lines.push("directness: " + fingerprint.directness);
  if (isNonTrivial(fingerprint.emotionalExplicitness)) lines.push("emotionalExplicitness: " + fingerprint.emotionalExplicitness);
  if (isNonTrivial(fingerprint.punctuationPattern)) lines.push("punctuationPattern: " + fingerprint.punctuationPattern);
  if (isNonTrivial(fingerprint.addressStyle)) lines.push("addressStyle: " + fingerprint.addressStyle);
  return lines.join("\n");
}

/** Strip raw example utterances from a composed example_dialog string. */
export function sanitizeExampleDialogRuntimeText(text: string): string {
  if (!text.trim()) return "";
  text = normalizeSmartQuotes(text);

  // Fast path: if the whole text is a generation-metadata block containing only examples,
  // drop the entire speech metadata header and example sections. The canonical style
  // fingerprint (computed separately) is the only speech metadata carried forward.
  if (GENERATION_METADATA_HEADER_RE.test(text)) {
    const lines = text.split("\n");
    const out: string[] = [];
    let skipExamples = false;
    for (const raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();
      if (
        GENERATION_METADATA_HEADER_RE.test(trimmed) ||
        trimmed === "Apply only when writing [A] quoted dialogue. Not in-world facts." ||
        trimmed === "Apply only when writing [A] quoted dialogue."
      ) {
        continue;
      }
      if (/^style_notes/.test(trimmed) || /^dialogue_examples/.test(trimmed)) {
        skipExamples = true;
        continue;
      }
      if (/^register_by_context|^default_register:/.test(trimmed)) {
        out.push(line);
        skipExamples = false;
        continue;
      }
      if (skipExamples) continue;
      const cleaned = stripQuotedExamplesFromLine(line);
      if (cleaned != null) out.push(cleaned);
    }
    return out.join("\n").trim();
  }

  const lines = text.split("\n");
  const out: string[] = [];
  let inExamples = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (EXAMPLE_DIALOG_HEADER_RE.test(trimmed + "\n")) {
      inExamples = true;
      continue;
    }
    if (SPEECH_CONSISTENCY_HEADER_RE.test(trimmed + "\n")) {
      continue;
    }
    if (inExamples && trimmed === "") {
      inExamples = false;
      continue;
    }
    if (inExamples) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Strip quoted examples from a style-notes line. */
function stripQuotedExamplesFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^[-*•]\s*[""""「『][^""""」』]+[""""」』]\s*$/.test(trimmed)) return null;
  const cleaned = line.replace(QUOTED_EXAMPLE_RE, "").replace(/\s{2,}/g, " ").trim();
  if (!cleaned) return null;
  return cleaned;
}

/** Rewrite a speech section to metadata-only and drop example utterances. */
export function sanitizeSpeechSection(title: string, body: string): string {
  const meta = formatSpeechSectionAsMetadata(title, normalizeSmartQuotes(body));
  const lines = meta.split("\n");
  const out: string[] = [];
  let skipDialogueExamples = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (DIALOGUE_EXAMPLES_HEADER_RE.test(trimmed)) {
      skipDialogueExamples = true;
      continue;
    }
    if (skipDialogueExamples) {
      if (trimmed === "") skipDialogueExamples = false;
      continue;
    }
    const cleaned = stripQuotedExamplesFromLine(line);
    if (cleaned == null) continue;
    out.push(cleaned);
  }
  return out.join("\n").trim();
}

/** Sanitize speech metadata inside a combined character setting. */
export function sanitizeSpeechMetadataInSettingText(
  combinedSetting: string,
  fingerprintText?: string
): string {
  if (!combinedSetting.trim()) return fingerprintText ?? "";
  const sections = parseCharacterSettingIntoSections(combinedSetting);
  if (sections.length === 0) return fingerprintText ?? combinedSetting;
  const out: string[] = [];
  for (const section of sections) {
    if (isSpeechMetadataSection(section.title, section.body, section.hint)) {
      const sanitized = fingerprintText
        ? `${section.title}\n${fingerprintText}`
        : sanitizeSpeechSection(section.title, section.body);
      if (sanitized) out.push(sanitized);
    } else {
      out.push(`${section.title}\n${section.body}`.trim());
    }
  }
  return out.join("\n\n").trim();
}

/** Sanitize a speech_profile JSON at runtime.
 *
 * Fail-closed: malformed JSON does not return the raw string. The raw profile
 * may contain example utterances or scene-specific metadata, so any parse
 * failure is treated as an empty profile.
 */
export function sanitizeSpeechProfileRuntimeJson(raw: string): string {
  if (!raw.trim()) return "";
  raw = normalizeSmartQuotes(raw);
  try {
    const profile = JSON.parse(raw) as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(profile)) {
      if (key === "dialogue_examples" || key === "ending_anchors") continue;
      if (typeof value === "string") {
        sanitized[key] = sanitizeSpeechSection("", value);
      } else {
        sanitized[key] = value;
      }
    }
    return JSON.stringify(sanitized);
  } catch {
    return "";
  }
}

/**
 * Single canonical runtime source for sanitized speech style metadata.
 */
export function buildRuntimeSpeechStyleMetadata(input: {
  exampleDialog: string;
  speechProfileJson: string;
  combinedSetting: string;
  speechPersonality: string;
  speechTraits: string;
  characterPersonality: string;
}): {
  text: string;
  exampleDialog: string;
  speechProfileJson: string;
  fingerprint: MuseSpeechStyleFingerprint;
  coverage: "ok" | "STYLE_COVERAGE_INSUFFICIENT";
  missingFields: string[];
  signals: string[];
} {
  const { fingerprint, coverage, missingFields, signals } = extractSpeechStyleFingerprint(
    input.exampleDialog,
    input.speechPersonality,
    input.speechTraits,
    input.characterPersonality
  );

  const fingerprintText = formatSpeechStyleFingerprint(fingerprint);
  const sanitizedExample = sanitizeExampleDialogRuntimeText(input.exampleDialog);
  const sanitizedProfile = sanitizeSpeechProfileRuntimeJson(input.speechProfileJson);
  const sanitizedSetting = sanitizeSpeechMetadataInSettingText(input.combinedSetting, fingerprintText);

  return {
    text: sanitizedSetting,
    exampleDialog: sanitizedExample,
    speechProfileJson: sanitizedProfile,
    fingerprint,
    coverage,
    missingFields,
    signals,
  };
}

/** Check if any trap phrases remain in a sanitized text. */
export function containsTrapPhrases(
  text: string,
  traps: readonly string[] = MUSE_EXAMPLE_DIALOG_TRAP_PHRASES
): string[] {
  return traps.filter((trap) => text.includes(trap));
}
