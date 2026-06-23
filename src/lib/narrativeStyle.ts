import type { CharacterGenre } from "@/lib/characterGenres";
import { primaryCharacterGenre } from "@/lib/characterGenres";
import {
  NARRATIVE_STYLE_CORE,
  UNIFIED_WEBNOVEL_STYLE_BLOCK,
} from "@/lib/writingStylePreset";

export type NarrativeStyleMode = "standard" | "possession";

export type NarrativeStyleContext = {
  mode?: NarrativeStyleMode;
  charName?: string;
  genres?: CharacterGenre[];
  /** Skip KOREAN_WEBNOVEL_STYLE when injected elsewhere (e.g. OpenRouter prose bundle). */
  omitFormatRules?: boolean;
};

const GENRE_TONE_HINTS: Partial<Record<CharacterGenre, string>> = {
  "판타지/SF": "fantasy/historical register — grounded, period-appropriate",
  "로맨스 판타지": "fantasy-romance atmosphere — immersive but not fairytale excess",
  "현대 판타지": "modern-fantasy blend — grounded when mundane, rich when strange",
  "무협/시대극": "period diction — grounded, not archaic overload",
  인외: "otherworldly tone — sensory and distinct, lore-grounded",
  "현대/일상": "contemporary rhythm — concrete daily detail",
  "학원/스포츠": "contemporary rhythm — concrete daily detail",
  시뮬레이션: "contemporary rhythm — concrete daily detail",
  "공포/추리": "tighter sentences, dread through detail",
  로맨스: "emotional continuity through proximity and reaction",
  BL: "emotional continuity through proximity and reaction",
  GL: "emotional continuity through proximity and reaction",
  "코믹/액션": "snappy rhythm when the beat is fast — forward flow over stalled beats",
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

/** Compact narrative style layer — contextual hints only when format lives elsewhere. */
export function buildNarrativeStyleLayer(ctx: NarrativeStyleContext = {}): string {
  const parts: string[] = [NARRATIVE_STYLE_CORE];
  if (!ctx.omitFormatRules) {
    parts.push(UNIFIED_WEBNOVEL_STYLE_BLOCK);
  }

  const genre = buildCompactGenreHint(ctx.genres);
  if (genre) parts.push(genre);

  if (ctx.mode === "possession") parts.push(buildPossessionHint());

  return parts.join("\n");
}
