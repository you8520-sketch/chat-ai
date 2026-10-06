import type { OfficialAssetPlan, OfficialAssetSlotPlan } from "@/lib/officialSupply/types";

/**
 * Canonical public CharacterAsset[] order: representative first, then the
 * remaining assetPlan slots in plan order. Same owner as `buildStagingAssets`.
 */
export function officialStagedAssetOrder(plan: OfficialAssetPlan): OfficialAssetSlotPlan[] {
  return [...plan.slots].sort(
    (a, b) => Number(b.kind === "representative") - Number(a.kind === "representative")
  );
}

export type OfficialPublicSlotMap =
  | { ok: true; indexes: Map<string, number> }
  | { ok: false; reason: string };

/**
 * Maps draft slotKey → characters.assets index using assetPlan order plus
 * exact active `result_url` equality. No tag/filename guessing.
 */
export function mapOfficialPublicAssetSlots(input: {
  plan: OfficialAssetPlan;
  publicAssets: ReadonlyArray<{ url?: unknown }>;
  activeUrlBySlot: ReadonlyMap<string, string>;
}): OfficialPublicSlotMap {
  const ordered = officialStagedAssetOrder(input.plan);
  if (ordered.length === 0) {
    return { ok: false, reason: "asset plan has no slots" };
  }
  if (input.publicAssets.length !== ordered.length) {
    return {
      ok: false,
      reason: `public assets length ${input.publicAssets.length} != plan order ${ordered.length}`,
    };
  }
  const indexes = new Map<string, number>();
  const seenUrls = new Set<string>();
  for (const [index, slot] of ordered.entries()) {
    const activeUrl = input.activeUrlBySlot.get(slot.slotKey)?.trim() ?? "";
    const publicUrl = typeof input.publicAssets[index]?.url === "string" ? input.publicAssets[index].url.trim() : "";
    if (!activeUrl) {
      return { ok: false, reason: `${slot.slotKey} has no active result_url` };
    }
    if (!publicUrl) {
      return { ok: false, reason: `public assets[${index}] has no url for ${slot.slotKey}` };
    }
    if (publicUrl !== activeUrl) {
      return {
        ok: false,
        reason: `${slot.slotKey} public url does not match active result_url`,
      };
    }
    if (seenUrls.has(publicUrl)) {
      return { ok: false, reason: `duplicate public url at ${slot.slotKey}` };
    }
    seenUrls.add(publicUrl);
    indexes.set(slot.slotKey, index);
  }
  return { ok: true, indexes };
}
