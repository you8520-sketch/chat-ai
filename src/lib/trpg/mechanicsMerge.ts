import { applyValidatedStateDelta } from "./sheetView";
import { clampHp } from "./stats";
import type { MechanicsResolution } from "./mechanicsTypes";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

function tickNetFor(resolution: MechanicsResolution, participantId: number): number {
  return resolution.ongoingTicks
    .filter((row) => row.participantId === participantId)
    .reduce((sum, row) => sum + (row.hpBefore - row.hpAfter), 0);
}

/** GM delta keeps inventory/location/quests. Mechanics owns HP and consumeItem. */
export function mergeMechanicsOwnedDelta(
  sheets: TrpgSheetSnapshot[],
  gmDelta: TrpgStateDelta,
  resolution: MechanicsResolution | null
): { ok: true; next: TrpgSheetSnapshot[] } | { ok: false; error: string; detail: string } {
  const complete = resolution?.complete === true;
  const mechanicsOwnsHp = complete && resolution.fallback === "none";
  const stripped: TrpgStateDelta = {
    ...gmDelta,
    players: gmDelta.players.map((player) => {
      const consume = resolution?.consumeItems
        .filter((row) => row.participantId === player.participantId)
        .map((row) => row.item);
      return {
        ...player,
        hp: mechanicsOwnsHp ? undefined : player.hp,
        inventoryRemove: (player.inventoryRemove ?? []).filter((item) => !consume?.includes(item)),
      };
    }),
  };
  const applied = applyValidatedStateDelta(sheets, stripped);
  if (!applied.ok) return { ok: false, error: applied.error, detail: applied.detail };
  if (!complete || !resolution) return applied;
  const next = applied.next.map((sheet) => {
    const start = sheets.find((row) => row.participantId === sheet.participantId);
    const copy = { ...sheet, inventory: [...sheet.inventory] };
    if (mechanicsOwnsHp) {
      const hp = resolution.hpAfter[String(sheet.participantId)];
      if (hp != null) copy.hp = clampHp(hp, copy.maxHp);
    } else {
      const ceiling = clampHp((start?.hp ?? sheet.hp) - tickNetFor(resolution, sheet.participantId), copy.maxHp);
      copy.hp = Math.min(copy.hp, ceiling);
    }
    for (const row of resolution.consumeItems) {
      if (row.participantId !== sheet.participantId) continue;
      const idx = copy.inventory.indexOf(row.item);
      if (idx >= 0) copy.inventory.splice(idx, 1);
    }
    return copy;
  });
  return { ok: true, next };
}
