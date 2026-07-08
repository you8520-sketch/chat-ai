export const CHARACTER_GENRES = [
  "로맨스",
  "로맨스 판타지",
  "현대 판타지",
  "시뮬레이션",
  "현대/일상",
  "학원/스포츠",
  "판타지/SF",
  "무협/시대극",
  "코믹/액션",
  "공포/추리",
  "아포칼립스",
  "BL",
  "GL",
  "인외",
  "기타",
] as const;

export type CharacterGenre = (typeof CHARACTER_GENRES)[number];

const GENRE_SET = new Set<string>(CHARACTER_GENRES);

export function isCharacterGenre(value: string): value is CharacterGenre {
  return GENRE_SET.has(value);
}

/** API·폼 입력 → 유효 장르 배열 (중복 제거, 목록 순서 유지) */
export function sanitizeCharacterGenres(value: unknown): CharacterGenre[] {
  const raw: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) raw.push(item.trim());
    }
  } else if (typeof value === "string" && value.trim()) {
    raw.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
  }
  const seen = new Set<string>();
  const out: CharacterGenre[] = [];
  for (const g of raw) {
    if (!isCharacterGenre(g) || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

export function primaryCharacterGenre(genres: CharacterGenre[]): CharacterGenre {
  return genres[0] ?? "기타";
}

export function toggleCharacterGenre(current: CharacterGenre[], genre: CharacterGenre): CharacterGenre[] {
  if (current.includes(genre)) return current.filter((g) => g !== genre);
  return [...current, genre];
}

/** DB genres JSON 컬럼 + legacy genre 컬럼 필터용 LIKE 패턴 */
export function genreJsonLikePattern(genre: CharacterGenre): string {
  return `%"${genre.replace(/"/g, "")}"%`;
}
