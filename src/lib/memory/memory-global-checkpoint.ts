import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import type { ChatMemoryRow } from "./memory-types";
import {
  buildGlobalSummarySourceFingerprint,
  buildGlobalSummarySourceFingerprintFromText,
} from "./memory-global-source-fingerprint";
import { calcUsedChars } from "./memory-used-chars";
import {
  formatMemoryBlock,
  isPromptInjectibleMemoryRecord,
  listPromptInjectibleMemoryRecords,
  rebuildLorebookFromRecords,
  resolvePromptInjectibleMemoryRecordBody,
  type MemoryRecordView,
} from "./memory-turn-summary";

/** Durable projection kinds persisted on chat_memories — runtime-only kinds omitted. */
export type DurableGlobalProjectionKind = "global_compact" | "manual_global";

export type GlobalCheckpointSnapshot = {
  projectionKind: DurableGlobalProjectionKind | null;
  sourceFingerprint: string | null;
  coveredThroughTurn: number | null;
  compactText: string;
};

export type GlobalCheckpointInvalidReason =
  | "missing_kind"
  | "missing_fingerprint"
  | "missing_covered_through"
  | "manual_global"
  | "prefix_mismatch"
  | "frontier_not_advanced"
  | "empty_delta"
  | "checkpoint_metadata_stale";

export function buildPrefixFingerprintThroughTurn(
  chatId: number,
  coveredThroughTurn: number
): string {
  return buildGlobalSummarySourceFingerprint(chatId, {
    excludeTurnStartGte: coveredThroughTurn + 1,
  });
}

export function readGlobalCheckpointSnapshot(
  row: Pick<
    ChatMemoryRow,
    | "recent_summary"
    | "global_projection_kind"
    | "global_source_fingerprint"
    | "global_covered_through_turn"
  >
): GlobalCheckpointSnapshot {
  return {
    projectionKind:
      row.global_projection_kind === "global_compact" ||
      row.global_projection_kind === "manual_global"
        ? row.global_projection_kind
        : null,
    sourceFingerprint: row.global_source_fingerprint?.trim() || null,
    coveredThroughTurn:
      row.global_covered_through_turn != null &&
      Number.isFinite(row.global_covered_through_turn) &&
      row.global_covered_through_turn > 0
        ? Math.floor(row.global_covered_through_turn)
        : null,
    compactText: row.recent_summary?.trim() ?? "",
  };
}

export function clearGlobalCheckpointMetadataSql(): string {
  return `global_projection_kind=NULL, global_source_fingerprint=NULL, global_covered_through_turn=NULL`;
}

/**
 * SQL predicate: the row is NOT a user-saved Global. Every derived-projection writer
 * (exact mirror, compact checkpoint, rebuilt mirror) gates its UPDATE on this so an
 * automatic path can never replace `manual_global` text — only the user save/release can.
 */
export const NOT_MANUAL_GLOBAL_PROTECTED_SQL = `(COALESCE(global_projection_kind,'')<>'manual_global' OR TRIM(COALESCE(recent_summary,''))='')`;

/** A manual Global is protected only while it actually carries user text. */
export function isManualGlobalActive(
  row: Pick<ChatMemoryRow, "recent_summary" | "global_projection_kind"> | null | undefined
): boolean {
  return (
    row?.global_projection_kind === "manual_global" && (row.recent_summary?.trim() ?? "") !== ""
  );
}

/**
 * Last completed playable turn the user's manual Global covered when it was saved. A 5-turn record
 * is fully covered when `turnEnd <= it`, fully new when `turnStart > it`, and straddles it otherwise.
 * `null` = legacy row saved before the boundary was recorded.
 */
export function readManualGlobalBoundary(
  row: Pick<ChatMemoryRow, "global_projection_kind" | "global_covered_through_turn">
): number | null {
  if (row.global_projection_kind !== "manual_global") return null;
  const covered = row.global_covered_through_turn;
  return covered != null && Number.isFinite(covered) && covered >= 0 ? Math.floor(covered) : null;
}

/** Highest turnEnd among prompt-injectible records — the sealed frontier a legacy manual row adopts. */
export function resolveInjectibleFrontier(records: readonly MemoryRecordView[]): number {
  return records
    .filter(isPromptInjectibleMemoryRecord)
    .reduce((max, record) => Math.max(max, record.turnEnd), 0);
}

/**
 * Boundary a sealing/reconciling writer keeps on a manual Global.
 * - recorded boundary: an exact completed-turn number, independent of which batches are sealed, so a
 *   seal, count repair or record edit can never pull it back to an older sealed turn. It only drops
 *   when turns it covers no longer exist (last-turn deletion); anything replayed afterwards is new.
 * - legacy `null`: adopted only by a seal (write path) as the frontier before that seal;
 *   reads and count repairs never invent one.
 */
export function nextManualGlobalBoundary(opts: {
  current: number | null;
  completedTurns: number;
  adoptFrontier?: number;
}): number | null {
  if (opts.current == null) return opts.adoptFrontier ?? null;
  return Math.min(opts.current, Math.max(0, Math.floor(opts.completedTurns)));
}

