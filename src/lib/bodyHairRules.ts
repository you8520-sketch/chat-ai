import type { CharacterGender } from "./characterGender";
import type { CharacterChunk } from "@/types";

const BEARD_TERM =
  /수염|턱수염|콧수염|인중수염|full\s*beard|beard|goatee|mustache|stubble|whiskers/i;

const BODY_HAIR_TERM =
  /음모|체모|겨드랑이\s*털|다리\s*털|pubic|body\s*hair|陰毛|体毛|성기\s*(?:주변|周).*털|휘파람\s*털/i;

/** Explicit absence — evaluated before presence. */
const FACIAL_HAIR_ABSENT =
  /(?:수염|턱수염|콧수염|인중(?:수염)?)\s*(?:이|은|가|를|도)?\s*(?:없(?:음|다|는|을|이)?|없이|무)|(?:없(?:음|다|는|이)?\s*(?:수염|턱수염|콧수염))|(?:no|without)\s+(?:facial\s*)?(?:hair|beard|stubble)/i;

const BODY_HAIR_ABSENT =
  /(?:음모|체모|겨드랑이(?:\s*털)?|다리\s*털)\s*(?:이|은|가|를|도)?\s*(?:없(?:음|다|는|을|이)?|없이|무)|(?:없(?:음|다|는|이)?\s*(?:음모|체모))/i;

const FACIAL_HAIR_PRESENT =
  /(?:짙(?:은|게)|거친|깔?(?:끔(?:히)?\s*다듬(?:은|어)?|자(?:라|란)|난|복)|(?:기(?:른|어)?)\s*)(?:\s*)?(?:수염|턱수염|콧수염)|(?:수염|턱수염|콧수염)\s*(?:이\s*(?:있(?:다|음|는)?|자라|난|나|복)|(?:과|와))|(?:has|with)\s+(?:a\s+)?(?:beard|stubble)/i;

const BODY_HAIR_PRESENT =
  /(?:짙(?:은|게)|거친|(?:복(?:슬|잡)|(?:난|자라(?:난|는)))\s*)(?:\s*)?(?:음모|체모)|(?:음모|체모)\s*(?:이\s*(?:있(?:다|음|는)?|난|복)|(?:과|와))/i;

/** Output beard/stubble cues (sentence-level). Bare "인중"(philtrum) excluded. */
const BEARD_IN_OUTPUT =
  /수염|턱수염|콧수염|인중수염|수염자국|면도(?:하지|안)\s*(?:않|한)|(?:거친|깔?끔(?:히)?)\s*(?:면도|턱)|(?:자라(?:난|는))\s*수염|수염이\s*(?:난|자라|덮)|(?:까칠|까슬)(?:한|해진|하게)?\s*턱(?:선)?|턱(?:선)?(?:이|을|은|은)?\s*(?:까칠|까슬)(?:한|해진|하게)?|면도\s*흔적/;

const BODY_HAIR_IN_OUTPUT =
  /음모|체모|겨드랑이(?:의|에)?\s*(?:털|잔털)|(?:사타구니|성기|음부|휘파람|인퀴덤)(?:.{0,12})?(?:털|잔털|체모)|(?:잔|거친|검은|부드러운)\s*털(?:이|이\s*(?:난|복|솟|돋|보)|(?:의|을))/;

export type HairPresence = "present" | "absent" | "unknown";

export type HairEvidenceKind =
  | "explicit_present"
  | "explicit_absent"
  | "default_absent"
  | "unknown";

export type SubjectHairPolicy = {
  subject: "character" | "user_persona";
  gender: CharacterGender;
  facialHair: HairPresence;
  bodyHair: HairPresence;
  evidence: {
    facialHair: HairEvidenceKind;
    bodyHair: HairEvidenceKind;
  };
};

export type HairDescriptionPolicy = {
  charGender: CharacterGender;
  userGender?: CharacterGender;
  allowsBeard: boolean;
  allowsBodyHair: boolean;
};

export type HairSanitizeContext = {
  character: SubjectHairPolicy;
  userPersona: SubjectHairPolicy;
  characterNames: string[];
  userPersonaNames: string[];
};

export function collectCharacterSettingText(chunks: CharacterChunk[]): string {
  return chunks.map((c) => c.content).join("\n");
}

/** @deprecated import from @/lib/characterKnowledgeBoundary */
export { buildCharacterCanonBlock, buildStructuredCharacterCanonBlock } from "@/lib/characterKnowledgeBoundary";

