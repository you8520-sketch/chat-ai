import type { TrpgStatDefinition } from "./types";
import { catalogEntry } from "./stats";

export type TrpgResolutionOrderEntry = {
  participantId: number;
  name: string;
  slotIndex: number;
  statKey: "spd" | "dex" | null;
  statLabel: string;
  statValue: number;
};

export function pickInitiativeStat(
  stats: Record<string, number>,
  defs: readonly TrpgStatDefinition[]
): { statKey: "spd" | "dex" | null; statLabel: string; statValue: number } {
  const has = (key: "spd" | "dex") =>
    defs.some((def) => def.key === key) || Object.prototype.hasOwnProperty.call(stats, key);
  if (has("spd")) {
    return { statKey: "spd", statLabel: catalogEntry("spd")?.label ?? "속도", statValue: Number(stats.spd ?? 0) };
  }
  if (has("dex")) {
    return { statKey: "dex", statLabel: catalogEntry("dex")?.label ?? "민첩", statValue: Number(stats.dex ?? 0) };
  }
  return { statKey: null, statLabel: "슬롯", statValue: 0 };
}

export function computeResolutionOrder(
  actors: Array<{
    participantId: number;
    name: string;
    slotIndex: number;
    stats: Record<string, number>;
  }>,
  defs: readonly TrpgStatDefinition[]
): TrpgResolutionOrderEntry[] {
  return actors
    .map((actor) => ({
      participantId: actor.participantId,
      name: actor.name,
      slotIndex: actor.slotIndex,
      ...pickInitiativeStat(actor.stats, defs),
    }))
    .sort((a, b) => {
      if (b.statValue !== a.statValue) return b.statValue - a.statValue;
      return a.slotIndex - b.slotIndex;
    });
}

export function parseResolutionOrder(raw: unknown): TrpgResolutionOrderEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const rows = (raw as { resolutionOrder?: unknown }).resolutionOrder;
  if (!Array.isArray(rows)) return [];
  const out: TrpgResolutionOrderEntry[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const participantId = Number(row.participantId);
    const slotIndex = Number(row.slotIndex);
    if (!Number.isInteger(participantId) || participantId <= 0) continue;
    const statKey = row.statKey === "spd" || row.statKey === "dex" ? row.statKey : null;
    out.push({
      participantId,
      name: String(row.name ?? ""),
      slotIndex: Number.isInteger(slotIndex) ? slotIndex : out.length,
      statKey,
      statLabel: String(row.statLabel ?? (statKey === "spd" ? "속도" : statKey === "dex" ? "민첩" : "슬롯")),
      statValue: Number(row.statValue ?? 0),
    });
  }
  return out;
}

export function sortByResolutionOrder<T extends { participantId: number }>(
  rows: T[],
  order: TrpgResolutionOrderEntry[]
): T[] {
  if (!order?.length) return rows;
  const rank = new Map(order.map((entry, index) => [entry.participantId, index]));
  return [...rows].sort((a, b) => {
    const left = rank.get(a.participantId) ?? Number.MAX_SAFE_INTEGER;
    const right = rank.get(b.participantId) ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

export function formatResolutionOrderBlock(order: TrpgResolutionOrderEntry[]): string {
  if (order.length === 0) return "";
  const lines = order.map((entry, index) => {
    const stat =
      entry.statKey == null ? `슬롯 ${entry.slotIndex}` : `${entry.statLabel} ${entry.statValue}`;
    return `${index + 1}. ${entry.name} — ${stat}`;
  });
  return `[RESOLUTION ORDER]
${lines.join("\n")}
- Resolve conflicting action results in this order.
- Acting first is not an automatic success. Dice results still decide success/failure.
- Later actions may react to earlier resolved results.
- Do not add actions a player did not declare.`;
}