export function writeManualGlobalBoundaryCore(
  db: Database.Database,
  chatId: number,
  boundary: number | null
): void {
  db.prepare(
    `UPDATE chat_memories SET global_covered_through_turn=?
     WHERE chat_id=? AND global_projection_kind='manual_global'
       AND COALESCE(global_covered_through_turn,-1)<>COALESCE(?,-1)`
  ).run(boundary, chatId, boundary);
}

export function clearGlobalCheckpointMetadataCore(db: Database.Database, chatId: number): void {
  db.prepare(
    `UPDATE chat_memories SET ${clearGlobalCheckpointMetadataSql()}, updated_at=datetime('now') WHERE chat_id=?`
  ).run(chatId);
}

export function clearGlobalCheckpointMetadata(chatId: number): void {
  clearGlobalCheckpointMetadataCore(getDb(), chatId);
}

/** Upper turn boundary of canonical Global prompt-injectible source — max turnEnd, not contiguous. */
export function resolveCanonicalCompactFrontier(
  chatId: number,
  _playableTurnCount?: number
): number {
  return listPromptInjectibleMemoryRecords(chatId).reduce(
    (max, record) => Math.max(max, record.turnEnd),
    0
  );
}

export function isHealthyDurableGlobalCompactCheckpoint(
  chatId: number,
  checkpoint: GlobalCheckpointSnapshot
): boolean {
  if (checkpoint.projectionKind !== "global_compact") return false;
  if (!checkpoint.compactText.trim()) return false;
  if (!checkpoint.sourceFingerprint) return false;
  if (checkpoint.coveredThroughTurn == null || checkpoint.coveredThroughTurn <= 0) {
    return false;
  }
  return (
    buildPrefixFingerprintThroughTurn(chatId, checkpoint.coveredThroughTurn) ===
    checkpoint.sourceFingerprint
  );
}

export function canPreserveHealthyCheckpointOnPureAppend(opts: {
  chatId: number;
  checkpointBefore: GlobalCheckpointSnapshot;
  turnStart: number;
}): boolean {
  const { chatId, checkpointBefore, turnStart } = opts;
  if (!isHealthyDurableGlobalCompactCheckpoint(chatId, checkpointBefore)) return false;
  if (checkpointBefore.coveredThroughTurn == null) return false;
  if (turnStart <= checkpointBefore.coveredThroughTurn) return false;
  return (
    buildPrefixFingerprintThroughTurn(chatId, checkpointBefore.coveredThroughTurn) ===
    checkpointBefore.sourceFingerprint
  );
}

export type CheckpointProjectionState =
  | "no_projection"
  | "derived_compact"
  | "manual_global"
  | "invalid_mixed";

/** Pure invariant helper — States A/B/C only; mixed combinations are invalid. */
export function classifyCheckpointProjectionState(
  row: Pick<
    ChatMemoryRow,
    | "recent_summary"
    | "global_projection_kind"
    | "global_source_fingerprint"
    | "global_covered_through_turn"
  >,
  opts?: { chatId?: number }
): CheckpointProjectionState {
  const kind = row.global_projection_kind;
  const fingerprint = row.global_source_fingerprint?.trim() || null;
  const coveredThrough =
    row.global_covered_through_turn != null &&
    Number.isFinite(row.global_covered_through_turn) &&
    row.global_covered_through_turn > 0
      ? Math.floor(row.global_covered_through_turn)
      : null;
  const recent = row.recent_summary?.trim() ?? "";

  if (kind == null && fingerprint == null && coveredThrough == null) {
    return "no_projection";
  }
  if (kind === "manual_global" && fingerprint == null) {
    return "manual_global";
  }
  if (
    kind === "global_compact" &&
    fingerprint != null &&
    coveredThrough != null &&
    recent.length > 0
  ) {
    if (opts?.chatId != null) {
      const rebuilt = rebuildLorebookFromRecords(opts.chatId).trim();
      if (rebuilt && recent === rebuilt) {
        return "invalid_mixed";
      }
      if (!isHealthyDurableGlobalCompactCheckpoint(opts.chatId, readGlobalCheckpointSnapshot(row))) {
        return "invalid_mixed";
      }
    }
    return "derived_compact";
  }
  return "invalid_mixed";
}

export function buildCanonicalDeltaSourceAfterCheckpoint(
  chatId: number,
  coveredThroughTurn: number
): string {
  return listPromptInjectibleMemoryRecords(chatId)
    .filter((record) => record.turnStart > coveredThroughTurn)
    .map((record) => {
      const body = resolvePromptInjectibleMemoryRecordBody(record);
      if (!body) return "";
      return formatMemoryBlock(record.turnStart, record.turnEnd, body);
    })
    .filter(Boolean)
    .join("\n\n");
}

