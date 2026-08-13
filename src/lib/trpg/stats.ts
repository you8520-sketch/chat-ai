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

const STAT_HINTS: Record<string, string[]> = {
  str: ["힘", "검", "전사", "기사", "무사", "격투", "완력", "근육", "도끼", "창", "무력", "용병"],
  dex: ["민첩", "도적", "암살", "궁", "닌자", "은신", "도둑", "날렵", "암기", "도주"],
  int: ["지능", "마법", "학자", "천재", "연구", "마법사", "지식", "책", "연금"],
  wis: ["지혜", "사제", "신관", "승려", "통찰", "점술", "성직", "기도", "감지"],
  cha: ["매력", "유혹", "아이돌", "공주", "왕자", "화술", "카리스마", "연예", "가수", "배우"],
  con: ["체력", "탱커", "맷집", "거인", "지구력", "수호", "방패", "튼튼"],
};

/**
 * Starting spread for an AI character bot. Host must still confirm/edit.
 * Keyword hints from name/description tilt the 30-point pool; no match → even 5s.
 */
export function suggestBotStats(personaText: string, pool = DEFAULT_TRPG_POINT_POOL): Record<string, number> {
  const text = personaText.toLowerCase();
  const keys = DEFAULT_TRPG_STAT_DEFS.map((d) => d.key);
  const scores: Record<string, number> = {};
  for (const key of keys) {
    scores[key] = (STAT_HINTS[key] ?? []).reduce((n, hint) => n + (text.includes(hint) ? 1 : 0), 0);
  }
  const values: Record<string, number> = {};
  for (const def of DEFAULT_TRPG_STAT_DEFS) values[def.key] = def.min;
  let remaining = pool - DEFAULT_TRPG_STAT_DEFS.reduce((s, d) => s + d.min, 0);
  const ranked = [...keys].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b));
  const hasHint = ranked.some((k) => (scores[k] ?? 0) > 0);
  if (!hasHint) {
    return { str: 5, dex: 5, int: 5, wis: 5, cha: 5, con: 5 };
  }
  while (remaining > 0) {
    let progressed = false;
    for (const key of ranked) {
      const def = DEFAULT_TRPG_STAT_DEFS.find((d) => d.key === key);
      if (!def || values[key]! >= def.max || remaining <= 0) continue;
      const boost = Math.max(1, scores[key] ?? 0);
      const add = Math.min(boost, def.max - values[key]!, remaining);
      values[key]! += add;
      remaining -= add;
      progressed = true;
      if (remaining <= 0) break;
    }
    if (!progressed) break;
  }
  return values;
}