function classifyHairField(
  text: string,
  termRe: RegExp,
  absentRe: RegExp,
  presentRe: RegExp,
  defaultWhenUnmentioned: HairPresence
): { presence: HairPresence; evidence: HairEvidenceKind } {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      presence: defaultWhenUnmentioned,
      evidence: defaultWhenUnmentioned === "absent" ? "default_absent" : "unknown",
    };
  }
  if (absentRe.test(trimmed)) {
    return { presence: "absent", evidence: "explicit_absent" };
  }
  if (presentRe.test(trimmed)) {
    return { presence: "present", evidence: "explicit_present" };
  }
  if (termRe.test(trimmed)) {
    return { presence: "present", evidence: "explicit_present" };
  }
  return {
    presence: defaultWhenUnmentioned,
    evidence: defaultWhenUnmentioned === "absent" ? "default_absent" : "unknown",
  };
}

export function parseFacialHairFromText(
  text: string,
  _gender: CharacterGender
): { presence: HairPresence; evidence: HairEvidenceKind } {
  // Explicit canon outranks demographic defaults for every gender.
  return classifyHairField(text, BEARD_TERM, FACIAL_HAIR_ABSENT, FACIAL_HAIR_PRESENT, "absent");
}

export function parseBodyHairFromText(text: string): {
  presence: HairPresence;
  evidence: HairEvidenceKind;
} {
  return classifyHairField(text, BODY_HAIR_TERM, BODY_HAIR_ABSENT, BODY_HAIR_PRESENT, "absent");
}

export function resolveCharacterSubjectHairPolicy(
  charGender: CharacterGender,
  settingText: string
): SubjectHairPolicy {
  const facial = parseFacialHairFromText(settingText, charGender);
  const body = parseBodyHairFromText(settingText);
  return {
    subject: "character",
    gender: charGender,
    facialHair: facial.presence,
    bodyHair: body.presence,
    evidence: {
      facialHair: facial.evidence,
      bodyHair: body.evidence,
    },
  };
}

export function resolveUserPersonaSubjectHairPolicy(
  userGender: CharacterGender,
  personaText: string
): SubjectHairPolicy {
  const facial = parseFacialHairFromText(personaText, userGender);
  const body = parseBodyHairFromText(personaText);
  return {
    subject: "user_persona",
    gender: userGender,
    facialHair: facial.presence,
    bodyHair: body.presence,
    evidence: {
      facialHair: facial.evidence,
      bodyHair: body.evidence,
    },
  };
}

export function subjectAllowsFacialHair(policy: SubjectHairPolicy): boolean {
  return policy.facialHair === "present";
}

export function subjectAllowsBodyHair(policy: SubjectHairPolicy): boolean {
  return policy.bodyHair === "present";
}

/** @deprecated Use parseFacialHairFromText — keyword-only helper kept for tests. */
export function settingAllowsBeardDescription(settingText: string): boolean {
  return parseFacialHairFromText(settingText, "male").presence === "present";
}

/** @deprecated Use parseBodyHairFromText */
export function settingAllowsBodyHairDescription(settingText: string): boolean {
  return parseBodyHairFromText(settingText).presence === "present";
}

export function resolveHairDescriptionPolicy(
  charGender: CharacterGender,
  settingText: string,
  userGender?: CharacterGender
): HairDescriptionPolicy {
  const character = resolveCharacterSubjectHairPolicy(charGender, settingText);
  return {
    charGender,
    userGender,
    allowsBeard: subjectAllowsFacialHair(character),
    allowsBodyHair: subjectAllowsBodyHair(character),
  };
}

export function buildHairSanitizeContext(input: {
  characterName: string;
  characterGender: CharacterGender;
  characterAppearanceText: string;
  personaName: string;
  personaText: string;
  userGender: CharacterGender;
  extraCharacterNames?: string[];
  extraPersonaNames?: string[];
}): HairSanitizeContext {
  const characterNames = dedupeNames([
    input.characterName,
    ...(input.extraCharacterNames ?? []),
  ]);
  const userPersonaNames = dedupeNames([
    input.personaName,
    ...(input.extraPersonaNames ?? []),
  ]);
  return {
    character: resolveCharacterSubjectHairPolicy(
      input.characterGender,
      input.characterAppearanceText
    ),
    userPersona: resolveUserPersonaSubjectHairPolicy(input.userGender, input.personaText),
    characterNames,
    userPersonaNames,
  };
}

