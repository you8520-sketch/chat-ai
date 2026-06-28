import type { CharacterGenre } from "@/lib/characterGenres";
import { primaryCharacterGenre } from "@/lib/characterGenres";

export type NarrativeStyleMode = "standard" | "possession";

export type NarrativeStyleContext = {
  mode?: NarrativeStyleMode;
  charName?: string;
  genres?: CharacterGenre[];
  /** @deprecated Format rules live in [ADVANCED PROSE & NSFW GUIDELINES] */
  omitFormatRules?: boolean;
};

const GENRE_TONE_HINTS: Partial<Record<CharacterGenre, string>> = {
  "판타지/SF": "판타지·시대 어투 — 과장 없이 닻을 두는 표현",
  "로맨스 판타지": "판타지 로맨스 분위기 — 몰입되되 동화 과장 금지",
  "현대 판타지": "현대·판타지 혼합 — 일상은 담백, 이상은 풍부하게",
  "무협/시대극": "시대 어투 — 과도한 고어체 금지",
  인외: "이세계적 톤 — 감각·설정에 맞게",
  "현대/일상": "현대적 리듬 — 구체적 일상 디테일",
  "학원/스포츠": "현대적 리듬 — 구체적 일상 디테일",
  시뮬레이션: "현대적 리듬 — 구체적 일상 디테일",
  "공포/추리": "짧은 문장·디테일로 공포감",
  로맨스: "근접·반응으로 감정 연속성 유지",
  BL: "근접·반응으로 감정 연속성 유지",
  GL: "근접·반응으로 감정 연속성 유지",
  "코믹/액션": "빠른 비트일 때 경쾌한 리듬 — 정체 구간 금지",
};

function buildCompactGenreHint(genres: CharacterGenre[] | undefined): string | null {
  const primary = primaryCharacterGenre(genres ?? []);
  const hint = GENRE_TONE_HINTS[primary];
  if (!hint) return null;
  return `[genre_tone] ${primary}: ${hint}.`;
}

function buildPossessionHint(): string {
  return `[possession_mode] Co-narrate user persona minimally; do not inflate user dialogue or romance beyond their input.`;
}

/** Compact narrative style layer — genre/possession hints only (prose format in advanced guidelines). */
export function buildNarrativeStyleLayer(ctx: NarrativeStyleContext = {}): string {
  const parts: string[] = [];

  const genre = buildCompactGenreHint(ctx.genres);
  if (genre) parts.push(genre);

  if (ctx.mode === "possession") parts.push(buildPossessionHint());

  return parts.join("\n");
}