export function evaluateIncrementalAppendEligibility(opts: {
  chatId: number;
  checkpoint: GlobalCheckpointSnapshot;
  canonicalFrontier: number;
}): { eligible: boolean; reason?: GlobalCheckpointInvalidReason } {
  const { checkpoint, chatId, canonicalFrontier } = opts;
  if (checkpoint.projectionKind === "manual_global") {
    return { eligible: false, reason: "manual_global" };
  }
  if (checkpoint.projectionKind !== "global_compact") {
    return { eligible: false, reason: "missing_kind" };
  }
  if (!checkpoint.compactText) {
    return { eligible: false, reason: "missing_kind" };
  }
  if (!checkpoint.sourceFingerprint) {
    return { eligible: false, reason: "missing_fingerprint" };
  }
  if (checkpoint.coveredThroughTurn == null || checkpoint.coveredThroughTurn <= 0) {
    return { eligible: false, reason: "missing_covered_through" };
  }
  if (canonicalFrontier <= checkpoint.coveredThroughTurn) {
    return { eligible: false, reason: "frontier_not_advanced" };
  }
  const prefixNow = buildPrefixFingerprintThroughTurn(chatId, checkpoint.coveredThroughTurn);
  if (prefixNow !== checkpoint.sourceFingerprint) {
    return { eligible: false, reason: "prefix_mismatch" };
  }
  const delta = buildCanonicalDeltaSourceAfterCheckpoint(chatId, checkpoint.coveredThroughTurn);
  if (!delta.trim()) {
    return { eligible: false, reason: "empty_delta" };
  }
  return { eligible: true };
}

export function buildIncrementalCompactInput(
  previousCompact: string,
  deltaSource: string
): string {
  const compact = previousCompact.trim();
  const delta = deltaSource.trim();
  if (!compact) return delta;
  if (!delta) return compact;
  return `${compact}\n\n${delta}`;
}

export function isCheckpointMetadataCurrentInDb(
  db: Database.Database,
  chatId: number,
  snapshot: GlobalCheckpointSnapshot
): boolean {
  const row = db
    .prepare(
      `SELECT global_projection_kind, global_source_fingerprint, global_covered_through_turn
       FROM chat_memories WHERE chat_id=?`
    )
    .get(chatId) as
    | {
        global_projection_kind: string | null;
        global_source_fingerprint: string | null;
        global_covered_through_turn: number | null;
      }
    | undefined;
  if (!row) return false;
  return (
    row.global_projection_kind === snapshot.projectionKind &&
    (row.global_source_fingerprint?.trim() || null) === snapshot.sourceFingerprint &&
    row.global_covered_through_turn === snapshot.coveredThroughTurn
  );
}

export function commitGlobalCompactCheckpointCore(
  db: Database.Database,
  opts: {
    chatId: number;
    compactText: string;
    archiveSummary: string;
    coveredThroughTurn: number;
    sourceFingerprint: string;
  }
): void {
  const used = calcUsedChars({
    recent_summary: opts.compactText,
    archive_summary: opts.archiveSummary,
  });
  db.prepare(
    `UPDATE chat_memories SET
      recent_summary=?,
      global_projection_kind='global_compact',
      global_source_fingerprint=?,
      global_covered_through_turn=?,
      used_chars=?,
      updated_at=datetime('now')
     WHERE chat_id=? AND ${NOT_MANUAL_GLOBAL_PROTECTED_SQL}`
  ).run(
    opts.compactText,
    opts.sourceFingerprint,
    opts.coveredThroughTurn,
    used,
    opts.chatId
  );
}

export function commitManualGlobalCheckpointCore(
  db: Database.Database,
  opts: {
    chatId: number;
    manualText: string;
    archiveSummary: string;
    /** Last completed playable turn at save time; only later turns reach the AI as automatic memory. */
    coveredThroughTurn: number;
  }
): void {
  const used = calcUsedChars({
    recent_summary: opts.manualText,
    archive_summary: opts.archiveSummary,
  });
  db.prepare(
    `UPDATE chat_memories SET
      recent_summary=?,
      global_projection_kind='manual_global',
      global_source_fingerprint=NULL,
      global_covered_through_turn=?,
      used_chars=?,
      updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(opts.manualText, Math.max(0, Math.floor(opts.coveredThroughTurn)), used, opts.chatId);
}

export function commitExactGlobalMirrorCore(
  db: Database.Database,
  opts: {
    chatId: number;
    exactText: string;
    archiveSummary: string;
    summarizedTurnCount?: number;
  }
): void {
  const used = calcUsedChars({
    recent_summary: opts.exactText,
    archive_summary: opts.archiveSummary,
  });
  db.prepare(
    `UPDATE chat_memories SET
      recent_summary=?,
      ${clearGlobalCheckpointMetadataSql()},
      used_chars=?,
      summarized_turn_count=COALESCE(?, summarized_turn_count),
      updated_at=datetime('now')
     WHERE chat_id=? AND ${NOT_MANUAL_GLOBAL_PROTECTED_SQL}`
  ).run(
    opts.exactText,
    used,
    opts.summarizedTurnCount ?? null,
    opts.chatId
  );
}

export function fingerprintForCoveredThroughTurn(
  chatId: number,
  coveredThroughTurn: number
): string {
  return buildPrefixFingerprintThroughTurn(chatId, coveredThroughTurn);
}

export function fullCanonicalSourceFingerprint(chatId: number): string {
  return buildGlobalSummarySourceFingerprintFromText(rebuildLorebookFromRecords(chatId));
}
