import type { TrpgStatDefinition } from "./types";

export const DEFAULT_TRPG_STAT_DEFS: TrpgStatDefinition[] = [
  { key: "str", label: "힘", description: "근접·완력", min: 1, max: 10 },
  { key: "dex", label: "민첩", description: "은신·선공·회피", min: 1, max: 10 },
  { key: "int", label: "지능", description: "조사·지식", min: 1, max: 10 },
  { key: "wis", label: "지혜", description: "통찰·의지", min: 1, max: 10 },
  { key: "cha", label: "매력", description: "설득·위압", min: 1, max: 10 },
  { key: "con", label: "체력", description: "지구력·HP", min: 1, max: 10 },
];

export const DEFAULT_TRPG_POINT_POOL = 30;

export type StatAllocationError =
  | "missing_stat"
  | "unknown_stat"
  | "out_of_range"
  | "over_pool";

export function validateStatAllocation(
  defs: TrpgStatDefinition[],
  values: Record<string, number>,
  pool: number = DEFAULT_TRPG_POINT_POOL
): { ok: true; total: number } | { ok: false; error: StatAllocationError; detail: string } {
  let total = 0;
  for (const def of defs) {
    const raw = values[def.key];
    if (raw == null || !Number.isInteger(raw)) {
      return { ok: false, error: "missing_stat", detail: def.key };
    }
    if (raw < def.min || raw > def.max) {
      return { ok: false, error: "out_of_range", detail: def.key };
    }
    total += raw;
  }
  for (const key of Object.keys(values)) {
    if (!defs.some((d) => d.key === key)) {
      return { ok: false, error: "unknown_stat", detail: key };
    }
  }
  if (total > pool) {
    return { ok: false, error: "over_pool", detail: String(total) };
  }
  return { ok: true, total };
}

export function deriveMaxHp(con: number): number {
  const n = Number.isFinite(con) ? con : 1;
  return Math.max(1, n * 5);
}

export function statModifier(value: number): number {
  return Math.floor((value - 5) / 2);
}

export function clampHp(hp: number, maxHp: number): number {
  const max = Math.max(1, maxHp);
  if (!Number.isFinite(hp)) return 0;
  return Math.min(max, Math.max(0, Math.floor(hp)));
}
