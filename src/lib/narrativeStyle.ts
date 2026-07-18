import type { CharacterGenre } from "@/lib/characterGenres";
import { primaryCharacterGenre } from "@/lib/characterGenres";
import { resolveGenreToneHints } from "@/lib/registerPatchExperiment";

export type SceneMode = "calm" | "tension" | "combat";

const SCENE_MODE_BY_GENRE: Partial<Record<CharacterGenre, SceneMode>> = {
  "공포/추리": "tension",
  판타지: "calm",
  SF: "calm",
  "로맨스 판타지": "calm",
  "현대 판타지": "calm",
  무협: "tension",
  동양풍: "tension",
  인외: "tension",
  "현대/일상": "calm",
  학원: "calm",
  스포츠: "calm",
  시뮬레이션: "calm",
  로맨스: "calm",
  BL: "calm",
  GL: "calm",
  HL: "calm",
  센티넬버스: "tension",
  아포칼립스: "tension",
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
  /** @deprecated Format rules live in prose guidelines */
  omitFormatRules?: boolean;
};

function buildCompactGenreHint(genres: CharacterGenre[] | undefined): string | null {
  const primary = primaryCharacterGenre(genres ?? []);
  const hint = resolveGenreToneHints()[primary];
  if (!hint) return null;
  return `[genre_tone] ${primary}: ${hint}.`;
}

/**
 * Compact runtime style — genre_tone + SCENE MODE only.
 * possession_mode merged into LIMITED CO-NARRATION (static dedup).
 */
export function buildNarrativeStyleLayer(ctx: NarrativeStyleContext = {}): string {
  const parts: string[] = [];

  const genre = buildCompactGenreHint(ctx.genres);
  if (genre) parts.push(genre);

  const sceneMode = buildSceneModeHint(ctx.genres);
  if (sceneMode) parts.push(sceneMode);

  if (parts.length === 0) return "";
  return `[RUNTIME STYLE]\n${parts.join("\n")}`;
}
