import type Database from "better-sqlite3";
import type { TrpgModelUsage } from "./billing";

/** Provider seat that produced a round usage row. */
export type TrpgUsageSeat = "bot" | "gm" | "director";

/**
 * Round-scoped provider usage with optional generation provenance.
 * Actual ledger rows live in `trpg_rounds.usage_json`.
 */
export type TrpgRoundUsageEntry = TrpgModelUsage & {
  /** GM generation token when `seat === "gm"`. */
  generationId?: string;
  seat?: TrpgUsageSeat;
};

/** Failed GM generations remain observable but never user-billable for round settlement. */
export const FAILED_GM_USER_BILLABLE = false as const;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function tagBotRoundUsage(usage: TrpgModelUsage): TrpgRoundUsageEntry {
  return { ...usage, seat: "bot" };
}

export function tagGmRoundUsage(usage: TrpgModelUsage, generationId: string): TrpgRoundUsageEntry {
  return { ...usage, seat: "gm", generationId };
}

/** Canonical actual provider usage owner — full round ledger in `usage_json`. */
export function loadRoundUsageEntries(db: Database.Database, roundId: number): TrpgRoundUsageEntry[] {
  const row = db.prepare(`SELECT usage_json FROM trpg_rounds WHERE id=?`).get(roundId) as
    | { usage_json: string | null }
    | undefined;
  return parseJson(row?.usage_json, [] as TrpgRoundUsageEntry[]);
}

export function loadRoundCommittedGenerationId(db: Database.Database, roundId: number): string | null {
  const row = db.prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE id=?`).get(roundId) as
    | { gm_committed_generation_id: string | null }
    | undefined;
  const id = row?.gm_committed_generation_id?.trim();
  return id ? id : null;
}

/**
 * Canonical user-billable usage projection for round settlement.
 * Bot/director rows are always billable; GM rows bill only when provenance matches committed generation.
 */
export function isTrpgRoundUsageEntryBillable(
  entry: TrpgRoundUsageEntry,
  committedGenerationId: string | null
): boolean {
  if (entry.seat === "gm") {
    if (!entry.generationId) {
      // Legacy GM rows without provenance metadata remain billable.
      return true;
    }
    return committedGenerationId != null && entry.generationId === committedGenerationId;
  }
  return true;
}

export function projectBillableRoundUsage(
  actual: readonly TrpgRoundUsageEntry[],
  committedGenerationId: string | null
): TrpgRoundUsageEntry[] {
  return actual.filter((entry) => isTrpgRoundUsageEntryBillable(entry, committedGenerationId));
}

/** Canonical round billing input owner — feeds `chargeTrpgCalls` for normal round settlement. */
export function loadBillableRoundUsage(db: Database.Database, roundId: number): TrpgRoundUsageEntry[] {
  return projectBillableRoundUsage(
    loadRoundUsageEntries(db, roundId),
    loadRoundCommittedGenerationId(db, roundId)
  );
}

export function toModelUsageCalls(entries: readonly TrpgRoundUsageEntry[]): TrpgModelUsage[] {
  return entries.map(({ generationId: _g, seat: _s, ...usage }) => usage);
}