function dedupeNames(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    if (!n) continue;
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

function facialHairFactValue(policy: SubjectHairPolicy): string | null {
  const facial = subjectAllowsFacialHair(policy) ? "canon" : "none";
  const body = subjectAllowsBodyHair(policy) ? "canon" : "none";
  if (facial === "canon" && body === "canon") return null;
  return `facial_hair=${facial}; body_hair=${body}`;
}

/**
 * Compact structured hair fact for character appearance canon (AI subject only).
 */
export function buildCharacterHairCanonFact(
  policy: SubjectHairPolicy | HairDescriptionPolicy
): string | null {
  if ("subject" in policy) {
    if (policy.subject !== "character") return null;
    return facialHairFactValue(policy);
  }
  const synthetic: SubjectHairPolicy = {
    subject: "character",
    gender: policy.charGender,
    facialHair: policy.allowsBeard ? "present" : "absent",
    bodyHair: policy.allowsBodyHair ? "present" : "absent",
    evidence: {
      facialHair: policy.allowsBeard ? "explicit_present" : "default_absent",
      bodyHair: policy.allowsBodyHair ? "explicit_present" : "default_absent",
    },
  };
  return facialHairFactValue(synthetic);
}

/** Prefer SubjectHairPolicy from resolveCharacterSubjectHairPolicy for accurate facts. */
export function buildCharacterHairCanonFactFromAppearanceText(
  charGender: CharacterGender,
  appearanceText: string
): string | null {
  return facialHairFactValue(resolveCharacterSubjectHairPolicy(charGender, appearanceText));
}

const APPEARANCE_HEADER_RE = /\[(?:외형|외모|Appearance)[^\]]*\]/i;

export function applyCharacterHairCanonFact(canonBlock: string, fact: string | null): string {
  if (!fact) return canonBlock;
  const match = APPEARANCE_HEADER_RE.exec(canonBlock);
  if (!match) return `${canonBlock.trimEnd()}\n\n[외형]\n${fact}`;
  const insertAt = match.index + match[0].length;
  return `${canonBlock.slice(0, insertAt)}\n${fact}${canonBlock.slice(insertAt)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KOREAN_NAME_PARTICLES =
  "(?:은|는|이|가|을|를|의|도|만|에게|한테|께|과|와|랑|이랑|으로|로)?";

function nameInSentence(sentence: string, names: string[]): boolean {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const re = /[가-힣]/.test(name)
      ? new RegExp(
          `(?:^|[^가-힣A-Za-z0-9_])${escaped}${KOREAN_NAME_PARTICLES}(?=$|[^가-힣A-Za-z0-9_])`,
          "i"
        )
      : new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`, "i");
    if (re.test(sentence)) return true;
  }
  return false;
}

type SentenceSubject = "character" | "user_persona" | "ambiguous" | "npc_likely";

function classifySentenceSubject(sentence: string, ctx: HairSanitizeContext): SentenceSubject {
  const charHit = nameInSentence(sentence, ctx.characterNames);
  const userHit = nameInSentence(sentence, ctx.userPersonaNames);
  if (charHit && !userHit) return "character";
  if (userHit && !charHit) return "user_persona";
  if (looksLikeThirdPartyNpc(sentence, ctx)) return "npc_likely";
  return "ambiguous";
}

function looksLikeThirdPartyNpc(sentence: string, ctx: HairSanitizeContext): boolean {
  if (nameInSentence(sentence, ctx.characterNames)) return false;
  if (nameInSentence(sentence, ctx.userPersonaNames)) return false;
  if (/(?:옆|다른|낯선|모르는|테이블|길(?:가|에)|카운터|제3)/.test(sentence)) return true;
  if (/[가-힣]{1,4}\s*(?:형사|경찰|웨이터|손님|의사|간호사|점원|기사)/.test(sentence)) {
    return true;
  }
  return false;
}

function isHairSanitizeContext(value: HairDescriptionPolicy | HairSanitizeContext): value is HairSanitizeContext {
  return "character" in value && "userPersona" in value;
}

