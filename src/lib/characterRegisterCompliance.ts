/** Step 7.5 — measure dialogue register vs character-card expectation for a scene context. */

import { extractDialogueLines } from "@/lib/registerMetaAudit";

export type ExpectedRegister = "haeyo" | "formal" | "danakka" | "banmal";

// Any Hangul syllable + 요 before end punctuation is 해요체 (generic polite -요
// ending: 만요/나요/여요/거든요/그럼요/히요/서요 …). Specific variants kept for clarity.
const HAeyo_RE =
  /(?:해요|어요|아요|예요|이에요|이예요|에요|세요|죠|네요|군요|래요|가요|까요|줘요|돼요|자요|데요|게요|[가-힣]요|습니까\?)(?:[.!?…,?]|$)/;
const HAeyo_ANYWHERE_RE =
  /(?:해요|어요|아요|예요|이에요|이예요|에요|세요|죠|네요|군요|래요|가요|까요|줘요|돼요|자요|데요|게요)/;
const FORMAL_RE = /(?:습니다|십니다|합니다|입니다|그렇습니다)(?:[.!?…]|$)/;
const FORMAL_ANYWHERE_RE = /(?:습니다|십니다|합니다|입니다|습니까|십니까)/;
const DANAKKA_RE =
  /(?:십시오|하십시오|하옵|하오|이옵|하였소|하리오)(?:[.!?…]|$)|(?:[가-힣]+(?:십시오|하십시오))(?:[.!?…]|$)/;
// Common banmal sentence endings. -어/-아/-라/-자/-래/-거든/-는데 are the bulk of
// casual speech; haeyo/formal are checked BEFORE banmal so 요/습니다 forms never land here.
const BANMAL_RE =
  /(?:[^다]|^)(?:다|야|지|네|군|잖아|거야|냐|니|해|돼|어|아|라|자|래|게|거든|는데|다고|라고|자고|냐고)(?:[.!?…]|$)/;
const HAeyo_TYPO_RE = /괜[아]?나요(?:[.!?…]|$)/;

function stripTrailingEllipsis(text: string): string {
  return text.replace(/(?:\.{2,}|…)+$/g, "").trim();
}

function lineEndingCandidates(line: string): string[] {
  const t = line.trim();
  const out = new Set<string>([t]);
  const stripped = stripTrailingEllipsis(t);
  if (stripped) out.add(stripped);
  for (const part of t.split(/(?:\.{2,}|…)+/)) {
    const p = part.trim();
    if (p) out.add(p);
  }
  return [...out];
}

function endingClassifiers(text: string): ExpectedRegister | "other" {
  const t = text.trim();
  if (!t) return "other";
  if (HAeyo_TYPO_RE.test(t)) return "haeyo";
  if (DANAKKA_RE.test(t)) return "danakka";
  if (FORMAL_RE.test(t)) return "formal";
  if (HAeyo_RE.test(t)) return "haeyo";
  if (BANMAL_RE.test(t)) return "banmal";
  return "other";
}

/** Lines excluded from compliance denominator — not register violations. */
export function isNeutralScoringLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^(?:\.{2,}|…+)+[.!?,]*$/.test(t)) return true;
  if (/^…?렌[.!?…,]*$/.test(t)) return true;
  if (/^\.{2,}렌[.!?…,]*$/.test(t)) return true;
  if (/^끄?응+(?:\.{2,}|…)*$/i.test(t)) return true;
  // Standalone polite affirmative "네"/"예" — polite yes, not banmal drift.
  if (/^(?:\.{2,}|…)?(?:네|예)[.!?…,]*$/.test(t)) return true;
  if (
    /^\.{2,}[가-힣]{1,6}[.!?…]*$/.test(t) &&
    endingClassifiers(t) === "other"
  ) {
    return true;
  }
  if (/^…?[가-힣]{1,10}(?:으로|로|까지|에게|서)[.!?…]*$/.test(t) && endingClassifiers(t) === "other") {
    return true;
  }
  // Vocative / topic fragments addressing someone by name: "렌 씨.", "…하율 씨는."
  if (/^(?:\.{2,}|…)?[가-힣]{1,6}\s?씨(?:는|가|도)?[.!?…,]*$/.test(t) && endingClassifiers(t) === "other") {
    return true;
  }
  if (
    /(?:\.{2,}|…)$/.test(t) &&
    endingClassifiers(stripTrailingEllipsis(t)) === "other" &&
    !HAeyo_ANYWHERE_RE.test(t) &&
    !DANAKKA_RE.test(t) &&
    !FORMAL_RE.test(t) &&
    !BANMAL_RE.test(t)
  ) {
    return true;
  }
  return false;
}

