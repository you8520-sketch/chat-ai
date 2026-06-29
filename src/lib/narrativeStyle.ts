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
  "판타지/SF": "판타지 세계관의 분위기를 유지하되 번역투·고풍체를 과장하지 마라",
  "로맨스 판타지":
    "판타지 분위기는 유지하고, 감정은 설명하지 말고 행동·시선·거리감·호흡으로 표현한다",
  "현대 판타지": "현대와 판타지 분위기를 구분하되, 감정은 행동·감각으로",
  "무협/시대극": "시대·무협 분위기를 유지하되 고어체·번역투 과장 금지",
  인외: "이 세계관의 감각·설정에 맞게, 감정은 행동·반응으로",
  "현대/일상": "현대적 리듬 — 구체적 일상 디테일·미세 행동으로",
  "학원/스포츠": "현대적 리듬 — 구체적 일상 디테일·미세 행동으로",
  시뮬레이션: "현대적 리듬 — 구체적 일상 디테일·미세 행동으로",
  "공포/추리": "짧은 문장·구체 디테일로 공포·긴장 — 감정 라벨 대신 감각",
  로맨스: "감정은 설명하지 말고 행동·시선·거리감·호흡으로 표현한다",
  BL: "감정은 설명하지 말고 행동·시선·거리감·호흡으로 표현한다",
  GL: "감정은 설명하지 말고 행동·시선·거리감·호흡으로 표현한다",
  "코믹/액션": "빠른 비트일 때 경쾌한 리듬 — 정체 구간·감정 설명 금지",
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
