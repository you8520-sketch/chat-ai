import type { TrpgStatDefinition } from "./types";

export type TrpgStatCatalogEntry = TrpgStatDefinition & {
  hints: string[];
  hpSource?: boolean;
};

/**
 * Shared pool of common TRPG abilities (D&D 6 + CoC/WoD/SW-style extras).
 * Scenario authors pick a subset for the PC sheet. World-only campaigns use the default 6.
 * Max 30.
 */
export const TRPG_STAT_CATALOG: TrpgStatCatalogEntry[] = [
  { key: "str", label: "힘", description: "근접·완력·파괴", min: 1, max: 10, hints: ["힘", "검", "전사", "기사", "무사", "격투", "완력", "근육", "도끼", "창", "무력", "용병", "때리", "부수"] },
  { key: "dex", label: "민첩", description: "은신·선공·잔기술", min: 1, max: 10, hints: ["민첩", "도적", "암살", "궁", "닌자", "은신", "도둑", "날렵", "암기", "도주", "숨"] },
  { key: "con", label: "체력", description: "지구력·HP", min: 1, max: 10, hpSource: true, hints: ["체력", "탱커", "맷집", "거인", "지구력", "수호", "방패", "튼튼", "버티"] },
  { key: "int", label: "지능", description: "조사·지식·추론", min: 1, max: 10, hints: ["지능", "마법", "학자", "천재", "연구", "마법사", "지식", "책", "연금", "분석"] },
  { key: "wis", label: "지혜", description: "통찰·감지·판단", min: 1, max: 10, hints: ["지혜", "사제", "신관", "승려", "통찰", "점술", "성직", "기도", "감지"] },
  { key: "cha", label: "매력", description: "설득·사교·위압", min: 1, max: 10, hints: ["매력", "유혹", "아이돌", "공주", "왕자", "화술", "카리스마", "연예", "가수", "배우", "설득"] },
  { key: "per", label: "지각", description: "관찰·눈치·단서", min: 1, max: 10, hints: ["지각", "관찰", "눈치", "단서", "살펴", "주시", "찾아"] },
  { key: "wil", label: "의지", description: "정신력·공포 저항", min: 1, max: 10, hints: ["의지", "정신력", "공포", "광기", "버티", "굴복", "저항"] },
  { key: "lck", label: "운", description: "우연·기적·요행", min: 1, max: 10, hints: ["운", "행운", "우연", "도박", "요행", "뽑기"] },
  { key: "mag", label: "마력", description: "주문·초능력", min: 1, max: 10, hints: ["마력", "주문", "마법", "주술", "염력", "화염", "빙결", "번개", "소환"] },
  { key: "fth", label: "신앙", description: "기적·신성·축복", min: 1, max: 10, hints: ["신앙", "신성", "기적", "축복", "신", "기도", "성수"] },
  { key: "tec", label: "기술", description: "제작·장치·손재주", min: 1, max: 10, hints: ["기술", "제작", "장치", "기계", "수리", "도구", "자물쇠", "해킹"] },
  { key: "app", label: "외모", description: "첫인상·미모", min: 1, max: 10, hints: ["외모", "미모", "첫인상", "예쁘", "잘생", "미인"] },
  { key: "edu", label: "학식", description: "교육·전공 지식", min: 1, max: 10, hints: ["학식", "교육", "전공", "역사", "문헌", "학위", "공부"] },
  { key: "siz", label: "체격", description: "크기·무게·위압감", min: 1, max: 10, hpSource: true, hints: ["체격", "거구", "덩치", "몸집", "거인", "무게"] },
  { key: "ins", label: "직감", description: "감·재치·번뜩임", min: 1, max: 10, hints: ["직감", "감", "재치", "번뜩", "육감", "예감"] },
  { key: "spd", label: "속도", description: "이동·선제·추격", min: 1, max: 10, hints: ["속도", "달리", "추격", "선제", "빠르", "질주", "도망"] },
  { key: "res", label: "저항", description: "독·저주·상태이상", min: 1, max: 10, hints: ["저항", "독", "저주", "면역", "해독", "상태이상"] },
  { key: "com", label: "침착", description: "냉정·패닉 억제", min: 1, max: 10, hints: ["침착", "냉정", "패닉", "진정", "평정", "동요"] },
  { key: "pre", label: "존재감", description: "위압·좌중 장악", min: 1, max: 10, hints: ["존재감", "위압", "기세", "카리스마", "장악", "압도"] },
  { key: "san", label: "이성", description: "광기·이성 붕괴", min: 1, max: 10, hints: ["이성", "광기", "정신붕괴", "환각", "미침", "제정신"] },
  { key: "hon", label: "명예", description: "체면·의리·맹세", min: 1, max: 10, hints: ["명예", "체면", "의리", "맹세", "자존", "체통"] },
  { key: "emp", label: "공감", description: "감정·유대·위로", min: 1, max: 10, hints: ["공감", "유대", "위로", "감정", "이해", "다독"] },
  { key: "foc", label: "집중", description: "조준·유지·몰입", min: 1, max: 10, hints: ["집중", "조준", "몰입", "유지", "한눈"] },
  { key: "surv", label: "생존", description: "야생·야영·추적", min: 1, max: 10, hints: ["생존", "야생", "야영", "추적", "사냥", "숲"] },
  { key: "inf", label: "인맥", description: "연줄·뒷거래", min: 1, max: 10, hints: ["인맥", "연줄", "뒷거래", "정계", "조직"] },
  { key: "occ", label: "오컬트", description: "금서·이능 지식", min: 1, max: 10, hints: ["오컬트", "금서", "이능", "주술서", "비의", "금기"] },
  { key: "acc", label: "명중", description: "원거리·조준 명중", min: 1, max: 10, hints: ["명중", "사격", "활", "총", "조준", "원거리"] },
  { key: "grd", label: "가드", description: "막기·받아치기", min: 1, max: 10, hints: ["가드", "막기", "받아치", "방어기", "패링"] },
  { key: "rec", label: "회복", description: "치료·피로 회복", min: 1, max: 10, hints: ["회복", "치료", "치유", "피로", "응급"] },
];

