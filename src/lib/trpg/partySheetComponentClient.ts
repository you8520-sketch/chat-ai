import type { TrpgPublicParticipant } from "./snapshot";

/** participantId → creator sheet compiled source, or null when the character has none. */
export type TrpgPartySheetComponentLoader = (participantId: number) => Promise<string | null>;

/**
 * One request per participant for the page lifetime. A participant's character
 * never changes, so the cache key is the participant; in-flight lookups are shared.
 */
export function createTrpgPartySheetComponentLoader(
  fetchComponent: TrpgPartySheetComponentLoader
): TrpgPartySheetComponentLoader {
  const cache = new Map<number, Promise<string | null>>();
  return (participantId) => {
    const hit = cache.get(participantId);
    if (hit) return hit;
    const pending = fetchComponent(participantId).catch(() => null);
    cache.set(participantId, pending);
    return pending;
  };
}

/** Only AI participants with a canonical character can carry a creator sheet. */
export function trpgPartySheetComponentParticipantId(
  participants: readonly Pick<TrpgPublicParticipant, "id" | "kind" | "characterId">[],
  participantId: number | null
): number | null {
  if (participantId == null) return null;
  const participant = participants.find((row) => row.id === participantId);
  if (!participant || participant.kind !== "ai_character") return null;
  return participant.characterId != null && participant.characterId > 0 ? participant.id : null;
}

export async function fetchTrpgPartySheetComponent(campaignId: number, participantId: number): Promise<string | null> {
  const res = await fetch(
    `/api/trpg/campaigns/${campaignId}/party-sheet?participantId=${encodeURIComponent(String(participantId))}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { component?: { participantId?: unknown; compiled?: unknown } | null } | null;
  const component = json?.component;
  if (!component || component.participantId !== participantId) return null;
  return typeof component.compiled === "string" && component.compiled ? component.compiled : null;
}
