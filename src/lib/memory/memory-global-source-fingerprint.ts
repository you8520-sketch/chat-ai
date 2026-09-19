import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import type { MemorySourceBoundary } from "./memory-source-boundary";
import { isMemoryWriteGuardCurrentCore } from "./memory-source-boundary";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";

/** Normalize canonical Global compact input — exact rebuild text from chat_turn_summaries. */
export function normalizeGlobalSummarySourceText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

export function buildGlobalSummarySourceFingerprintFromText(text: string): string {
  return createHash("sha256")
    .update(normalizeGlobalSummarySourceText(text))
    .digest("hex");
}

export function buildGlobalSummarySourceFingerprint(
  chatId: number,
  opts?: { excludeTurnStartGte?: number }
): string {
  return buildGlobalSummarySourceFingerprintFromText(rebuildLorebookFromRecords(chatId, opts));
}

export function isGlobalSummarySourceFingerprintCurrent(
  chatId: number,
  snapshotFingerprint: string,
  opts?: { excludeTurnStartGte?: number }
): boolean {
  return snapshotFingerprint === buildGlobalSummarySourceFingerprint(chatId, opts);
}

/**
 * Fail-closed commit guard for Global compact / mirror writes.
 * Requires memory boundary unchanged AND canonical summary source unchanged.
 */
export function canCommitGlobalSummaryProjection(opts: {
  db: Database.Database;
  chatId: number;
  boundarySnapshot: MemorySourceBoundary;
  sourceFingerprintBefore: string;
  sourceUserMessageIds?: number[];
}): boolean {
  if (
    !isMemoryWriteGuardCurrentCore(opts.db, {
      chatId: opts.chatId,
      snapshot: opts.boundarySnapshot,
      sourceUserMessageIds: opts.sourceUserMessageIds ?? [],
    })
  ) {
    return false;
  }
  return isGlobalSummarySourceFingerprintCurrent(opts.chatId, opts.sourceFingerprintBefore);
}