export const DEFAULT_TRPG_STAT_KEYS = ["str", "dex", "int", "wis", "cha", "con"] as const;

function toDef(entry: TrpgStatCatalogEntry): TrpgStatDefinition {
  return {
    key: entry.key,
    label: entry.label,
    description: entry.description,
    min: entry.min,
    max: entry.max,
  };
}

export function catalogEntry(key: string): TrpgStatCatalogEntry | undefined {
  return TRPG_STAT_CATALOG.find((row) => row.key === key);
}

export function defsFromKeys(keys: readonly string[]): TrpgStatDefinition[] {
  const wanted = new Set(keys);
  return TRPG_STAT_CATALOG.filter((row) => wanted.has(row.key)).map(toDef);
}

export const DEFAULT_TRPG_STAT_DEFS: TrpgStatDefinition[] = defsFromKeys(DEFAULT_TRPG_STAT_KEYS);

export function pointPoolFor(defs: readonly TrpgStatDefinition[]): number {
  return Math.max(defs.length, 1) * 5;
}

export const DEFAULT_TRPG_POINT_POOL = pointPoolFor(DEFAULT_TRPG_STAT_DEFS);

export function parseStatKeys(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_TRPG_STAT_KEYS];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const item of raw) {
    const key = String(item ?? "").trim();
    if (!key || seen.has(key) || !catalogEntry(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= TRPG_STAT_CATALOG.length) break;
  }
  return keys.length > 0 ? defsFromKeys(keys).map((d) => d.key) : [...DEFAULT_TRPG_STAT_KEYS];
}

export type StatAllocationError =
  | "missing_stat"
  | "unknown_stat"
  | "out_of_range"
  | "over_pool";

export function validateStatAllocation(
  defs: TrpgStatDefinition[],
  values: Record<string, number>,
  pool: number = pointPoolFor(defs)
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

export function evenStats(
  defs: readonly TrpgStatDefinition[] = DEFAULT_TRPG_STAT_DEFS,
  pool = pointPoolFor(defs)
): Record<string, number> {
  const values: Record<string, number> = {};
  if (defs.length === 0) return values;
  for (const def of defs) values[def.key] = def.min;
  let remaining = Math.max(0, pool - defs.reduce((sum, def) => sum + def.min, 0));
  let guard = 0;
  while (remaining > 0 && guard < defs.length * 20) {
    const def = defs[guard % defs.length]!;
    if (values[def.key]! < def.max) {
      values[def.key]! += 1;
      remaining -= 1;
    }
    guard += 1;
  }
  return values;
}

export function deriveMaxHp(con: number): number {
  const n = Number.isFinite(con) ? con : 1;
  return Math.max(1, n * 5);
}

export function deriveMaxHpFromValues(stats: Record<string, number>): number {
  const raw = stats.con ?? stats.siz ?? stats.res ?? 5;
  return deriveMaxHp(raw);
}

export function statModifier(value: number): number {
  return Math.floor((value - 5) / 2);
}

export function clampHp(hp: number, maxHp: number): number {
  const max = Math.max(1, maxHp);
  if (!Number.isFinite(hp)) return 0;
  return Math.min(max, Math.max(0, Math.floor(hp)));
}

export function scoreStatHints(text: string, key: string): number {
  const hay = text.toLowerCase();
  const entry = catalogEntry(key);
  if (!entry) return 0;
  return entry.hints.reduce((n, hint) => n + (hay.includes(hint.toLowerCase()) ? 1 : 0), 0);
}

/**
 * Starting spread for an AI character bot. Host must still confirm/edit.
 * Keyword hints from name/description tilt the pool; no match → even 5s.
 */
export function suggestBotStats(
  personaText: string,
  pool?: number,
  defs: readonly TrpgStatDefinition[] = DEFAULT_TRPG_STAT_DEFS
): Record<string, number> {
  const used = defs.length > 0 ? defs : DEFAULT_TRPG_STAT_DEFS;
  const usedPool = pool ?? pointPoolFor(used);
  const text = personaText.toLowerCase();
  const keys = used.map((d) => d.key);
  const scores: Record<string, number> = {};
  for (const key of keys) scores[key] = scoreStatHints(text, key);
  const values: Record<string, number> = {};
  for (const def of used) values[def.key] = def.min;
  let remaining = usedPool - used.reduce((s, d) => s + d.min, 0);
  const ranked = [...keys].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b));
  const hasHint = ranked.some((k) => (scores[k] ?? 0) > 0);
  if (!hasHint) return evenStats(used, usedPool);
  while (remaining > 0) {
    let progressed = false;
    for (const key of ranked) {
      const def = used.find((d) => d.key === key);
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
