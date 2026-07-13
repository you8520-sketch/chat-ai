import type Database from "better-sqlite3";
import type { CharacterRow } from "@/components/CharacterCard";
import { getCreatorTierInfo } from "@/lib/creatorPoints";
import type { CreatorTierLevel } from "@/lib/creatorShared";


export function decorateCharactersWithCreatorTiers<T extends CharacterRow>(
  db: Database.Database,
  characters: T[]
): T[] {
  const tierByCreator = new Map<number, CreatorTierLevel>();

  return characters.map((character) => {
    const creatorId = Number(character.creator_id ?? 0);
    if (!Number.isFinite(creatorId) || creatorId <= 0 || character.official === 1) {
      return character;
    }

    let tier = tierByCreator.get(creatorId);
    if (!tier) {
      tier = getCreatorTierInfo(creatorId).tierLevel;
      tierByCreator.set(creatorId, tier);
    }

    return { ...character, creator_tier_level: tier };
  });
}
