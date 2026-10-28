/** 우회 문자 치환 — 운영 중 확장 가능 */
export const COMMENT_SIMILAR_CHAR_MAP: Record<string, string> = {
  "1": "ㅣ",
  l: "ㅣ",
  i: "ㅣ",
  I: "ㅣ",
  "|": "ㅣ",
  "0": "ㅇ",
  o: "ㅇ",
  O: "ㅇ",
  "@": "a",
  "$": "s",
};

/** 자주 쓰이는 자모 우회 → 음절 (금지어 매칭 보조) */
const JAMO_MERGE_REPLACERS: [RegExp, string][] = [
  [/ㅅㅣ/g, "시"],
  [/ᄉㅣ/g, "시"],
  [/ㅆㅣ/g, "씨"],
  [/ㅂㅏ/g, "바"],
  [/ㅅㅐ/g, "새"],
];

function collapseRepeatedChars(text: string): string {
  return text.replace(/(.)\1{2,}/gu, "$1$1");
}

const SPECIAL_EXCEPT_SPACE_RE = /[^\p{L}\p{N}\s]/gu;
const HANGUL_OR_JAMO = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;
const ALWAYS_SUBSTITUTE = new Set(["1", "0", "|", "@", "$"]);

function applySimilarCharMap(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const prev = i > 0 ? text[i - 1]! : "";
    if (ALWAYS_SUBSTITUTE.has(ch)) {
      out += COMMENT_SIMILAR_CHAR_MAP[ch] ?? ch;
      continue;
    }
    if ((ch === "l" || ch === "i" || ch === "I" || ch === "o" || ch === "O") && HANGUL_OR_JAMO.test(prev)) {
      out += COMMENT_SIMILAR_CHAR_MAP[ch] ?? ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function mergeJamoBypass(text: string): string {
  let out = text;
  for (const [re, rep] of JAMO_MERGE_REPLACERS) {
    out = out.replace(re, rep);
  }
  return out;
}

const INVISIBLE_RE = /[\u200B-\u200D\uFEFF\u2060]/g;

/**
 * Bypass fold that keeps real word spaces.
 * Zero-width characters, punctuation, and similar-char/jamo tricks are removed
 * so "보.지" / "보\u200b지" collapse into one eojeol, while "탁자 위" stays two.
 * Comment bans still drop the remaining spaces in `normalizeCommentTextForModeration`.
 */
export function normalizeCommentTextKeepingWordSpaces(raw: string): string {
  let text = raw.normalize("NFKC").toLowerCase().replace(INVISIBLE_RE, "");
  text = text.replace(/\s+/g, " ").trim();
  text = applySimilarCharMap(text);
  text = text.replace(SPECIAL_EXCEPT_SPACE_RE, "");
  text = collapseRepeatedChars(text);
  text = mergeJamoBypass(text);
  return text.replace(/ +/g, " ").trim();
}

/** 댓글 금지어 검사용 정규화. 우회 문자를 접은 뒤 남은 공백까지 제거한다. */
export function normalizeCommentTextForModeration(raw: string): string {
  return normalizeCommentTextKeepingWordSpaces(raw).replace(/\s/g, "");
}
