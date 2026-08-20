import { clampHp } from "./stats";
import type { MechanicsResolution } from "./mechanicsTypes";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

function tickNetFor(resolution: MechanicsResolution, participantId: number): number {
  return resolution.ongoingTicks
    .filter((row) => row.participantId === participantId)
    .reduce((sum, row) => sum + (row.hpBefore - row.hpAfter), 0);
}

function restNetFor(resolution: MechanicsResolution, participantId: number): number {
  return (resolution.safeRests ?? [])
    .filter((row) => row.participantId === participantId && row.allowed)
    .reduce((sum, row) => sum + (row.hpAfter - row.hpBefore), 0);
}

function serverRecoveryDirectNet(resolution: MechanicsResolution, participantId: number): number {
  return resolution.actors
    .filter(
      (row) =>
        row.direct &&
        row.direct.owner === "SERVER_RECOVERY" &&
        !row.direct.rejected &&
        row.direct.effect !== "none" &&
        row.direct.targetParticipantId === participantId
    )
    .reduce((sum, row) => sum + ((row.direct?.hpAfter ?? 0) - (row.direct?.hpBefore ?? 0)), 0);
}

function recoveryNetFor(resolution: MechanicsResolution, participantId: number): number {
  return restNetFor(resolution, participantId) + serverRecoveryDirectNet(resolution, participantId);
}

function postMechanicsHp(
  startHp: number,
  maxHp: number,
  resolution: MechanicsResolution,
  participantId: number
): number {
  const tickNet = tickNetFor(resolution, participantId);
  const recoveryNet = recoveryNetFor(resolution, participantId);
  return clampHp(startHp - tickNet + recoveryNet, maxHp);
}

export function hpOwnershipOf(resolution: MechanicsResolution, participantId: number) {
  return (
    resolution.hpOwnership?.[String(participantId)] ?? {
      SERVER_PREACTION: resolution.ongoingTicks.some((row) => row.participantId === participantId),
      SERVER_RECOVERY:
        (resolution.safeRests ?? []).some((row) => row.participantId === participantId && row.allowed) ||
        resolution.actors.some(
          (row) =>
            row.direct?.targetParticipantId === participantId &&
            row.direct.owner === "SERVER_RECOVERY" &&
            row.direct.effect !== "none" &&
            !row.direct.rejected
        ),
      FLASH_REFEREE: resolution.actors.some(
        (row) =>
          row.direct?.targetParticipantId === participantId &&
          row.direct.owner === "FLASH_REFEREE" &&
          row.direct.effect !== "none" &&
          !row.direct.rejected
      ),
      GM_LEGACY: resolution.actors.some(
        (row) => row.participantId === participantId && row.directHpOwner === "GM_LEGACY"
      ),
    }
  );
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
 * Layered HP commit. Fallback string is not a binary "all mechanics / all GM" switch.
 * SERVER_PREACTION / SERVER_RECOVERY always persist. FLASH_REFEREE is authoritative
 * when present. GM_LEGACY only owns unclassified current-action HP.
 */
export function mergeMechanicsOwnedDelta(
  sheets: TrpgSheetSnapshot[],
  gmDelta: TrpgStateDelta,
  resolution: MechanicsResolution | null
): MechanicsMergeResult {
  const complete = resolution?.complete === true;
  const mechanicsConsumed = new Map<string, { participantId: number; item: string }>();
  if (complete && resolution) {
    for (const row of resolution.consumeItems) {
      const item = row.item.trim();
      if (!item) continue;
      mechanicsConsumed.set(`${row.participantId}\u0000${item}`, {
        participantId: row.participantId,
        item,
      });
    }
  }

  const next = sheets.map((sheet) => {
    const copy = { ...sheet, inventory: [...sheet.inventory], conditions: [...sheet.conditions], stats: { ...sheet.stats } };
    if (complete && resolution) {
      copy.hp = resolveParticipantHp({
        startHp: sheet.hp,
        maxHp: copy.maxHp,
        resolution,
        participantId: sheet.participantId,
        gmHp: null,
      });
      for (const row of mechanicsConsumed.values()) {
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
        if (mechanicsConsumed.has(`${patch.participantId}\u0000${t}`)) continue;
        if (t) cur.inventory.push(t);
      }
    }
    if (patch.inventoryRemove) {
      for (const item of patch.inventoryRemove) {
        const t = item.trim();
        if (mechanicsConsumed.has(`${patch.participantId}\u0000${t}`)) continue;
        const idx = cur.inventory.indexOf(t);
        if (idx < 0) {
          invalidInventory = true;
          continue;
        }
        cur.inventory.splice(idx, 1);
      }
    }
    if (patch.hp != null && complete && resolution) {
      const start = sheets.find((row) => row.participantId === cur.participantId)?.hp ?? cur.hp;
      cur.hp = resolveParticipantHp({
        startHp: start,
        maxHp: cur.maxHp,
        resolution,
        participantId: cur.participantId,
        gmHp: patch.hp,
      });
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

export function resolveParticipantHp(opts: {
  startHp: number;
  maxHp: number;
  resolution: MechanicsResolution;
  participantId: number;
  gmHp: number | null;
}): number {
  const ownership = hpOwnershipOf(opts.resolution, opts.participantId);
  const stored = opts.resolution.hpAfter[String(opts.participantId)];
  const postMechanics = postMechanicsHp(
    opts.startHp,
    opts.maxHp,
    opts.resolution,
    opts.participantId
  );

  if (ownership.FLASH_REFEREE && stored != null) {
    return clampHp(stored, opts.maxHp);
  }

  if (opts.gmHp == null) {
    if (ownership.SERVER_RECOVERY || ownership.SERVER_PREACTION) {
      return postMechanics;
    }
    return stored != null && !ownership.GM_LEGACY ? clampHp(stored, opts.maxHp) : clampHp(opts.startHp, opts.maxHp);
  }

  if (ownership.FLASH_REFEREE && stored != null) {
    return clampHp(stored, opts.maxHp);
  }

  if (!ownership.GM_LEGACY) {
    return postMechanics;
  }

  if (ownership.SERVER_RECOVERY) {
    const recoveryNet = recoveryNetFor(opts.resolution, opts.participantId);
    return clampHp(opts.gmHp + recoveryNet, opts.maxHp);
  }

  return fallbackHpAfterTickAndGmHeal(
    opts.startHp,
    opts.maxHp,
    opts.resolution,
    opts.participantId,
    opts.gmHp
  );
}

/**
 * SERVER_PREACTION + SERVER_RECOVERY are the mechanics floor.
 * GM heal above start still survives. Stale start-HP writes cannot erase them.
 */
export function fallbackHpAfterTickAndGmHeal(
  startHp: number,
  maxHp: number,
  resolution: MechanicsResolution,
  participantId: number,
  gmHp: number
): number {
  const tickNet = tickNetFor(resolution, participantId);
  const restNet = restNetFor(resolution, participantId);
  const recoveryNet = restNet + serverRecoveryDirectNet(resolution, participantId);
  const postMechanics = clampHp(startHp - tickNet + recoveryNet, maxHp);
  if (gmHp > startHp) {
    return clampHp(Math.max(postMechanics, gmHp), maxHp);
  }
  if (gmHp === startHp) {
    return postMechanics;
  }
  return clampHp(Math.min(gmHp + recoveryNet, postMechanics), maxHp);
}
