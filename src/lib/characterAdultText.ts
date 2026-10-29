import { normalizeCommentTextKeepingWordSpaces } from "@/lib/commentTextNormalize";

/** Explicit adult-fiction terms. Mild romance (키스, 설렘) is not included. */
const ADULT_SUBSTRINGS = [
  "섹스",
  "섹쓰",
  "성교",
  "성행위",
  "자위",
  "자지",
  "보지",
  "음경",
  "음부",
  "음핵",
  "클리토리스",
  "페니스",
  "정액",
  "사정",
  "삽입",
  "오르가즘",
  "오르가슴",
  "펠라치오",
  "펠라",
  "커닐링구스",
  "야설",
  "야동",
  "포르노",
  "오나홀",
  "박아줘",
  "박아버",
  "박아넣",
];

const ADULT_ENGLISH_RE =
  /\b(?:fuck|fucking|pussy|cock|dick|cumshot|creampie|blowjob|handjob|hentai|porn|porno|nsfw|anal sex|dildo|fellatio|cunnilingus)\b/i;

/**
 * These stems are also ordinary Korean pieces (`탁자 위`, `알아보지`, `그 사정`).
 * They match only at an eojeol start, or when separators split the stem itself.
 * Every other adult stem is unambiguous and may sit inside a compound (`폰섹스`).
 */
const AMBIGUOUS_ADULT_TERMS = new Set(["자위", "자지", "보지", "사정"]);

const NEGATIVE_SEE_NEXT = /^(?:않|못|말)/u;
const NEGATIVE_SEE_EOJEOL = /^(?:보지|보지는|보지도)$/u;
/** Ordinary circumstance particles on 사정 (`누구의 사정도`). Bare, object, and verbal forms stay adult. */
const ORDINARY_SAJEONG_EOJEOL = /^사정(?:이|은|는|도|에|과|와|만|으로|로|까지|뿐|처럼|보다|상|없이)$/u;

function isOrdinaryCircumstanceSajeong(eojeol: string): boolean {
  return ORDINARY_SAJEONG_EOJEOL.test(eojeol);
}

/** A banned term split only by evasion separators, not by a real eojeol boundary inside a longer word. */
function termSplitAcrossEojeols(eojeols: readonly string[], term: string): boolean {
  for (let i = 0; i < eojeols.length; i += 1) {
    let acc = "";
    for (let j = i; j < eojeols.length; j += 1) {
      const piece = eojeols[j] ?? "";
      const remain = term.slice(acc.length);
      if (j === i) {
        if (piece.length >= term.length || !term.startsWith(piece)) break;
        acc = piece;
        continue;
      }
      if (piece.startsWith(remain)) return true;
      if (remain.startsWith(piece) && piece.length > 0) {
        acc += piece;
        if (acc.length === term.length) return true;
        continue;
      }
      break;
    }
  }
  return false;
}

export function findAdultTermsInText(raw: string): string[] {
  const text = String(raw ?? "");
  if (!text.trim()) return [];
  const hits = new Set<string>();
  const spaced = normalizeCommentTextKeepingWordSpaces(text);
  const eojeols = spaced.split(" ").filter(Boolean);
  for (const word of ADULT_SUBSTRINGS) {
    const term = normalizeCommentTextKeepingWordSpaces(word).replace(/\s/g, "");
    if (!term) continue;
    const ambiguous = AMBIGUOUS_ADULT_TERMS.has(term);
    let matched = false;
    for (let i = 0; i < eojeols.length; i += 1) {
      const eojeol = eojeols[i] ?? "";
      if (!(ambiguous ? eojeol.startsWith(term) : eojeol.includes(term))) continue;
      if (ambiguous && term === "보지" && NEGATIVE_SEE_EOJEOL.test(eojeol) && NEGATIVE_SEE_NEXT.test(eojeols[i + 1] ?? "")) continue;
      if (ambiguous && term === "사정" && isOrdinaryCircumstanceSajeong(eojeol)) continue;
      matched = true;
      break;
    }
    if (!matched && termSplitAcrossEojeols(eojeols, term)) matched = true;
    if (matched) hits.add(word);
  }
  const english = text.match(ADULT_ENGLISH_RE);
  if (english) hits.add(english[0].toLowerCase());
  return [...hits];
}

export function characterAdultTextBlob(input: {
  name?: string;
  tagline?: string;
  description?: string;
  greeting?: string;
  creatorComment?: string;
  tags?: string[] | string;
}): string {
  const tags = Array.isArray(input.tags)
    ? input.tags.join(" ")
    : String(input.tags ?? "");
  return [
    input.name,
    input.tagline,
    input.description,
    input.greeting,
    input.creatorComment,
    tags,
  ]
    .map((part) => String(part ?? ""))
    .join("\n");
}

export const ALL_AGES_ADULT_TEXT_ERROR =
  "일반 캐릭터 공개 글에 성인물 표현이 있습니다. 해당 단어를 지우거나 성인용 캐릭터로 표시해 주세요.";

export const ALL_AGES_ADULT_ASSET_ERROR =
  "일반 캐릭터 에셋에 유두·성기·항문 노출이 감지되었습니다. 해당 이미지를 다른 에셋으로 바꿔 주세요.";