function legacyPolicyToSanitizeContext(policy: HairDescriptionPolicy): HairSanitizeContext {
  return {
    character: {
      subject: "character",
      gender: policy.charGender,
      facialHair: policy.allowsBeard ? "present" : "absent",
      bodyHair: policy.allowsBodyHair ? "present" : "absent",
      evidence: {
        facialHair: policy.allowsBeard ? "explicit_present" : "default_absent",
        bodyHair: policy.allowsBodyHair ? "explicit_present" : "default_absent",
      },
    },
    userPersona: {
      subject: "user_persona",
      gender: policy.userGender ?? "other",
      facialHair:
        policy.userGender === "female"
          ? "absent"
          : policy.allowsBeard
            ? "unknown"
            : "unknown",
      bodyHair: policy.userGender === "female" ? "absent" : "unknown",
      evidence: {
        facialHair: policy.userGender === "female" ? "default_absent" : "unknown",
        bodyHair: policy.userGender === "female" ? "default_absent" : "unknown",
      },
    },
    characterNames: [],
    userPersonaNames: [],
  };
}

function shouldEnforceFacialHairOnSubject(
  subject: SentenceSubject,
  ctx: HairSanitizeContext
): boolean {
  switch (subject) {
    case "character":
      return !subjectAllowsFacialHair(ctx.character);
    case "user_persona":
      return !subjectAllowsFacialHair(ctx.userPersona);
    case "npc_likely":
      return false;
    case "ambiguous":
      return (
        !subjectAllowsFacialHair(ctx.character) && !subjectAllowsFacialHair(ctx.userPersona)
      );
    default: {
      const _exhaustive: never = subject;
      return _exhaustive;
    }
  }
}

function shouldEnforceBodyHairOnSubject(
  subject: SentenceSubject,
  ctx: HairSanitizeContext
): boolean {
  switch (subject) {
    case "character":
      return !subjectAllowsBodyHair(ctx.character);
    case "user_persona":
      return !subjectAllowsBodyHair(ctx.userPersona);
    case "npc_likely":
      return false;
    case "ambiguous":
      return !subjectAllowsBodyHair(ctx.character) && !subjectAllowsBodyHair(ctx.userPersona);
    default: {
      const _exhaustive: never = subject;
      return _exhaustive;
    }
  }
}

function findHairViolation(
  trimmed: string,
  ctx: HairSanitizeContext
): string | null {
  const subject = classifySentenceSubject(trimmed, ctx);

  if (BEARD_IN_OUTPUT.test(trimmed)) {
    if (shouldEnforceFacialHairOnSubject(subject, ctx)) {
      return trimmed.match(BEARD_IN_OUTPUT)?.[0] ?? "beard";
    }
  }

  if (BODY_HAIR_IN_OUTPUT.test(trimmed)) {
    if (shouldEnforceBodyHairOnSubject(subject, ctx)) {
      return trimmed.match(BODY_HAIR_IN_OUTPUT)?.[0] ?? "body-hair";
    }
  }


  return null;
}

function policyFullyPermissive(ctx: HairSanitizeContext): boolean {
  return (
    subjectAllowsFacialHair(ctx.character) &&
    subjectAllowsBodyHair(ctx.character) &&
    subjectAllowsFacialHair(ctx.userPersona) &&
    subjectAllowsBodyHair(ctx.userPersona)
  );
}

/** AI 출력 후 안전망 — subject-aware 문장 제거 (문단·공백 구조 보존) */
export function sanitizeHairDescriptions(
  text: string,
  policyOrContext: HairDescriptionPolicy | HairSanitizeContext
): string {
  const ctx = isHairSanitizeContext(policyOrContext)
    ? policyOrContext
    : legacyPolicyToSanitizeContext(policyOrContext);

  if (policyFullyPermissive(ctx)) return text;

  if (!text || !hasAnyHairViolation(text, ctx)) return text;

  const { result, violations, droppedChars } = removeHairViolationsPreservingParagraphs(text, ctx);

  const totalChars = text.length;
  const changedChars = droppedChars;
  const charsChangedRatio = totalChars > 0 ? changedChars / totalChars : 0;

  if (violations.length > 0) {
    const replacementScope: "full" | "partial" =
      result.length === 0 || charsChangedRatio > 0.5 ? "full" : "partial";
    console.log("[hair-sanitize-diagnostic]", {
      violation_phrase: violations[0],
      violation_count: violations.length,
      replacement_scope: replacementScope,
      chars_changed_ratio: charsChangedRatio,
      ...(charsChangedRatio > 0.5 ? { flag_for_review: true } : {}),
    });
  }

  return result.length === 0 ? text : result;
}

