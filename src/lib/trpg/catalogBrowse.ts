import { CHARACTER_GENRES, type CharacterGenre } from "@/lib/characterGenres";

export type TrpgCatalogPick =
  | { kind: "world"; id: number }
  | { kind: "scenario"; id: number };

export function hueFromId(id: number): number {
  return (Math.abs(id) * 47) % 360;
}

export function catalogItemMatches(opts: {
  title: string;
  summary: string;
  creatorName?: string;
  genres: readonly string[];
  query: string;
  genre: CharacterGenre | null;
}): boolean {
  if (opts.genre && !opts.genres.includes(opts.genre)) return false;
  const q = opts.query.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${opts.title} ${opts.summary} ${opts.creatorName ?? ""} ${opts.genres.join(" ")}`.toLowerCase();
  return haystack.includes(q);
}

export function genresInCatalog(items: Array<{ genres: readonly string[] }>): CharacterGenre[] {
  const seen = new Set(items.flatMap((item) => item.genres));
  return CHARACTER_GENRES.filter((genre) => seen.has(genre));
}
