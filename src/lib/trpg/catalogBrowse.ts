import { CHARACTER_GENRES, type CharacterGenre } from "@/lib/characterGenres";
import type { TrpgCatalog, TrpgCatalogWorld } from "./catalog";
import type { TrpgScenarioTemplate } from "./scenarioTypes";

export type TrpgCatalogPick =
  | { kind: "world"; id: number }
  | { kind: "scenario"; id: number };

export function catalogWorldById(catalog: TrpgCatalog, id: number): TrpgCatalogWorld | null {
  return catalog.myWorlds.find((w) => w.id === id) ?? catalog.publicWorlds.find((w) => w.id === id) ?? null;
}

export function catalogScenarioById(
  catalog: TrpgCatalog,
  id: number
): { scenario: TrpgScenarioTemplate; viewerIsCreator: boolean } | null {
  const mine = catalog.myScenarios.find((s) => s.id === id);
  if (mine) return { scenario: mine, viewerIsCreator: true };
  const pub = catalog.publicScenarios.find((s) => s.id === id);
  if (pub) return { scenario: pub, viewerIsCreator: false };
  return null;
}

/** GM-only notes never leave the creator's catalog payload, and the UI must not render them for anyone else. */
export function visibleScenarioSecret(secretContent: string, viewerIsCreator: boolean): string {
  if (!viewerIsCreator) return "";
  return secretContent.trim();
}

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

export type TrpgCatalogNewItem =
  | { kind: "world"; id: number; updatedAt: string }
  | { kind: "scenario"; id: number; updatedAt: string };

/** Public worlds and scenarios mixed by recency for the TRPG “신작” row. */
export function catalogNewReleases(
  catalog: Pick<TrpgCatalog, "publicWorlds" | "publicScenarios">,
  limit = 16
): TrpgCatalogNewItem[] {
  const items: TrpgCatalogNewItem[] = [
    ...catalog.publicWorlds.map((world) => ({
      kind: "world" as const,
      id: world.id,
      updatedAt: world.updatedAt,
    })),
    ...catalog.publicScenarios.map((scenario) => ({
      kind: "scenario" as const,
      id: scenario.id,
      updatedAt: scenario.updatedAt,
    })),
  ];
  items.sort((a, b) => {
    const byDate = b.updatedAt.localeCompare(a.updatedAt);
    if (byDate !== 0) return byDate;
    if (a.kind !== b.kind) return a.kind === "world" ? -1 : 1;
    return b.id - a.id;
  });
  return items.slice(0, limit);
}
