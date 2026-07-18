export const CHARACTER_GENRES = [
  "로맨스",
  "로맨스 판타지",
  "현대 판타지",
  "시뮬레이션",
  "현대/일상",
  "학원",
  "스포츠",
  "판타지",
  "SF",
  "무협",
  "동양풍",
  "공포/추리",
  "아포칼립스",
  "BL",
  "GL",
  "HL",
  "인외",
  "센티넬버스",
  "기타",
] as const;

export type CharacterGenre = (typeof CHARACTER_GENRES)[number];

const GENRE_SET = new Set<string>(CHARACTER_GENRES);

/** 과거 복합 장르 → 신규 장르 (편집·저장 시 정규화) */
const LEGACY_GENRE_EXPAND: Record<string, CharacterGenre[]> = {
  "판타지/SF": ["판타지", "SF"],
  "학원/스포츠": ["학원", "스포츠"],
  "무협/시대극": ["무협"],
};

/**
 * 목록·검색 필터 시 레거시 DB 값도 함께 매칭.
 * (예: 판타지 선택 → 구 `판타지/SF` 캐릭터 포함)
 */
const GENRE_FILTER_ALIASES: Partial<Record<CharacterGenre, string[]>> = {
  판타지: ["판타지", "판타지/SF"],
  SF: ["SF", "판타지/SF"],
  학원: ["학원", "학원/스포츠"],
  스포츠: ["스포츠", "학원/스포츠"],
  무협: ["무협", "무협/시대극"],
};

export function isCharacterGenre(value: string): value is CharacterGenre {
  return GENRE_SET.has(value);
}

function expandLegacyGenreToken(raw: string): CharacterGenre[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (isCharacterGenre(trimmed)) return [trimmed];
  return LEGACY_GENRE_EXPAND[trimmed] ?? [];
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
    for (const expanded of expandLegacyGenreToken(g)) {
      if (seen.has(expanded)) continue;
      seen.add(expanded);
      out.push(expanded);
    }
  }
  // 목록 순서 유지
  return CHARACTER_GENRES.filter((g) => seen.has(g));
}

export function primaryCharacterGenre(genres: CharacterGenre[]): CharacterGenre {
  return genres[0] ?? "기타";
}

export function toggleCharacterGenre(current: CharacterGenre[], genre: CharacterGenre): CharacterGenre[] {
  if (current.includes(genre)) return current.filter((g) => g !== genre);
  return [...current, genre];
}

/** DB genres JSON 컬럼 + legacy genre 컬럼 필터용 LIKE 패턴 */
export function genreJsonLikePattern(genre: string): string {
  return `%"${genre.replace(/"/g, "")}"%`;
}

/** 필터용 별칭 포함 장르 토큰 (현재 선택 + 레거시) */
export function genreFilterTokens(genre: CharacterGenre): string[] {
  return GENRE_FILTER_ALIASES[genre] ?? [genre];
}

/**
 * `(genre=? OR genres LIKE ? OR …)` + params
 * 여러 별칭을 OR로 묶음.
 */
export function genreFilterSql(genre: CharacterGenre): { sql: string; params: string[] } {
  const tokens = genreFilterTokens(genre);
  const parts: string[] = [];
  const params: string[] = [];
  for (const token of tokens) {
    parts.push("(genre = ? OR genres LIKE ?)");
    params.push(token, genreJsonLikePattern(token));
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}
