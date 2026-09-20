import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import type { ChatMemoryRow } from "./memory-types";
import { getChatMemoryRow } from "./memory-db";
import {
  buildGlobalSummarySourceFingerprint,
  buildGlobalSummarySourceFingerprintFromText,
} from "./memory-global-source-fingerprint";
import { calcUsedChars } from "./memory-used-chars";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import {
  formatMemoryBlock,
  listPromptInjectibleMemoryRecords,
  rebuildLorebookFromRecords,
  resolvePromptInjectibleMemoryRecordBody,
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

export function clearGlobalCheckpointMetadataCore(db: Database.Database, chatId: number): void {
  db.prepare(
    `UPDATE chat_memories SET ${clearGlobalCheckpointMetadataSql()}, updated_at=datetime('now') WHERE chat_id=?`
  ).run(chatId);
}

export function clearGlobalCheckpointMetadata(chatId: number): void {
  clearGlobalCheckpointMetadataCore(getDb(), chatId);
}

export function resolveCanonicalCompactFrontier(
  chatId: number,
  playableTurnCount?: number
): number {
  const records = listPromptInjectibleMemoryRecords(chatId);
  const inferredHigh = records.reduce((max, record) => Math.max(max, record.turnEnd), 0);
  const summarized = getChatMemoryRow(chatId)?.summarized_turn_count ?? 0;
  const turnCount = Math.max(
    playableTurnCount ?? 0,
    summarized,
    inferredHigh
  );
  return highestContiguousCompletedTurn(records, turnCount);
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
     WHERE chat_id=?`
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
      global_covered_through_turn=NULL,
      used_chars=?,
      updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(opts.manualText, used, opts.chatId);
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
     WHERE chat_id=?`
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