export function classifyLineRegister(line: string): ExpectedRegister | "other" {
  for (const candidate of lineEndingCandidates(line)) {
    const reg = endingClassifiers(candidate);
    if (reg !== "other") return reg;
  }
  if (HAeyo_TYPO_RE.test(line.trim())) return "haeyo";
  return "other";
}

function matchesExpected(got: ExpectedRegister | "other", expected: ExpectedRegister): boolean {
  if (got === "other") return false;
  if (expected === "haeyo") return got === "haeyo";
  if (expected === "formal") return got === "formal" || got === "danakka";
  if (expected === "danakka") return got === "danakka" || got === "formal";
  if (expected === "banmal") return got === "banmal";
  return false;
}

function lineHasDriftEnding(line: string, expected: ExpectedRegister): boolean {
  for (const candidate of lineEndingCandidates(line)) {
    const reg = endingClassifiers(candidate);
    if (reg !== "other" && !matchesExpected(reg, expected)) return true;
  }
  return false;
}

function lineMatchesExpected(line: string, expected: ExpectedRegister): boolean {
  if (isNeutralScoringLine(line)) return true;

  for (const candidate of lineEndingCandidates(line)) {
    const reg = endingClassifiers(candidate);
    if (matchesExpected(reg, expected)) return true;
  }

  if (expected === "haeyo") {
    const hasHaeyo = HAeyo_ANYWHERE_RE.test(line) || HAeyo_TYPO_RE.test(line);
    if (hasHaeyo && !lineHasDriftEnding(line, expected)) return true;
  }

  if (expected === "banmal") {
    // Banmal is the UNMARKED register — its endings are open-ended (건데/꺼내/
    // 기다려/물었나/없고/마 …) and cannot be enumerated. Absence of polite or
    // formal markers anywhere in the line means the line is banmal-consistent.
    const hasPoliteMarker =
      HAeyo_ANYWHERE_RE.test(line) ||
      HAeyo_TYPO_RE.test(line) ||
      FORMAL_ANYWHERE_RE.test(line) ||
      DANAKKA_RE.test(line);
    if (!hasPoliteMarker && !lineHasDriftEnding(line, expected)) return true;
  }

  return false;
}

export type RegisterComplianceResult = {
  dialogueCount: number;
  /** Lines counted in compliance denominator (excludes neutral fragments). */
  scorableDialogueCount: number;
  matchingCount: number;
  complianceRate: number;
  driftKinds: string[];
  sampleMisses: string[];
};

export function evaluateRegisterCompliance(
  text: string,
  expected: ExpectedRegister
): RegisterComplianceResult {
  const lines = extractDialogueLines(text);
  const scorable = lines.filter((l) => !isNeutralScoringLine(l));
  const kinds = new Set<string>();
  let matching = 0;
  const misses: string[] = [];

  for (const line of scorable) {
    const reg = classifyLineRegister(line);
    if (reg !== "other") kinds.add(reg);
  }

  for (const line of scorable) {
    if (lineMatchesExpected(line, expected)) matching++;
    else if (scorable.length <= 12) {
      const reg = classifyLineRegister(line);
      misses.push(`[${reg}] ${line.slice(0, 72)}`);
    }
  }

  const driftKinds = [...kinds].filter((k) => !matchesExpected(k as ExpectedRegister, expected));

  const denominator = scorable.length;
  const complianceRate = denominator
    ? Math.round((matching / denominator) * 1000) / 10
    : lines.length
      ? 100
      : 0;

  return {
    dialogueCount: lines.length,
    scorableDialogueCount: scorable.length,
    matchingCount: matching,
    complianceRate,
    driftKinds,
    sampleMisses: misses.slice(0, 4),
  };
}
