import type { SpeechProfile, SpeechValidationResult, SpeechViolation } from "./types";
import {
  CASUAL_DIALOGUE_ENDINGS,
  GLOBAL_FORBIDDEN_SPEECH,
  PEASANT_SPEECH_MARKERS,
  isHistoricalEra,
  requiresFormalSpeech,
} from "./patterns";

const DIALOGUE_EXTRACT = /"([^"]{2,200})"/g;

export function extractCharacterDialogue(text: string, charName: string): string[] {
  const lines: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(DIALOGUE_EXTRACT.source, "g");
  while ((m = re.exec(text)) !== null) {
    const line = (m[1] ?? "").trim();
    if (line.length >= 2) lines.push(line);
  }

  if (lines.length === 0) return [];
  const nameRe = new RegExp(charName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const nearChar: string[] = [];
  const chunks = text.split(/(?<=[.!?…])\s+|\n+/);
  for (const chunk of chunks) {
    if (!/"/.test(chunk)) continue;
    if (nameRe.test(chunk) || chunk.includes('"')) {
      const inner = [...chunk.matchAll(DIALOGUE_EXTRACT)].map((x) => (x[1] ?? "").trim());
      nearChar.push(...inner.filter(Boolean));
    }
  }

  return nearChar.length > 0 ? nearChar : lines;
}

function testGlobalForbidden(dialogue: string): SpeechViolation[] {
  const out: SpeechViolation[] = [];
  for (const { pattern, label } of GLOBAL_FORBIDDEN_SPEECH) {
    if (pattern.test(dialogue)) {
      const m = dialogue.match(pattern);
      out.push({
        type: label.includes("혼합") ? "hybrid_honorific" : "forbidden_pattern",
        matched: m ? [m[0]] : [label],
        excerpt: dialogue.slice(0, 100),
        severity: "fail",
      });
    }
  }
  return out;
}

function testFormalityDrift(dialogue: string, profile: SpeechProfile): SpeechViolation[] {
  if (!requiresFormalSpeech(profile.speech_formality, profile.social_class)) return [];
  if (!CASUAL_DIALOGUE_ENDINGS.test(dialogue)) return [];
  return [
    {
      type: "formality_drift",
      matched: [dialogue.match(CASUAL_DIALOGUE_ENDINGS)?.[0] ?? "casual ending"],
      excerpt: dialogue.slice(0, 100),
      severity: "fail",
    },
  ];
}

function testClassDrift(dialogue: string, profile: SpeechProfile): SpeechViolation[] {
  if (profile.social_class !== "royalty" && profile.social_class !== "nobility") return [];
  if (!PEASANT_SPEECH_MARKERS.test(dialogue)) return [];
  const m = dialogue.match(PEASANT_SPEECH_MARKERS);
  return [
    {
      type: "class_drift",
      matched: m ? [m[0]] : ["peasant speech"],
      excerpt: dialogue.slice(0, 100),
      severity: "fail",
    },
  ];
}

function testModernSlangInHistorical(dialogue: string, profile: SpeechProfile): SpeechViolation[] {
  if (
    !isHistoricalEra(profile.era_style) &&
    profile.social_class !== "royalty" &&
    profile.social_class !== "nobility"
  ) {
    return [];
  }
  const modernRe = /(?:ㅋㅋ|ㅎㅎ|ㄹㅇ|레전드|헐\b|대박|개(?:웃|좋|쩔)|존맛|JMT|킹받|찐)/;
  if (!modernRe.test(dialogue)) return [];
  const m = dialogue.match(modernRe);
  return [
    {
      type: "modern_slang",
      matched: m ? [m[0]] : ["modern slang"],
      excerpt: dialogue.slice(0, 100),
      severity: "fail",
    },
  ];
}

function testEndingAnchorDrift(dialogue: string, profile: SpeechProfile): SpeechViolation[] {
  const anchors = profile.ending_anchors?.filter(Boolean) ?? [];
  if (anchors.length === 0 || profile.dialogue_examples.length === 0) return [];

  const cleaned = dialogue.replace(/^["「『]|["」』]$/g, "").replace(/[.!?…\s]+$/g, "").trim();
  if (cleaned.length < 2) return [];

  const matches = anchors.some(
    (anchor) =>
      cleaned.endsWith(anchor) ||
      cleaned.includes(anchor) ||
      anchor.length >= 2 && cleaned.slice(-anchor.length) === anchor
  );
  if (matches) return [];

  return [
    {
      type: "ending_drift",
      matched: [cleaned.slice(-6) || cleaned.slice(0, 20)],
      excerpt: dialogue.slice(0, 100),
      severity: "fail",
    },
  ];
}

function testCustomForbidden(dialogue: string, profile: SpeechProfile): SpeechViolation[] {
  const out: SpeechViolation[] = [];
  for (const label of profile.forbidden_speech_patterns) {
    if (label.length < 2) continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      const re = new RegExp(escaped, "i");
      if (re.test(dialogue)) {
        out.push({
          type: "forbidden_pattern",
          matched: [label],
          excerpt: dialogue.slice(0, 100),
          severity: "warn",
        });
      }
    } catch {
      // descriptive label — skip regex
    }
  }
  return out;
}

export function validateSpeechLock(text: string, profile: SpeechProfile): SpeechValidationResult {
  const dialogues = extractCharacterDialogue(text, profile.charName);
  const scanTargets = dialogues.length > 0 ? dialogues : [text.slice(0, 2000)];
  const violations: SpeechViolation[] = [];

  for (const line of scanTargets) {
    violations.push(...testGlobalForbidden(line));
    violations.push(...testFormalityDrift(line, profile));
    violations.push(...testClassDrift(line, profile));
    violations.push(...testModernSlangInHistorical(line, profile));
    violations.push(...testEndingAnchorDrift(line, profile));
    violations.push(...testCustomForbidden(line, profile));
  }

  const deduped = violations.filter(
    (v, i, arr) =>
      arr.findIndex(
        (x) => x.type === v.type && x.matched.join() === v.matched.join() && x.excerpt === v.excerpt
      ) === i
  );

  const failCount = deduped.filter((v) => v.severity === "fail").length;
  const valid = failCount === 0;
  const shouldRewrite = failCount > 0 || deduped.filter((v) => v.severity === "warn").length >= 2;

  return { valid, violations: deduped, shouldRewrite };
}

export function interceptSpeechLock(text: string, profile: SpeechProfile): SpeechValidationResult {
  return validateSpeechLock(text, profile);
}
