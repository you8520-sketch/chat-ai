import type { CharacterGender } from "./characterGender";
import type { CharacterChunk } from "@/types";

/** 설정에 수염·턱수염 등이 명시됐는지 */
const BEARD_IN_SETTING =
  /수염|턱수염|콧수염|인중(?:수염)?|full\s*beard|beard|goatee|mustache|stubble|whiskers/i;

/** 설정에 음모·체모 등이 명시됐는지 (거의 항상 false → 기본 금지) */
const BODY_HAIR_IN_SETTING =
  /음모|체모|겨드랑이\s*털|다리\s*털|pubic|body\s*hair|陰毛|体毛|성기\s*(?:주변|周).*털|휘파람\s*털/i;

/** 출력에서 제거할 수염 묘사 (문장 단위) — bare "인중"(입술/비인중)은 제외 */
const BEARD_IN_OUTPUT =
  /수염|턱수염|콧수염|인중수염|수염자국|면도(?:하지|안)\s*(?:않|한)|(?:거친|깔?끔(?:히)?)\s*(?:면도|턱)|(?:자라(?:난|는))\s*수염|수염이\s*(?:난|자라|덮)/;

/** 출력에서 제거할 음모·체모 묘사 (문장 단위) — "털이 서리친 몸" 등 전율 표현은 제외 */
const BODY_HAIR_IN_OUTPUT =
  /음모|체모|겨드랑이(?:의|에)?\s*(?:털|잔털)|(?:사타구니|성기|음부|휘파람|인퀴덤)(?:.{0,12})?(?:털|잔털|체모)|(?:잔|거친|검은|부드러운)\s*털(?:이|이\s*(?:난|복|솟|돋|보)|(?:의|을))/;

export function collectCharacterSettingText(chunks: CharacterChunk[]): string {
  return chunks.map((c) => c.content).join("\n");
}

/** @deprecated import from @/lib/characterKnowledgeBoundary */
export { buildCharacterCanonBlock, buildStructuredCharacterCanonBlock } from "@/lib/characterKnowledgeBoundary";

export function settingAllowsBeardDescription(settingText: string): boolean {
  return BEARD_IN_SETTING.test(settingText);
}

export function settingAllowsBodyHairDescription(settingText: string): boolean {
  return BODY_HAIR_IN_SETTING.test(settingText);
}

export type HairDescriptionPolicy = {
  charGender: CharacterGender;
  userGender?: CharacterGender;
  allowsBeard: boolean;
  allowsBodyHair: boolean;
};

export function resolveHairDescriptionPolicy(
  charGender: CharacterGender,
  settingText: string,
  userGender?: CharacterGender
): HairDescriptionPolicy {
  return {
    charGender,
    userGender,
    allowsBeard: charGender === "female" ? false : settingAllowsBeardDescription(settingText),
    allowsBodyHair: settingAllowsBodyHairDescription(settingText),
  };
}

export function buildBodyHairDescriptionRule(policy: HairDescriptionPolicy): string {
  const lines = [
    `[수염·음모(체모) 묘사 — 필수]
롤플레잉에서 **설정에 없는 신체 털**을 임의로 추가하지 마라. 많은 이용자(특히 여성)가 수염·음모 묘사를 매우 싫어한다.`,
  ];

  if (policy.charGender === "female") {
    lines.push(
      "캐릭터는 **여성**이다. 캐릭터에게 수염·턱수염·콧수염·인중·수염자국·면도 흔적 묘사 **절대 금지**."
    );
  } else if (!policy.allowsBeard) {
    lines.push(
      "캐릭터 외형 설정에 **수염·턱수염·콧수염·인중이 없다**. 캐릭터의 수염·수염자국·면도 흔적 묘사 **금지**. 깔끔한 턱·입 주변만 서술하라."
    );
  }

  if (!policy.allowsBodyHair) {
    lines.push(
      `캐릭터·유저 페르소나 모두 **음모·체모·겨드랑이·인퀴덤·다리·복부·성기 주변 털** 등 신체 털 묘사 **전면 금지**.
설정·User Note·CRITICAL에 명시되지 않은 털은 **존재하지 않는 것**으로 간주하고, 지문·대사·NSFW 장면에서도 쓰지 마라.`
    );
  }

  if (policy.userGender === "female") {
    lines.push("유저 페르소나는 **여성**이다. 유저에게 수염·음모·체모 묘사 **절대 금지**.");
  }

  if (policy.allowsBeard) {
    lines.push("캐릭터 설정에 수염이 있으므로, **설정에 맞는 범위에서만** 수염을 묘사할 수 있다.");
  }
  if (policy.allowsBodyHair) {
    lines.push("설정에 체모/음모가 명시된 경우에만, **설정 범위 내에서만** 묘사하라.");
  }

  return lines.join("\n");
}

