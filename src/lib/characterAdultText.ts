import { normalizeCommentTextForModeration } from "@/lib/commentTextNormalize";

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

export function findAdultTermsInText(raw: string): string[] {
  const text = String(raw ?? "");
  if (!text.trim()) return [];
  const hits = new Set<string>();
  const normalized = normalizeCommentTextForModeration(text);
  for (const word of ADULT_SUBSTRINGS) {
    const needle = normalizeCommentTextForModeration(word);
    if (!needle) continue;
    if (normalized.includes(needle)) hits.add(word);
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