function hasAnyHairViolation(text: string, ctx: HairSanitizeContext): boolean {
  if (!BEARD_IN_OUTPUT.test(text) && !BODY_HAIR_IN_OUTPUT.test(text)) return false;
  const parts = text.split(/(?<=[.!?…])\s+|\n+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (findHairViolation(trimmed, ctx)) return true;
  }
  return false;
}

type Span = { start: number; end: number };

function findSentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  const n = text.length;
  let start = 0;
  let inQuote: string | null = null;
  for (let i = 0; i < n; i++) {
    const ch = text[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "\u201C" || ch === "\u201D") {
      inQuote = ch === '"' ? '"' : "\u201D";
      continue;
    }
    if (ch === "." || ch === "!" || ch === "?" || ch === "\u2026") {
      const next = i + 1 < n ? text[i + 1] : "";
      if (next === "" || /\s/.test(next)) {
        spans.push({ start, end: i + 1 });
        start = i + 1;
      }
    }
  }
  if (start < n && text.slice(start).trim()) {
    spans.push({ start, end: n });
  }
  return spans;
}

function removeHairViolationsPreservingParagraphs(
  text: string,
  ctx: HairSanitizeContext
): { result: string; violations: string[]; droppedChars: number } {
  const parts = text.split(/(\r?\n\r?\n+)/);
  const violations: string[] = [];
  let droppedChars = 0;

  type Item = { sep: string; para: string };
  const items: Item[] = [];
  let curSep = "";
  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx]!;
    if (idx % 2 === 1) {
      curSep = part;
      continue;
    }
    items.push({ sep: curSep, para: part });
    curSep = "";
  }

  type Resolved = { sep: string; para: string; dropped: boolean };
  const resolved: Resolved[] = items.map((it) => {
    const part = it.para;
    if (!part) return { sep: it.sep, para: part, dropped: !it.sep };
    const spans = findSentenceSpans(part);
    if (spans.length === 0) return { sep: it.sep, para: part, dropped: false };

    const keepMask = spans.map((s) => {
      const sentence = part.slice(s.start, s.end);
      const trimmed = sentence.trim();
      if (!trimmed) return true;
      const v = findHairViolation(trimmed, ctx);
      if (v) {
        violations.push(v);
        droppedChars += trimmed.length;
        return false;
      }
      return true;
    });

    if (keepMask.every((k) => k)) {
      return { sep: it.sep, para: part, dropped: false };
    }
    if (keepMask.every((k) => !k)) {
      return { sep: it.sep, para: "", dropped: true };
    }

    const keptPieces: string[] = [];
    for (let i = 0; i < spans.length; i++) {
      if (!keepMask[i]) continue;
      const sentence = part.slice(spans[i]!.start, spans[i]!.end);
      if (keptPieces.length === 0) {
        keptPieces.push(sentence.replace(/^\s+/, ""));
      } else {
        const prevEnd = spans[i - 1]!.end;
        const gapStart = spans[i]!.start;
        const gap = part.slice(prevEnd, gapStart);
        keptPieces.push(gap);
        keptPieces.push(sentence);
      }
    }
    return { sep: it.sep, para: keptPieces.join(""), dropped: false };
  });

  const out: string[] = [];
  let pendingSep = "";
  let pendingIsMerge = false;
  let emittedKeptParagraph = false;
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!;
    const isLast = i === resolved.length - 1;
    const isEmptyCarrier = r.para === "" && isLast;

    if (r.dropped) {
      if (!emittedKeptParagraph) {
        pendingSep = "";
        pendingIsMerge = true;
      } else if (pendingIsMerge) {
        pendingIsMerge = true;
      } else {
        pendingSep = r.sep;
        pendingIsMerge = true;
      }
      continue;
    }

    if (isEmptyCarrier) {
      if (pendingIsMerge) {
        pendingIsMerge = true;
        continue;
      }
      out.push(r.sep);
      continue;
    }

    if (pendingIsMerge) {
      if (emittedKeptParagraph) {
        const nl = /\r/.test(pendingSep) || /\r/.test(r.sep) ? "\r\n\r\n" : "\n\n";
        out.push(nl);
      }
      pendingIsMerge = false;
      pendingSep = "";
    } else {
      if (emittedKeptParagraph) {
        out.push(r.sep);
      }
    }
    out.push(r.para);
    emittedKeptParagraph = true;
  }

  return { result: out.join(""), violations, droppedChars };
}
