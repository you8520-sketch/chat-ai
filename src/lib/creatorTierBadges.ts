import type Database from "better-sqlite3";
import type { CharacterRow } from "@/components/CharacterCard";
import { getCreatorTierInfo } from "@/lib/creatorPoints";
import { isCreatorMonetizationEligible } from "@/lib/creatorMonetization";
import { isSiteManagedUser } from "@/lib/siteManagedAccounts";
import type { CreatorTierLevel } from "@/lib/creatorShared";


export function decorateCharactersWithCreatorTiers<T extends CharacterRow>(
  db: Database.Database,
  characters: T[]
): T[] {
  const tierByCreator = new Map<number, CreatorTierLevel | null>();
  const siteManagedByCreator = new Map<number, boolean>();

  return characters.map((character) => {
    const creatorId = Number(character.creator_id ?? 0);
    if (!Number.isFinite(creatorId) || creatorId <= 0) {
      return character;
    }

    if (!siteManagedByCreator.has(creatorId)) {
      siteManagedByCreator.set(creatorId, isSiteManagedUser(creatorId));
    }
    const siteManaged = siteManagedByCreator.get(creatorId) === true;
    if (siteManaged) {
      return {
        ...character,
        creator_tier_level: null,
        creator_site_managed: true,
      };
    }

    // Official characters skip personal tier medals (product "공식" badge covers them).
    if (character.official === 1) {
      return { ...character, creator_site_managed: false };
    }

    if (!isCreatorMonetizationEligible(creatorId)) {
      return { ...character, creator_tier_level: null, creator_site_managed: false };
    }

    if (!tierByCreator.has(creatorId)) {
      const info = getCreatorTierInfo(creatorId);
      // CP 적립률이 있는 등급만 배지 표시 (캐릭터 2개 미만 = 0%)
      tierByCreator.set(creatorId, info.rewardRate > 0 ? info.tierLevel : null);
    }

    return {
      ...character,
      creator_tier_level: tierByCreator.get(creatorId) ?? null,
      creator_site_managed: false,
    };
  });
}