function findHairViolation(trimmed: string, policy: HairDescriptionPolicy): string | null {
  if (!policy.allowsBeard && BEARD_IN_OUTPUT.test(trimmed)) {
    return trimmed.match(BEARD_IN_OUTPUT)?.[0] ?? "beard";
  }
  if (!policy.allowsBodyHair && BODY_HAIR_IN_OUTPUT.test(trimmed)) {
    return trimmed.match(BODY_HAIR_IN_OUTPUT)?.[0] ?? "body-hair";
  }
  if (policy.charGender === "female" && BEARD_IN_OUTPUT.test(trimmed)) {
    return trimmed.match(BEARD_IN_OUTPUT)?.[0] ?? "beard-female-char";
  }
  if (policy.userGender === "female" && BEARD_IN_OUTPUT.test(trimmed)) {
    return trimmed.match(BEARD_IN_OUTPUT)?.[0] ?? "beard-female-user";
  }
  if (
    policy.userGender === "female" &&
    !policy.allowsBodyHair &&
    BODY_HAIR_IN_OUTPUT.test(trimmed)
  ) {
    return trimmed.match(BODY_HAIR_IN_OUTPUT)?.[0] ?? "body-hair-female-user";
  }
  return null;
}

/** AI 출력 후 안전망 — 해당 문장 제거 (문단·공백 구조 보존) */
export function sanitizeHairDescriptions(text: string, policy: HairDescriptionPolicy): string {
  if (policy.allowsBeard && policy.allowsBodyHair) return text;

  // Fast path: no violation pattern anywhere → byte-identical output.
  if (!text || !hasAnyHairViolation(text, policy)) return text;

  const { result, violations, droppedChars } = removeHairViolationsPreservingParagraphs(text, policy);

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

/** Whole-text quick check: does any violation pattern match anywhere? */
function hasAnyHairViolation(text: string, policy: HairDescriptionPolicy): boolean {
  if (!policy.allowsBeard && BEARD_IN_OUTPUT.test(text)) return true;
  if (!policy.allowsBodyHair && BODY_HAIR_IN_OUTPUT.test(text)) return true;
  if (policy.charGender === "female" && BEARD_IN_OUTPUT.test(text)) return true;
  if (policy.userGender === "female" && BEARD_IN_OUTPUT.test(text)) return true;
  if (
    policy.userGender === "female" &&
    !policy.allowsBodyHair &&
    BODY_HAIR_IN_OUTPUT.test(text)
  ) {
    return true;
  }
  return false;
}

type Span = { start: number; end: number };

/**
 * Quote-aware sentence span finder. A sentence ends at [.!?…] followed by
 * whitespace or end-of-string, but ONLY when not inside a quote region.
 * Quoted dialogue ("…" / "…") is treated atomically — never split inside.
 */
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
      // Treat both curly quote chars as quote openers; close on any curly/straight close.
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

/**
 * Paragraph-preserving, range-based violation removal.
 *
 * Splits on blank-line paragraph boundaries (capturing the original separators),
 * finds violation sentence spans within each paragraph using a quote-aware
 * sentence splitter, and splices only those spans out of the original text.
 * Never inserts new newlines or blank lines; never reflows sentences into
 * separate paragraphs.
 */
function removeHairViolationsPreservingParagraphs(
  text: string,
  policy: HairDescriptionPolicy
): { result: string; violations: string[]; droppedChars: number } {
  // Split into [paragraph, separator, paragraph, separator, ..., paragraph] keeping
  // original blank-line separators. Even indices are paragraphs, odd are separators.
  const parts = text.split(/(\r?\n\r?\n+)/);
  const violations: string[] = [];
  let droppedChars = 0;

  // Build a list of { sep, para } items, where sep is the separator that PRECEDES para.
  // The first paragraph has sep = "" (no preceding separator).
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

  // For each paragraph, compute the (possibly modified) kept text and whether the
  // whole paragraph is dropped (all sentences are violations).
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
      const v = findHairViolation(trimmed, policy);
      if (v) {
        violations.push(v);
        droppedChars += trimmed.length;
        return false;
      }
      return true;
    });

    if (keepMask.every((k) => k)) {
      // No violation in this paragraph — keep byte-identical.
      return { sep: it.sep, para: part, dropped: false };
    }
    if (keepMask.every((k) => !k)) {
      // Entire paragraph is violations — drop the paragraph; its surrounding
      // separators are cleaned up locally below.
      return { sep: it.sep, para: "", dropped: true };
    }

    // Mixed: keep non-violation sentences joined by the ORIGINAL inter-sentence
    // whitespace, preserving the paragraph as a single block.
    const keptPieces: string[] = [];
    for (let i = 0; i < spans.length; i++) {
      if (!keepMask[i]) continue;
      const sentence = part.slice(spans[i]!.start, spans[i]!.end);
      if (keptPieces.length === 0) {
        // First kept sentence: drop leading whitespace that was the separator
        // from a removed preceding violation within this paragraph.
        keptPieces.push(sentence.replace(/^\s+/, ""));
      } else {
        // Reproduce original whitespace between the previous kept sentence
        // end and this sentence start.
        const prevEnd = spans[i - 1]!.end;
        const gapStart = spans[i]!.start;
        const gap = part.slice(prevEnd, gapStart);
        keptPieces.push(gap);
        keptPieces.push(sentence);
      }
    }
    return { sep: it.sep, para: keptPieces.join(""), dropped: false };
  });

  // Rebuild with localized separator cleanup. When a paragraph is dropped, the
  // separator before it and the separator before the next kept paragraph become
  // adjacent — merge them into ONE normal paragraph separator. Other separators
  // (including unrelated 3+ newlines, scene gaps, trailing newlines, CRLF)
  // are preserved byte-identical.
  const out: string[] = [];
  let pendingSep = "";
  let pendingIsMerge = false;
  // Track whether any kept paragraph content has been emitted yet, so that a
  // dropped leading paragraph does NOT produce a leading blank line: the first
  // kept paragraph starts the result with no preceding separator.
  let emittedKeptParagraph = false;
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!;
    const isLast = i === resolved.length - 1;
    const isEmptyCarrier = r.para === "" && isLast;

    if (r.dropped) {
      // This paragraph is removed. The separator that preceded it (r.sep) and
      // the separator that will precede the next kept paragraph must merge into
      // one normal separator. Mark pending merge.
      if (!emittedKeptParagraph) {
        // No kept content emitted yet — a leading dropped paragraph must not
        // produce any leading separator. Keep pending empty.
        pendingSep = "";
        pendingIsMerge = true;
      } else if (pendingIsMerge) {
        // Already merging (previous paragraph was also dropped) — keep merging.
        pendingIsMerge = true;
      } else {
        // Begin a merge: the separator before this dropped paragraph is the
        // start of the merged separator.
        pendingSep = r.sep;
        pendingIsMerge = true;
      }
      continue;
    }

    // Trailing empty carrier item (input ended with a blank-line separator).
    if (isEmptyCarrier) {
      if (pendingIsMerge) {
        // Preceded by a dropped trailing paragraph — absorb the trailing
        // separator so no trailing blank line is (re)introduced.
        pendingIsMerge = true;
        continue;
      }
      // Preceded by a kept paragraph — preserve the original trailing
      // separator byte-identical (unrelated trailing newline).
      out.push(r.sep);
      continue;
    }

    // Kept paragraph with content.
    if (pendingIsMerge) {
      // A previous paragraph was dropped: merge pendingSep + this paragraph's
      // own preceding separator (r.sep) into one normal paragraph separator —
      // but ONLY if some kept content was already emitted. If this is the first
      // kept paragraph, do not emit a leading separator.
      if (emittedKeptParagraph) {
        const nl = /\r/.test(pendingSep) || /\r/.test(r.sep) ? "\r\n\r\n" : "\n\n";
        out.push(nl);
      }
      pendingIsMerge = false;
      pendingSep = "";
    } else {
      // No drop occurred before this paragraph — emit its original preceding
      // separator byte-identical (but never a leading separator before the
      // first kept content).
      if (emittedKeptParagraph) {
        out.push(r.sep);
      }
    }
    out.push(r.para);
    emittedKeptParagraph = true;
  }
  // If the LAST paragraph(s) were dropped, pendingIsMerge is true with nothing
  // after them — omit any trailing separator (no trailing blanks introduced
  // by removal). Nothing to push.
  if (pendingIsMerge) {
    // Trailing dropped paragraph(s): omit the trailing separator entirely.
    // (Do NOT add a trailing blank line.)
  }

  return { result: out.join(""), violations, droppedChars };
}
