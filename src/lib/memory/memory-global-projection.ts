import { getDb } from "@/lib/db";
import { clampLorebookPreferRecentChars } from "./memory-lorebook-trim";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";
import { calcUsedChars } from "./memory-used-chars";

export type GlobalProjectionKind =
  | "exact"
  | "global_compact"
  | "failure_fallback"
  | "stored_fallback"
  | "manual_global";

/** Emergency overflow trim — prefer-recent blocks, never empty for non-empty input. */
export function emergencyFallbackTrimLorebookSync(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0) return "";
  if (trimmed.length <= maxChars) return trimmed;
  const { text: fitted } = clampLorebookPreferRecentChars(trimmed, maxChars);
  if (fitted.trim()) return fitted;
  return trimmed.slice(0, maxChars).trimEnd() || trimmed.slice(0, maxChars);
}

export function isMechanicalEmergencyTrim(
  rebuilt: string,
  candidate: string,
  maxChars: number
): boolean {
  const normalizedCandidate = candidate.trim();
  if (!normalizedCandidate) return true;
  const normalizedRebuilt = rebuilt.trim();
  if (!normalizedRebuilt) return false;

  if (normalizedCandidate === emergencyFallbackTrimLorebookSync(normalizedRebuilt, maxChars)) {
    return true;
  }

  const prefix = clampMemoryRecordSummary(normalizedRebuilt.replace(/\s+/g, " ").trim(), maxChars, 0);
  if (normalizedCandidate === prefix) return true;

  const hardSlice = normalizedRebuilt.slice(0, maxChars).trimEnd();
  return normalizedCandidate === hardSlice;
}

export function getMaxActiveRecordUpdatedAt(chatId: number): string | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(updated_at) AS max_updated
       FROM chat_turn_summaries
       WHERE chat_id=? AND COALESCE(inactive, 0)=0`
    )
    .get(chatId) as { max_updated: string | null } | undefined;
  return row?.max_updated ?? null;
}

export function getMemoryRowUpdatedAt(chatId: number): string | null {
  const row = getDb()
    .prepare(`SELECT updated_at FROM chat_memories WHERE chat_id=?`)
    .get(chatId) as { updated_at: string | null } | undefined;
  return row?.updated_at ?? null;
}

export function isManualGlobalProjectionFresh(
  chatId: number,
  rebuilt: string,
  stored: string,
  maxChars: number
): boolean {
  const normalizedStored = stored.trim();
  if (!normalizedStored || normalizedStored.length > maxChars) return false;
  if (normalizedStored === rebuilt.trim()) return false;
  if (isMechanicalEmergencyTrim(rebuilt, normalizedStored, maxChars)) return false;

  const maxRecordUpdated = getMaxActiveRecordUpdatedAt(chatId);
  const memoryUpdated = getMemoryRowUpdatedAt(chatId);
  if (!memoryUpdated || !maxRecordUpdated) return false;
  return memoryUpdated >= maxRecordUpdated;
}

/**
 * Derived Global Summary in recent_summary is fresh when:
 * - bounded to budget
 * - not a mechanical emergency trim of rebuilt source
 * - no active source record updated after the memory row mirror/projection write
 */
export function isGlobalCompactProjectionFresh(
  chatId: number,
  rebuilt: string,
  stored: string,
  maxChars: number
): boolean {
  const normalizedStored = stored.trim();
  if (!normalizedStored || normalizedStored.length > maxChars) return false;
  if (isMechanicalEmergencyTrim(rebuilt, normalizedStored, maxChars)) return false;

  const maxRecordUpdated = getMaxActiveRecordUpdatedAt(chatId);
  const memoryUpdated = getMemoryRowUpdatedAt(chatId);
  if (maxRecordUpdated && memoryUpdated && maxRecordUpdated > memoryUpdated) {
    return false;
  }

  return true;
}

/** Invalidate compact projection by mirroring uncompacted rebuild into recent_summary. */
export function refreshGlobalMemoryMirrorFromRecords(chatId: number): void {
  const db = getDb();
  const row = db
    .prepare(`SELECT archive_summary FROM chat_memories WHERE chat_id=?`)
    .get(chatId) as { archive_summary: string } | undefined;
  const rebuilt = rebuildLorebookFromRecords(chatId);
  const archive = row?.archive_summary ?? "";
  db.prepare(
    `UPDATE chat_memories SET recent_summary=?, used_chars=?, updated_at=datetime('now') WHERE chat_id=?`
  ).run(
    rebuilt,
    calcUsedChars({ recent_summary: rebuilt, archive_summary: archive }),
    chatId
  );
}
