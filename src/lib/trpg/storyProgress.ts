import type { TrpgScenarioPlan } from "./scenarioPlan";

export type TrpgStoryProgress = {
  occurredMajorEventIndices: number[];
  revealedClueIndices: number[];
};

export function emptyStoryProgress(): TrpgStoryProgress {
  return { occurredMajorEventIndices: [], revealedClueIndices: [] };
}

function dedupeSorted(indices: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of indices) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort((a, b) => a - b);
  return out;
}

/** Parse persisted campaign story progress (already validated on write; defensive on read). */
export function parseStoryProgress(raw: unknown): TrpgStoryProgress {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyStoryProgress();
  const obj = raw as Record<string, unknown>;
  return {
    occurredMajorEventIndices: dedupeSorted(normalizeStoredIndices(obj.occurredMajorEventIndices)),
    revealedClueIndices: dedupeSorted(normalizeStoredIndices(obj.revealedClueIndices)),
  };
}

function normalizeStoredIndices(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const item of raw) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 0) out.push(item);
  }
  return out;
}

/** Parse GM delta index arrays: integers in [0, maxExclusive); drop invalid entries. */
/** GM wire parse before plan bounds are applied on commit. */
export function parseLooseStoryProgressDeltaIndices(raw: unknown): number[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  if (out.length === 0) return undefined;
  out.sort((a, b) => a - b);
  return out;
}

export function parseStoryProgressDeltaIndices(raw: unknown, maxExclusive: number): number[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  if (!Number.isInteger(maxExclusive) || maxExclusive < 0) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isInteger(item)) continue;
    if (item < 0 || item >= maxExclusive) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  out.sort((a, b) => a - b);
  return out;
}

export function freeClueCount(plan: TrpgScenarioPlan | null | undefined): number {
  if (!plan) return 0;
  if (plan.adventure?.events.length) return 0;
  return plan.clues.length;
}

export function mergeStoryProgress(
  current: TrpgStoryProgress,
  delta: {
    occurredMajorEventIndices?: number[];
    revealedClueIndices?: number[];
  },
  plan: TrpgScenarioPlan | null
): TrpgStoryProgress {
  const majorMax = plan?.majorEvents.length ?? 0;
  const clueMax = freeClueCount(plan);
  const occurredAdd = parseStoryProgressDeltaIndices(delta.occurredMajorEventIndices, majorMax);
  const revealedAdd = parseStoryProgressDeltaIndices(delta.revealedClueIndices, clueMax);
  return {
    occurredMajorEventIndices: dedupeSorted([...current.occurredMajorEventIndices, ...occurredAdd]),
    revealedClueIndices: dedupeSorted([...current.revealedClueIndices, ...revealedAdd]),
  };
}

export function hasStoryProgressContent(progress: TrpgStoryProgress): boolean {
  return progress.occurredMajorEventIndices.length > 0 || progress.revealedClueIndices.length > 0;
}

export function consumedIndexSet(indices: readonly number[]): Set<number> {
  return new Set(indices);
}

export function pendingIndexedPlanLines(
  items: readonly string[],
  consumed: ReadonlySet<number>
): string[] {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (consumed.has(i)) continue;
    const text = items[i]?.trim();
    if (!text) continue;
    rows.push(`- [${i}] ${text}`);
  }
  return rows;
}

export function indexedBullets(label: string, items: readonly string[], consumed: ReadonlySet<number>): string {
  const rows = pendingIndexedPlanLines(items, consumed);
  if (rows.length === 0) return "";
  return `${label}\n${rows.join("\n")}`;
}
