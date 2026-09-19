import { getDb } from "@/lib/db";
import { clampLorebookPreferRecentChars } from "./memory-lorebook-trim";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
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

export function isManualGlobalProjectionFresh(
  _chatId: number,
  rebuilt: string,
  stored: string,
  maxChars: number
): boolean {
  const normalizedStored = stored.trim();
  const normalizedRebuilt = rebuilt.trim();
  if (!normalizedStored || normalizedStored.length > maxChars) return false;
  if (normalizedStored === normalizedRebuilt) return false;
  if (isMechanicalEmergencyTrim(rebuilt, normalizedStored, maxChars)) return false;
  return normalizedRebuilt.length <= maxChars;
}

/**
 * Derived Global compact in recent_summary is fresh when:
 * - bounded to budget
 * - not a mechanical emergency trim of current rebuilt source
 * - not the mirror-invalidated state (stored === full rebuilt)
 *
 * Durability across restarts relies on mutation owners mirroring/invalidating
 * recent_summary when chat_turn_summaries change — not SQLite timestamps.
 */
export function isGlobalCompactProjectionFresh(
  _chatId: number,
  rebuilt: string,
  stored: string,
  maxChars: number
): boolean {
  const normalizedStored = stored.trim();
  const normalizedRebuilt = rebuilt.trim();
  if (!normalizedStored || normalizedStored.length > maxChars) return false;
  if (isMechanicalEmergencyTrim(rebuilt, normalizedStored, maxChars)) return false;
  if (normalizedStored === normalizedRebuilt) return false;
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
  const mirror =
    rebuilt.length <= MEMORY_CAPACITY_FIXED
      ? rebuilt
      : emergencyFallbackTrimLorebookSync(rebuilt, MEMORY_CAPACITY_FIXED);
  db.prepare(
    `UPDATE chat_memories SET recent_summary=?, used_chars=?, updated_at=datetime('now') WHERE chat_id=?`
  ).run(
    mirror,
    calcUsedChars({ recent_summary: mirror, archive_summary: archive }),
    chatId
  );
}
