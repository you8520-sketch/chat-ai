import type { OfficialAssetModeration } from "@/lib/officialSupply/types";

export type OfficialModerationVerdict = "missing" | "unavailable" | "rejected" | "adult_flagged" | "clean";

/**
 * Single moderation decision owner for every official asset (representative
 * and RP alike). Independent of `nsfw`: an adult sheet never relaxes it.
 * `adult_flagged` stays approvable — the canonical listing owner routes it to
 * admin review — while a hard reject can never be approved.
 */
export function officialModerationVerdict(moderation: OfficialAssetModeration | null): OfficialModerationVerdict {
  if (!moderation) return "missing";
  switch (moderation.status) {
    case "unavailable":
      return "unavailable";
    case "checked":
      if (moderation.moderationReject) return "rejected";
      return moderation.adultFlagged ? "adult_flagged" : "clean";
    default: {
      const exhaustive: never = moderation;
      throw new Error(`Unknown moderation status ${String(exhaustive)}`);
    }
  }
}

/** Canonical `CharacterAsset` moderation fields for a recorded result. */
export function canonicalAssetModerationFields(
  moderation: OfficialAssetModeration | null
): { adultFlagged?: boolean; moderationReject?: boolean; moderationReason?: string } {
  if (moderation?.status !== "checked") return {};
  return {
    adultFlagged: moderation.adultFlagged,
    ...(moderation.moderationReject
      ? { moderationReject: true, moderationReason: moderation.reason }
      : {}),
  };
}
