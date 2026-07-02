import type { CharacterGenre } from "@/lib/characterGenres";
import { primaryCharacterGenre } from "@/lib/characterGenres";
import { genreToneHintsForPatch } from "@/lib/registerPatchExperiment";

export type SceneMode = "calm" | "tension" | "combat";

const SCENE_MODE_BY_GENRE: Partial<Record<CharacterGenre, SceneMode>> = {
  "공포/추리": "tension",
  "코믹/액션": "combat",
  "판타지/SF": "calm",
  "로맨스 판타지": "calm",
  "현대 판타지": "calm",
  "무협/시대극": "tension",
  인외: "tension",
  "현대/일상": "calm",
  "학원/스포츠": "calm",
  시뮬레이션: "calm",
  로맨스: "calm",
  BL: "calm",
  GL: "calm",
};

function buildSceneModeHint(genres: CharacterGenre[] | undefined): string | null {
  const primary = primaryCharacterGenre(genres ?? []);
  const mode = SCENE_MODE_BY_GENRE[primary] ?? "calm";
  return `[SCENE MODE] ${primary} → ${mode} (see [GENERATION PROCESS — BEAT FLOW]).`;
}

export type NarrativeStyleMode = "standard" | "possession";

export type NarrativeStyleContext = {
  mode?: NarrativeStyleMode;
  charName?: string;
  genres?: CharacterGenre[];
  /** @deprecated Format rules live in [ADVANCED PROSE & NSFW GUIDELINES] */
  omitFormatRules?: boolean;
};

const GENRE_TONE_HINTS: Partial<Record<CharacterGenre, string>> = {
  "판타지/SF":
    "판타지 세계관 분위기 유지; 대사는 현대 한국 웹소설 존댓말(합니다·입니다·그렇습니다) — 하오·이오·소이다·하였소 금지",
  "로맨스 판타지":
    "판타지 분위기 유지; 감정은 행동·거리로 — 대사 register 현대 존댓말(합니다·입니다)",
  "현대 판타지": "현대+판타지; 대사 register 현대 존댓말(합니다·입니다·그렇습니다)",
  "무협/시대극": "시대·무협 분위기; 대사 하오·이오체 허용 — 캐릭터당 한 register, 턴 안 섞지 마라",
  인외: "세계관 감각 유지; 대사 register 현대 존댓말(합니다·입니다)",
  "현대/일상": "현대적 리듬; 대사 register 현대 존댓말(합니다·입니다·그렇습니다)",
  "학원/스포츠": "현대적 리듬; 대사 register 현대 존댓말(합니다·입니다)",
  시뮬레이션: "현대적 리듬; 대사 register 현대 존댓말(합니다·입니다)",
  "공포/추리": "짧은 문장·구체 디테일 — 대사 register 현대 존댓말; 감정 라벨 대신 감각",
  "코믹/액션": "빠른 비트 — 대사 register 현대 존댓말(합니다·입니다)",
  로맨스: "감정은 행동·거리 — 대사 register 현대 존댓말(합니다·입니다·해요)",
  BL: "감정은 행동·반응 — 대사 register 현대 존댓말",
  GL: "감정은 행동·반응 — 대사 register 현대 존댓말",
  기타: "대사 register 현대 한국 웹소설 존댓말(합니다·입니다)",
};

function buildCompactGenreHint(genres: CharacterGenre[] | undefined): string | null {
  const primary = primaryCharacterGenre(genres ?? []);
  const hints = genreToneHintsForPatch(GENRE_TONE_HINTS);
  const hint = hints[primary];
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

  const sceneMode = buildSceneModeHint(ctx.genres);
  if (sceneMode) parts.push(sceneMode);

  if (ctx.mode === "possession") parts.push(buildPossessionHint());

  return parts.join("\n");
}
