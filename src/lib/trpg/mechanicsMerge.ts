import { clampHp } from "./stats";
import type { MechanicsResolution } from "./mechanicsTypes";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

function tickNetFor(resolution: MechanicsResolution, participantId: number): number {
  return resolution.ongoingTicks
    .filter((row) => row.participantId === participantId)
    .reduce((sum, row) => sum + (row.hpBefore - row.hpAfter), 0);
}

export type MechanicsMergeResult =
  | {
      ok: true;
      next: TrpgSheetSnapshot[];
      AUTHORITATIVE_DAMAGE_NOT_LOST: boolean;
      INVALID_GM_INVENTORY_DELTA: boolean;
    }
  | { ok: false; error: string; detail: string; AUTHORITATIVE_DAMAGE_NOT_LOST: false };

/**
 * Option A: mechanics-owned HP/consume is the authoritative base.
 * GM inventory/location/conditions are applied field-by-field and sanitized.
 * Invalid GM inventory never drops mechanics HP.
 */
export function mergeMechanicsOwnedDelta(
  sheets: TrpgSheetSnapshot[],
  gmDelta: TrpgStateDelta,
  resolution: MechanicsResolution | null
): MechanicsMergeResult {
  const complete = resolution?.complete === true;
  const mechanicsOwnsHp = complete && resolution.fallback === "none";

  const next = sheets.map((sheet) => {
    const copy = { ...sheet, inventory: [...sheet.inventory], conditions: [...sheet.conditions], stats: { ...sheet.stats } };
    if (complete && resolution) {
      if (mechanicsOwnsHp) {
        const hp = resolution.hpAfter[String(sheet.participantId)];
        if (hp != null) copy.hp = clampHp(hp, copy.maxHp);
      } else {
        copy.hp = fallbackHpAfterTickAndGmHeal(sheet.hp, copy.maxHp, resolution, sheet.participantId, sheet.hp);
      }
      for (const row of resolution.consumeItems) {
        if (row.participantId !== sheet.participantId) continue;
        const idx = copy.inventory.indexOf(row.item);
        if (idx >= 0) copy.inventory.splice(idx, 1);
      }
    }
    return copy;
  });

  let invalidInventory = false;
  const byId = new Map(next.map((sheet) => [sheet.participantId, sheet]));
  const seen = new Set<number>();
  for (const patch of gmDelta.players ?? []) {
    if (seen.has(patch.participantId)) continue;
    seen.add(patch.participantId);
    const cur = byId.get(patch.participantId);
    if (!cur) continue;
    if (patch.conditions) cur.conditions = patch.conditions.map((c) => c.trim()).filter(Boolean);
    if (patch.location != null) cur.location = patch.location.trim();
    if (patch.inventoryAdd) {
      for (const item of patch.inventoryAdd) {
        const t = item.trim();
        if (t) cur.inventory.push(t);
      }
    }
    if (patch.inventoryRemove) {
      for (const item of patch.inventoryRemove) {
        const t = item.trim();
        const idx = cur.inventory.indexOf(t);
        if (idx < 0) {
          invalidInventory = true;
          continue;
        }
        cur.inventory.splice(idx, 1);
      }
    }
    if (patch.hp != null && !mechanicsOwnsHp && complete && resolution) {
      cur.hp = fallbackHpAfterTickAndGmHeal(sheets.find((row) => row.participantId === cur.participantId)?.hp ?? cur.hp, cur.maxHp, resolution, cur.participantId, patch.hp);
    } else if (patch.hp != null && !complete) {
      if (Number.isInteger(patch.hp) && patch.hp >= 0 && patch.hp <= cur.maxHp) {
        cur.hp = clampHp(patch.hp, cur.maxHp);
      }
    }
  }

  if (complete) {
    return {
      ok: true,
      next: [...byId.values()],
      AUTHORITATIVE_DAMAGE_NOT_LOST: true,
      INVALID_GM_INVENTORY_DELTA: invalidInventory,
    };
  }

  return {
    ok: true,
    next: [...byId.values()],
    AUTHORITATIVE_DAMAGE_NOT_LOST: false,
    INVALID_GM_INVENTORY_DELTA: invalidInventory,
  };
}

/**
 * Flag-off / Flash-failure: tick is mechanics-owned, GM heal is legacy-owned.
 * Tick cannot be erased. Heal above start HP survives after the tick.
 * start=20 tick=-4 postTick=16 GM=21 → 21.
 */
export function fallbackHpAfterTickAndGmHeal(
  startHp: number,
  maxHp: number,
  resolution: MechanicsResolution,
  participantId: number,
  gmHp: number
): number {
  const tickNet = tickNetFor(resolution, participantId);
  const postTick = clampHp(startHp - tickNet, maxHp);
  if (gmHp > startHp) {
    return clampHp(Math.max(postTick, gmHp), maxHp);
  }
  return clampHp(Math.min(gmHp, postTick), maxHp);
}
