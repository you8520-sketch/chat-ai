/**
 * Home selector / feature presentation.
 *
 * `characters.hue` is not the accent engine: the create form stores 260 and
 * listable rows outside hand-seeded fixtures collapse to that default.
 * This palette is a home-only, id-stable wash. It is not a badge color,
 * not a new column, and not an image sample.
 */

import { getCharacterRepresentativeImageUrl } from "@/lib/characterAssets";
import { characterCardHref } from "@/lib/chatLinks";

export const HOME_STAGE_CANDIDATE_LIMIT = 5;

export type HomeStageAccent = {
  id: string;
  wash: string;
  ink: string;
};

export const HOME_STAGE_PALETTE = [
  { id: "sand", wash: "#e7c7a1", ink: "#2a1c10" },
  { id: "sea", wash: "#7fcec4", ink: "#06211e" },
  { id: "wine", wash: "#e7a0b0", ink: "#3a121c" },
  { id: "gold", wash: "#e3c56a", ink: "#2a2108" },
  { id: "iris", wash: "#b7c4f5", ink: "#161a33" },
  { id: "moss", wash: "#b7d39a", ink: "#17240f" },
] as const satisfies readonly HomeStageAccent[];

export type HomeStageSource = {
  id: number;
  name: string;
  tagline: string;
  genre: string;
  nsfw: number;
  official: number;
  emoji: string;
  creator_name: string;
  creator_id?: number | null;
  content_kind?: string;
  images?: string;
  assets?: string;
};

export type HomeStageCharacter = {
  id: number;
  name: string;
  tagline: string;
  genre: string;
  creatorName: string;
  creatorHref: string | null;
  href: string;
  imageUrl: string | null;
  emoji: string;
  official: boolean;
  simulation: boolean;
  indexLabel: string;
  totalLabel: string;
  accent: HomeStageAccent;
};

export function homePresentationAccent(id: number): HomeStageAccent {
  const raw = Number(id);
  const safe = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  const index = Math.abs(safe) % HOME_STAGE_PALETTE.length;
  return HOME_STAGE_PALETTE[index] ?? HOME_STAGE_PALETTE[0];
}

function padIndex(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Stage candidates are a prefix of an already filtered home list.
 * Adult-hidden rows are dropped so their artwork cannot reach the stage.
 */
export function toHomeStageCharacters(
  rows: readonly HomeStageSource[],
  opts: { blurNsfw: boolean; loggedIn: boolean },
  limit = HOME_STAGE_CANDIDATE_LIMIT,
): HomeStageCharacter[] {
  const capped = rows
    .filter((row) => !(row.nsfw === 1 && opts.blurNsfw))
    .slice(0, limit);
  const totalLabel = padIndex(capped.length);

  return capped.map((row, index) => {
    const creatorId = row.creator_id != null ? Number(row.creator_id) : 0;
    return {
      id: row.id,
      name: row.name,
      tagline: row.tagline?.trim() ?? "",
      genre: row.genre?.trim() ?? "",
      creatorName: row.creator_name?.trim() ?? "",
      creatorHref: creatorId > 0 ? `/creator/${creatorId}` : null,
      href: characterCardHref({
        characterId: row.id,
        nsfw: row.nsfw === 1,
        blurNsfw: opts.blurNsfw,
        loggedIn: opts.loggedIn,
      }),
      imageUrl: getCharacterRepresentativeImageUrl(row.assets, row.images),
      emoji: row.emoji?.trim() || "·",
      official: row.official === 1,
      simulation: row.content_kind === "simulation",
      indexLabel: padIndex(index + 1),
      totalLabel,
      accent: homePresentationAccent(row.id),
    };
  });
}
