import type { CharacterGenre } from "@/lib/characterGenres";
import { primaryCharacterGenre } from "@/lib/characterGenres";
import { resolveGenreToneHints } from "@/lib/registerPatchExperiment";

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

function buildCompactGenreHint(genres: CharacterGenre[] | undefined): string | null {
  const primary = primaryCharacterGenre(genres ?? []);
  const hint = resolveGenreToneHints()[primary];
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
