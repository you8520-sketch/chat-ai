/**
 * Phase A one-shot 6→5 rolling-summary rebuild worker.
 * Dry-run mutates nothing and calls no provider.
 * Apply is chat-atomic: one failed batch keeps that chat's existing summaries.
 */
import { getDb } from "@/lib/db";
import {
  __getLastSummarizeTurnBatchError,
  composeBatchScopePayload,
} from "./memory-rolling-summary";
import { calcUsedChars, getOrCreateChatMemory } from "./memory-db";
import {
  highestContiguousCompletedTurn,
} from "./memory-summary-integrity";
import {
  listTargetFiveTurnBatches,
  targetSummarizedThrough,
} from "./memory-summary-range";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  type MemoryRecordView,
} from "./memory-turn-summary";
import {
  loadMemoryEligibleChatTurnsWithMessageIdsCore,
  type ChatTurnWithMessageIds,
} from "./memory-turn-loader";
import {
  getMemorySourceBoundaryCore,
  isMemoryWriteGuardCurrentCore,
} from "./memory-source-boundary";
import {
  memorySourceFingerprintStillValid,
  snapshotMemorySourceFingerprint,
} from "./memory-source-fingerprint";
import {
  buildScopePayloadFromShadowRecord,
  ShadowState,
} from "./memory-shadow-state";
import {
  ROLLING_SUMMARY_INTERVAL,
} from "./memory-constants";
import type { MemoryTier } from "./memory-types";
import {
  encodeScopePayload,
} from "./memory-summary-scope";
import { ensureMemorySummaryMigrationsTable } from "./memory-summary-migration-schema";
import type { DialogueTurn } from "@/lib/hybridMemory";

/** Migration/audit only — historical NULL→6 inference for inventory checks. */
const MIGRATION_LEGACY_NULL_TURN_END_OFFSET = 5;
const MIGRATION_LEGACY_SIX_TURN_SPAN = MIGRATION_LEGACY_NULL_TURN_END_OFFSET + 1;

type MigrationSummarySpan = {
  turnStart: number;
  turnEnd: number;
  turnCount: number;
};

function resolveMigrationStoredTurnEnd(
  turnStart: number,
  turnEnd: number | null | undefined
): number {
  if (turnEnd != null && Number.isFinite(turnEnd) && turnEnd >= turnStart) {
    return Math.floor(turnEnd);
  }
  return turnStart + MIGRATION_LEGACY_NULL_TURN_END_OFFSET;
}

function resolveMigrationRecordSpan(row: {
  turn_number: number;
  turn_end?: number | null;
}): MigrationSummarySpan {
  const turnStart = row.turn_number;
  const turnEnd = resolveMigrationStoredTurnEnd(turnStart, row.turn_end);
  return { turnStart, turnEnd, turnCount: turnEnd - turnStart + 1 };
}

function isMigrationLegacySixTurnBatch(span: MigrationSummarySpan): boolean {
  return span.turnCount === MIGRATION_LEGACY_SIX_TURN_SPAN;
}

/** @internal test-only — final shadow snapshot per chat before DB swap */
const migrationFinalShadowSnapshotsForTests = new Map<number, MemoryRecordView[]>();

export function __peekMigrationFinalShadowForTests(
  chatId?: number
): readonly MemoryRecordView[] | null {
  if (chatId != null) {
    return migrationFinalShadowSnapshotsForTests.get(chatId) ?? null;
  }
  const snapshots = [...migrationFinalShadowSnapshotsForTests.values()];
  return snapshots.length > 0 ? snapshots[snapshots.length - 1]! : null;
}

export function __clearMigrationFinalShadowForTests(): void {
  migrationFinalShadowSnapshotsForTests.clear();
}

function cloneShadowRecordsForTestPeek(
  records: readonly MemoryRecordView[]
): MemoryRecordView[] {
  return records.map((record) => ({
    ...record,
    scopes: { ...record.scopes },
  }));
}

export type LegacySixTurnInventory = {
  ACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS: number;
  INACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS: number;
  USER_EDITED_NULL_SPAN_ROWS: number;
  TOTAL_AUTOMATIC_LEGACY_6TURN_ROWS: number;
};

export type MemoryEligibleTurnIdentity = {
  turnNumber: number;
  userMessageId: number | null;
  assistantMessageId: number | null;
};

function migrationTableExists(db: ReturnType<typeof getDb>): boolean {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_summary_migrations'`
    )
    .get() as { name?: string } | undefined;
  return Boolean(row?.name);
}

function readMigrationAlreadyCompleted(
  db: ReturnType<typeof getDb>,
  chatId: number
): boolean {
  if (!migrationTableExists(db)) return false;
  const existing = db
    .prepare(
      `SELECT status FROM memory_summary_migrations
       WHERE chat_id=? AND migration_version=?`
    )
    .get(chatId, MEMORY_SUMMARY_MIGRATION_VERSION) as
    | { status: MemorySummaryMigrationStatus }
    | undefined;
  return existing?.status === "COMPLETED";
}

export function memoryEligibleTurnIdentitiesEqual(
  a: readonly MemoryEligibleTurnIdentity[],
  b: readonly MemoryEligibleTurnIdentity[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.turnNumber !== right.turnNumber ||
      left.userMessageId !== right.userMessageId ||
      left.assistantMessageId !== right.assistantMessageId
    ) {
      return false;
    }
  }
  return true;
}

function turnIdentitiesFromEligible(
  turns: readonly ChatTurnWithMessageIds[]
): MemoryEligibleTurnIdentity[] {
  return turns.map((turn) => ({
    turnNumber: turn.turnNumber,
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMessageId,
  }));
}

export function countLegacySixTurnInventory(
  db: ReturnType<typeof getDb> = getDb()
): LegacySixTurnInventory {
  const rows = db
    .prepare(
      `SELECT turn_number, turn_end, user_edited, inactive
       FROM chat_turn_summaries`
    )
    .all() as Array<{
    turn_number: number;
    turn_end: number | null;
    user_edited: number;
    inactive: number;
  }>;
  let active = 0;
  let inactive = 0;
  let userEditedNullSpan = 0;
  for (const row of rows) {
    if (row.user_edited && row.turn_end == null) {
      userEditedNullSpan += 1;
    }
    if (row.user_edited) continue;
    const span = resolveMigrationRecordSpan(row);
    if (!isMigrationLegacySixTurnBatch(span)) continue;
    if (row.inactive) inactive += 1;
    else active += 1;
  }
  return {
    ACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS: active,
    INACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS: inactive,
    USER_EDITED_NULL_SPAN_ROWS: userEditedNullSpan,
    TOTAL_AUTOMATIC_LEGACY_6TURN_ROWS: active + inactive,
  };
}

export function countUserEditedNullSpanRows(
  db: ReturnType<typeof getDb> = getDb(),
  chatId?: number
): number {
  const rows = chatId
    ? (db
        .prepare(
          `SELECT turn_number, turn_end, user_edited FROM chat_turn_summaries WHERE chat_id=?`
        )
        .all(chatId) as Array<{ turn_number: number; turn_end: number | null; user_edited: number }>)
    : (db
        .prepare(`SELECT turn_number, turn_end, user_edited FROM chat_turn_summaries`)
        .all() as Array<{ turn_number: number; turn_end: number | null; user_edited: number }>);
  return rows.filter((row) => row.user_edited === 1 && row.turn_end == null).length;
}

export function materializeUserEditedNullSpanRows(
  db: ReturnType<typeof getDb>,
  chatId: number
): number {
  const info = db
    .prepare(
      `UPDATE chat_turn_summaries
       SET turn_end = turn_number + ?, updated_at=datetime('now')
       WHERE chat_id=? AND user_edited=1 AND turn_end IS NULL`
    )
    .run(MIGRATION_LEGACY_NULL_TURN_END_OFFSET, chatId);
  return Number(info.changes);
}

export function deleteInactiveAutomaticLegacySixTurnRows(
  db: ReturnType<typeof getDb>,
  chatId: number
): number {
  const rows = db
    .prepare(
      `SELECT id, turn_number, turn_end, user_edited, inactive
       FROM chat_turn_summaries WHERE chat_id=? AND user_edited=0 AND inactive=1`
    )
    .all(chatId) as Array<{
    id: number;
    turn_number: number;
    turn_end: number | null;
    user_edited: number;
    inactive: number;
  }>;
  let deleted = 0;
  for (const row of rows) {
    if (!isMigrationLegacySixTurnBatch(resolveMigrationRecordSpan(row))) continue;
    db.prepare(`DELETE FROM chat_turn_summaries WHERE id=? AND chat_id=?`).run(row.id, chatId);
    deleted += 1;
  }
  return deleted;
}

/** Phase C cleanup requires zero automatic legacy 6-turn rows and zero NULL user-edited spans. */
export function isPhaseCLegacyCleanupAllowed(
  inventory: LegacySixTurnInventory = countLegacySixTurnInventory()
): boolean {
  return (
    inventory.TOTAL_AUTOMATIC_LEGACY_6TURN_ROWS === 0 &&
    inventory.USER_EDITED_NULL_SPAN_ROWS === 0
  );
}

export { ensureMemorySummaryMigrationsTable } from "./memory-summary-migration-schema";

export const MEMORY_SUMMARY_MIGRATION_VERSION = "5turn_rebuild_v1";

export type MemorySummaryMigrationStatus =
  | "PENDING"
  | "COMPLETED"
  | "BLOCKED_MISSING_RAW"
  | "BLOCKED_COVERAGE_GAP"
  | "BLOCKED_STALE_EPOCH"
  | "BLOCKED_USER_EDITED"
  | "FAILED_PROVIDER"
  | "FAILED_VALIDATION"
  | "SOURCE_CHANGED";

export type MemorySummaryMigrationRow = {
  chat_id: number;
  migration_version: string;
  status: MemorySummaryMigrationStatus;
  source_completed_turns: number | null;
  target_summarized_through: number | null;
  batches_total: number | null;
  batches_completed: number | null;
  attempt_count: number;
  last_error_code: string | null;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
};

export type MemorySummaryMigrationDryRunReport = {
  TOTAL_CHATS: number;
  CHATS_WITH_SUMMARIES: number;
  CHATS_WITH_LEGACY_6TURN_ROWS: number;
  CHATS_ALREADY_5TURN_ONLY: number;
  CHATS_MIXED_5_AND_6: number;
  CHATS_REQUIRING_REBUILD: number;
  TOTAL_TARGET_5TURN_BATCHES: number;
  TOTAL_PROVIDER_CALLS_ESTIMATE: number;
  TOTAL_SOURCE_CHARS_ESTIMATE: number;
  MISSING_RAW_CHATS: number;
  COVERAGE_GAP_CHATS: number;
  USER_EDITED_BLOCKED_CHATS: number;
  ALREADY_COMPLETED: number;
};

export type MemorySummaryMigrationApplyReport = {
  MIGRATED_CHATS: number;
  MIGRATED_BATCHES: number;
  FAILED_CHATS: number;
  BLOCKED_CHATS: number;
  SKIPPED_COMPLETED: number;
  LEGACY_6TURN_ROWS_REMAINING: number;
  INVALID_5TURN_ROWS: number;
  SUMMARIZED_FRONTIER_MISMATCHES: number;
  STALE_REBUILDS_REJECTED: number;
};

export function resolveMigrationConcurrency(env = process.env): number {
  const raw = env.MEMORY_SUMMARY_MIGRATION_CONCURRENCY?.trim();
  const parsed = raw ? Number(raw) : 1;
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(8, Math.trunc(parsed)));
}

type AutomaticSummaryRow = {
  turn_number: number;
  turn_end: number | null;
  summary: string;
  summary_kind: string;
  user_edited: number;
  inactive: number;
};

function listAutomaticSummaryRows(
  db: ReturnType<typeof getDb>,
  chatId: number
): AutomaticSummaryRow[] {
  return db
    .prepare(
      `SELECT turn_number, turn_end, summary, summary_kind, user_edited, inactive
       FROM chat_turn_summaries
       WHERE chat_id=? AND inactive=0`
    )
    .all(chatId) as AutomaticSummaryRow[];
}

function classifyChatSummaries(rows: AutomaticSummaryRow[]): {
  hasLegacy6: boolean;
  hasFive: boolean;
  hasUserEdited: boolean;
  automaticRows: AutomaticSummaryRow[];
} {
  let hasLegacy6 = false;
  let hasFive = false;
  let hasUserEdited = false;
  const automaticRows: AutomaticSummaryRow[] = [];
  for (const row of rows) {
    if (row.user_edited) {
      hasUserEdited = true;
      continue;
    }
    automaticRows.push(row);
    const span = resolveMigrationRecordSpan(row);
    if (isMigrationLegacySixTurnBatch(span)) hasLegacy6 = true;
    else if (span.turnCount === ROLLING_SUMMARY_INTERVAL) hasFive = true;
  }
  return { hasLegacy6, hasFive, hasUserEdited, automaticRows };
}

function listChatIds(db: ReturnType<typeof getDb>): number[] {
  const rows = db.prepare("SELECT id FROM chats").all() as { id: number }[];
  return rows.map((r) => r.id);
}

export function classifyChatForFiveTurnRebuild(
  db: ReturnType<typeof getDb>,
  chatId: number
): {
  completedTurns: number;
  targetThrough: number;
  batches: Array<{ turnStart: number; turnEnd: number }>;
  sourceChars: number;
  hasLegacy6: boolean;
  hasFive: boolean;
  hasUserEdited: boolean;
  missingRaw: boolean;
  coverageGap: boolean;
  alreadyFiveOnly: boolean;
  requiresRebuild: boolean;
  alreadyCompleted: boolean;
} {
  const alreadyCompleted = readMigrationAlreadyCompleted(db, chatId);

  const boundary = getMemorySourceBoundaryCore(db, chatId);
  const eligible = loadMemoryEligibleChatTurnsWithMessageIdsCore(db, chatId, boundary);
  const completedTurns = eligible.length;
  const targetThrough = targetSummarizedThrough(completedTurns);
  const batches = listTargetFiveTurnBatches(completedTurns);
  const rows = listAutomaticSummaryRows(db, chatId);
  const { hasLegacy6, hasFive, hasUserEdited, automaticRows } = classifyChatSummaries(rows);

  const eligibleByTurn = new Map(eligible.map((t) => [t.turnNumber, t]));
  let missingRaw = false;
  let sourceChars = 0;
  for (const batch of batches) {
    for (let turn = batch.turnStart; turn <= batch.turnEnd; turn++) {
      const hit = eligibleByTurn.get(turn);
      if (!hit) {
        missingRaw = true;
        continue;
      }
      sourceChars += (hit.user?.length ?? 0) + (hit.assistant?.length ?? 0);
    }
  }

  if (hasLegacy6 && batches.length === 0) {
    missingRaw = true;
  }

  const coverageGap =
    targetThrough > 0 &&
    (eligible.length < targetThrough ||
      batches.some((b) => {
        for (let t = b.turnStart; t <= b.turnEnd; t++) {
          if (!eligibleByTurn.has(t)) return true;
        }
        return false;
      }));

  const alreadyFiveOnly =
    !hasLegacy6 &&
    hasFive &&
    automaticRows.every((row) => resolveMigrationRecordSpan(row).turnCount === ROLLING_SUMMARY_INTERVAL);

  const requiresRebuild =
    !alreadyCompleted &&
    (hasLegacy6 || (automaticRows.length > 0 && !alreadyFiveOnly));

  return {
    completedTurns,
    targetThrough,
    batches,
    sourceChars,
    hasLegacy6,
    hasFive,
    hasUserEdited,
    missingRaw,
    coverageGap,
    alreadyFiveOnly,
    requiresRebuild,
    alreadyCompleted,
  };
}

export function dryRunMemorySummaryMigration(
  db: ReturnType<typeof getDb> = getDb()
): MemorySummaryMigrationDryRunReport {
  const chatIds = listChatIds(db);
  const report: MemorySummaryMigrationDryRunReport = {
    TOTAL_CHATS: chatIds.length,
    CHATS_WITH_SUMMARIES: 0,
    CHATS_WITH_LEGACY_6TURN_ROWS: 0,
    CHATS_ALREADY_5TURN_ONLY: 0,
    CHATS_MIXED_5_AND_6: 0,
    CHATS_REQUIRING_REBUILD: 0,
    TOTAL_TARGET_5TURN_BATCHES: 0,
    TOTAL_PROVIDER_CALLS_ESTIMATE: 0,
    TOTAL_SOURCE_CHARS_ESTIMATE: 0,
    MISSING_RAW_CHATS: 0,
    COVERAGE_GAP_CHATS: 0,
    USER_EDITED_BLOCKED_CHATS: 0,
    ALREADY_COMPLETED: 0,
  };

  for (const chatId of chatIds) {
    const rows = listAutomaticSummaryRows(db, chatId);
    if (rows.length > 0) report.CHATS_WITH_SUMMARIES += 1;
    const classified = classifyChatForFiveTurnRebuild(db, chatId);
    if (classified.hasLegacy6) report.CHATS_WITH_LEGACY_6TURN_ROWS += 1;
    if (classified.alreadyFiveOnly) report.CHATS_ALREADY_5TURN_ONLY += 1;
    if (classified.hasLegacy6 && classified.hasFive) report.CHATS_MIXED_5_AND_6 += 1;
    if (classified.alreadyCompleted) report.ALREADY_COMPLETED += 1;
    if (classified.hasUserEdited && classified.requiresRebuild) {
      report.USER_EDITED_BLOCKED_CHATS += 1;
    }
    if (classified.requiresRebuild) {
      report.CHATS_REQUIRING_REBUILD += 1;
      report.TOTAL_TARGET_5TURN_BATCHES += classified.batches.length;
      report.TOTAL_PROVIDER_CALLS_ESTIMATE += classified.batches.length;
      report.TOTAL_SOURCE_CHARS_ESTIMATE += classified.sourceChars;
      if (classified.missingRaw) report.MISSING_RAW_CHATS += 1;
      if (classified.coverageGap) report.COVERAGE_GAP_CHATS += 1;
    }
  }
  return report;
}

function upsertMigrationState(
  db: ReturnType<typeof getDb>,
  row: Partial<MemorySummaryMigrationRow> & {
    chat_id: number;
    status: MemorySummaryMigrationStatus;
  }
): void {
  ensureMemorySummaryMigrationsTable(db);
  db.prepare(
    `INSERT INTO memory_summary_migrations (
       chat_id, migration_version, status, source_completed_turns, target_summarized_through,
       batches_total, batches_completed, attempt_count, last_error_code, started_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, COALESCE(?, datetime('now')), datetime('now'), ?)
     ON CONFLICT(chat_id, migration_version) DO UPDATE SET
       status=excluded.status,
       source_completed_turns=excluded.source_completed_turns,
       target_summarized_through=excluded.target_summarized_through,
       batches_total=excluded.batches_total,
       batches_completed=excluded.batches_completed,
       attempt_count=attempt_count+1,
       last_error_code=excluded.last_error_code,
       updated_at=datetime('now'),
       completed_at=excluded.completed_at`
  ).run(
    row.chat_id,
    MEMORY_SUMMARY_MIGRATION_VERSION,
    row.status,
    row.source_completed_turns ?? null,
    row.target_summarized_through ?? null,
    row.batches_total ?? null,
    row.batches_completed ?? null,
    row.last_error_code ?? null,
    row.started_at ?? null,
    row.status === "COMPLETED" ? new Date().toISOString() : null
  );
}

export async function migrateChatSummariesToFiveTurn(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier?: MemoryTier;
  dryRun?: boolean;
}): Promise<{
  status: MemorySummaryMigrationStatus;
  batchesCompleted: number;
}> {
  const db = getDb();
  migrationFinalShadowSnapshotsForTests.delete(opts.chatId);
  const classified = classifyChatForFiveTurnRebuild(db, opts.chatId);

  if (opts.dryRun) {
    if (classified.alreadyCompleted) {
      return { status: "COMPLETED", batchesCompleted: classified.batches.length };
    }
    if (!classified.requiresRebuild) {
      return { status: "COMPLETED", batchesCompleted: classified.batches.length };
    }
    if (classified.hasUserEdited) {
      return { status: "BLOCKED_USER_EDITED", batchesCompleted: 0 };
    }
    if (classified.missingRaw) {
      return { status: "BLOCKED_MISSING_RAW", batchesCompleted: 0 };
    }
    if (classified.coverageGap) {
      return { status: "BLOCKED_COVERAGE_GAP", batchesCompleted: 0 };
    }
    return { status: "PENDING", batchesCompleted: 0 };
  }

  ensureMemorySummaryMigrationsTable(db);
  if (classified.alreadyCompleted) {
    return { status: "COMPLETED", batchesCompleted: classified.batches.length };
  }
  if (!classified.requiresRebuild) {
    ensureMemorySummaryMigrationsTable(db);
    const inactiveLegacy = countLegacySixTurnInventory(db);
    if (inactiveLegacy.INACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS > 0) {
      db.transaction(() => {
        deleteInactiveAutomaticLegacySixTurnRows(db, opts.chatId);
        materializeUserEditedNullSpanRows(db, opts.chatId);
      }).immediate();
    } else {
      materializeUserEditedNullSpanRows(db, opts.chatId);
    }
    upsertMigrationState(db, {
      chat_id: opts.chatId,
      status: "COMPLETED",
      source_completed_turns: classified.completedTurns,
      target_summarized_through: classified.targetThrough,
      batches_total: classified.batches.length,
      batches_completed: classified.batches.length,
    });
    return { status: "COMPLETED", batchesCompleted: classified.batches.length };
  }
  if (classified.hasUserEdited) {
    upsertMigrationState(db, {
      chat_id: opts.chatId,
      status: "BLOCKED_USER_EDITED",
      source_completed_turns: classified.completedTurns,
      target_summarized_through: classified.targetThrough,
      batches_total: classified.batches.length,
      batches_completed: 0,
      last_error_code: "BLOCKED_USER_EDITED",
    });
    return { status: "BLOCKED_USER_EDITED", batchesCompleted: 0 };
  }
  if (classified.missingRaw) {
    upsertMigrationState(db, {
      chat_id: opts.chatId,
      status: "BLOCKED_MISSING_RAW",
      source_completed_turns: classified.completedTurns,
      target_summarized_through: classified.targetThrough,
      batches_total: classified.batches.length,
      batches_completed: 0,
      last_error_code: "BLOCKED_MISSING_RAW",
    });
    return { status: "BLOCKED_MISSING_RAW", batchesCompleted: 0 };
  }
  if (classified.coverageGap) {
    upsertMigrationState(db, {
      chat_id: opts.chatId,
      status: "BLOCKED_COVERAGE_GAP",
      source_completed_turns: classified.completedTurns,
      target_summarized_through: classified.targetThrough,
      batches_total: classified.batches.length,
      batches_completed: 0,
      last_error_code: "BLOCKED_COVERAGE_GAP",
    });
    return { status: "BLOCKED_COVERAGE_GAP", batchesCompleted: 0 };
  }

  const startBoundary = getMemorySourceBoundaryCore(db, opts.chatId);
  const eligible = loadMemoryEligibleChatTurnsWithMessageIdsCore(
    db,
    opts.chatId,
    startBoundary
  );
  const startFingerprint = snapshotMemorySourceFingerprint(eligible, startBoundary);
  const shadowState = new ShadowState();

  for (const batch of classified.batches) {
    const batchTurns = eligible.filter(
      (t) => t.turnNumber >= batch.turnStart && t.turnNumber <= batch.turnEnd
    );
    if (batchTurns.length !== ROLLING_SUMMARY_INTERVAL) {
      return { status: "BLOCKED_COVERAGE_GAP", batchesCompleted: 0 };
    }
    const allEntries = batchTurns.map((meta) => ({
      turnIndex: meta.turnNumber,
      turn: { user: meta.user, assistant: meta.assistant } satisfies DialogueTurn,
      userMessageId: meta.userMessageId,
    }));
    const previousWasNoncanonOrBranch = shadowState.priorRecords.some(
      (record) =>
        !record.inactive &&
        (record.summaryKind === "noncanon" ||
          (record.summaryKind === "branch_canon" && record.branchStatus === "active"))
    );
    let composed;
    try {
      composed = await composeBatchScopePayload({
        chatId: opts.chatId,
        batchStart: batch.turnStart,
        endTurn: batch.turnEnd,
        allEntries,
        charName: opts.charName,
        mode: "seal",
        existingRecord: null,
        previousWasNoncanonOrBranch,
        priorRecords: [...shadowState.priorRecords],
      });
    } catch {
      return { status: "FAILED_PROVIDER", batchesCompleted: 0 };
    }
    if (!composed.ok) {
      const lastError = __getLastSummarizeTurnBatchError() ?? composed.reason ?? "";
      const providerFailed =
        composed.reason === "SUMMARY_TIMEOUT" ||
        (lastError.length > 0 && !lastError.startsWith("SUMMARY_"));
      return {
        status: providerFailed ? "FAILED_PROVIDER" : "FAILED_VALIDATION",
        batchesCompleted: 0,
      };
    }

    shadowState.applyPendingOps(composed.pendingBranchControlOps);
    shadowState.appendFromComposed(
      { turnStart: batch.turnStart, turnEnd: batch.turnEnd },
      {
        summaryKind: composed.summaryKind,
        scopes: composed.scopes,
        branchId: composed.branchId,
        branchStatus: composed.branchStatus,
        promotedBy: composed.promotedBy,
        promotedAt: composed.promotedAt,
        displaySummary: composed.displaySummary,
      },
      {
        sourceStartUserMessageId: batchTurns[0]?.userMessageId ?? null,
        sourceEndUserMessageId: batchTurns[batchTurns.length - 1]?.userMessageId ?? null,
        assistantMessageId: batchTurns[batchTurns.length - 1]?.assistantMessageId ?? null,
      }
    );

    const batchBoundary = getMemorySourceBoundaryCore(db, opts.chatId);
    const batchEligible = loadMemoryEligibleChatTurnsWithMessageIdsCore(
      db,
      opts.chatId,
      batchBoundary
    );
    if (
      !memorySourceFingerprintStillValid(startFingerprint, batchEligible, batchBoundary)
    ) {
      return { status: "SOURCE_CHANGED", batchesCompleted: 0 };
    }
  }

  const finalShadowRecords = shadowState.finalRecords();
  if (finalShadowRecords.length !== classified.batches.length) {
    return { status: "FAILED_VALIDATION", batchesCompleted: 0 };
  }

  const swapBoundary = getMemorySourceBoundaryCore(db, opts.chatId);
  const latestEligible = loadMemoryEligibleChatTurnsWithMessageIdsCore(
    db,
    opts.chatId,
    swapBoundary
  );
  if (
    !memorySourceFingerprintStillValid(startFingerprint, latestEligible, swapBoundary)
  ) {
    return { status: "SOURCE_CHANGED", batchesCompleted: 0 };
  }

  const tier = opts.tier ?? "free";
  ensureMemorySummaryMigrationsTable(db);
  getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, tier);
  migrationFinalShadowSnapshotsForTests.set(
    opts.chatId,
    cloneShadowRecordsForTestPeek(finalShadowRecords)
  );

  try {
    db.transaction(() => {
      if (
        !isMemoryWriteGuardCurrentCore(db, {
          chatId: opts.chatId,
          snapshot: startBoundary,
        })
      ) {
        throw Object.assign(new Error("STALE_MEMORY_EPOCH"), {
          code: "STALE_MEMORY_EPOCH",
        });
      }
      db.prepare(
        `DELETE FROM chat_turn_summaries WHERE chat_id=? AND user_edited=0`
      ).run(opts.chatId);
      deleteInactiveAutomaticLegacySixTurnRows(db, opts.chatId);
      materializeUserEditedNullSpanRows(db, opts.chatId);
      const insert = db.prepare(
        `INSERT INTO chat_turn_summaries
          (chat_id, turn_number, turn_end, assistant_message_id, summary, summary_kind, user_edited,
           source_start_user_message_id, source_end_user_message_id, scope_payload,
           branch_id, branch_status, promoted_by, promoted_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const record of finalShadowRecords) {
        const sourceMeta = shadowState.sourceMetaFor(record.turnStart);
        const scopePayload = buildScopePayloadFromShadowRecord(record);
        insert.run(
          opts.chatId,
          record.turnStart,
          record.turnEnd,
          record.assistantMessageId,
          record.summary,
          record.summaryKind,
          sourceMeta?.sourceStartUserMessageId ?? null,
          sourceMeta?.sourceEndUserMessageId ?? null,
          encodeScopePayload(scopePayload),
          record.branchId,
          record.branchStatus,
          record.promotedBy,
          record.promotedAt
        );
      }
      const after = listMemoryRecordsForChat(opts.chatId);
      const contiguous = highestContiguousCompletedTurn(after, latestEligible.length);
      const recent = rebuildLorebookFromRecords(opts.chatId) || "";
      const current = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, tier);
      const used = calcUsedChars({
        recent_summary: recent,
        archive_summary: current.archive_summary,
      });
      db.prepare(
        `UPDATE chat_memories SET
          recent_summary=?, used_chars=?, summarized_turn_count=?,
          last_compressed_at=?, updated_at=datetime('now')
         WHERE chat_id=?`
      ).run(recent, used, contiguous, new Date().toISOString(), opts.chatId);
      db.prepare("UPDATE chats SET current_summary=? WHERE id=?").run(recent.trim(), opts.chatId);
      upsertMigrationState(db, {
        chat_id: opts.chatId,
        status: "COMPLETED",
        source_completed_turns: latestEligible.length,
        target_summarized_through: targetSummarizedThrough(latestEligible.length),
        batches_total: finalShadowRecords.length,
        batches_completed: finalShadowRecords.length,
      });
    }).immediate();
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "STALE_MEMORY_EPOCH") {
      upsertMigrationState(db, {
        chat_id: opts.chatId,
        status: "BLOCKED_STALE_EPOCH",
        source_completed_turns: classified.completedTurns,
        target_summarized_through: classified.targetThrough,
        batches_total: classified.batches.length,
        batches_completed: 0,
        last_error_code: "STALE_MEMORY_EPOCH",
      });
      return { status: "BLOCKED_STALE_EPOCH", batchesCompleted: 0 };
    }
    upsertMigrationState(db, {
      chat_id: opts.chatId,
      status: "FAILED_VALIDATION",
      source_completed_turns: classified.completedTurns,
      target_summarized_through: classified.targetThrough,
      batches_total: classified.batches.length,
      batches_completed: 0,
      last_error_code: (e as Error).message?.slice(0, 80) ?? "FAILED_VALIDATION",
    });
    return { status: "FAILED_VALIDATION", batchesCompleted: 0 };
  }

  return { status: "COMPLETED", batchesCompleted: finalShadowRecords.length };
}

export function countLegacySixTurnRows(db: ReturnType<typeof getDb> = getDb()): number {
  return countLegacySixTurnInventory(db).ACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS;
}

export function collectApplyVerification(
  db: ReturnType<typeof getDb> = getDb()
): Pick<
  MemorySummaryMigrationApplyReport,
  "LEGACY_6TURN_ROWS_REMAINING" | "INVALID_5TURN_ROWS" | "SUMMARIZED_FRONTIER_MISMATCHES"
> {
  const rows = db
    .prepare(
      `SELECT chat_id, turn_number, turn_end, user_edited, inactive
       FROM chat_turn_summaries`
    )
    .all() as Array<{
    chat_id: number;
    turn_number: number;
    turn_end: number | null;
    user_edited: number;
    inactive: number;
  }>;
  let invalidFive = 0;
  let legacy = 0;
  for (const row of rows) {
    if (row.user_edited || row.inactive) continue;
    const span = resolveMigrationRecordSpan(row);
    if (span.turnCount === MIGRATION_LEGACY_SIX_TURN_SPAN) legacy += 1;
    else if (span.turnCount !== ROLLING_SUMMARY_INTERVAL || row.turn_end == null) {
      invalidFive += 1;
    }
  }
  let frontierMismatches = 0;
  const chats = db
    .prepare("SELECT chat_id, summarized_turn_count FROM chat_memories")
    .all() as Array<{ chat_id: number; summarized_turn_count: number }>;
  for (const chat of chats) {
    const records = listMemoryRecordsForChat(chat.chat_id);
    const completed = loadMemoryEligibleChatTurnsWithMessageIdsCore(db, chat.chat_id).length;
    const expected = highestContiguousCompletedTurn(records, completed);
    if ((chat.summarized_turn_count ?? 0) !== expected) frontierMismatches += 1;
  }
  return {
    LEGACY_6TURN_ROWS_REMAINING: legacy,
    INVALID_5TURN_ROWS: invalidFive,
    SUMMARIZED_FRONTIER_MISMATCHES: frontierMismatches,
  };
}

export async function runMemorySummaryMigrationPass(opts?: {
  dryRun?: boolean;
  chatIds?: number[];
  concurrency?: number;
}): Promise<{
  dryRun: MemorySummaryMigrationDryRunReport;
  apply: MemorySummaryMigrationApplyReport | null;
}> {
  const db = getDb();
  const dryRunReport = dryRunMemorySummaryMigration(db);
  const shouldDryRun = opts?.dryRun !== false;
  if (shouldDryRun) {
    return { dryRun: dryRunReport, apply: null };
  }

  ensureMemorySummaryMigrationsTable(db);
  const apply: MemorySummaryMigrationApplyReport = {
    MIGRATED_CHATS: 0,
    MIGRATED_BATCHES: 0,
    FAILED_CHATS: 0,
    BLOCKED_CHATS: 0,
    SKIPPED_COMPLETED: 0,
    STALE_REBUILDS_REJECTED: 0,
    ...collectApplyVerification(db),
  };

  const chatIds = opts?.chatIds ?? listChatIds(db);
  const chatMeta = db
    .prepare("SELECT id, user_id, character_id FROM chats")
    .all() as Array<{ id: number; user_id: number; character_id: number }>;
  const metaById = new Map(chatMeta.map((c) => [c.id, c]));
  const charNames = new Map(
    (
      db.prepare("SELECT id, name FROM characters").all() as Array<{ id: number; name: string }>
    ).map((c) => [c.id, c.name])
  );

  const concurrency = opts?.concurrency ?? resolveMigrationConcurrency();
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < chatIds.length) {
      const chatId = chatIds[cursor++]!;
      const meta = metaById.get(chatId);
      if (!meta) continue;
      const classified = classifyChatForFiveTurnRebuild(db, chatId);
      if (classified.alreadyCompleted) {
        apply.SKIPPED_COMPLETED += 1;
        continue;
      }
      if (!classified.requiresRebuild) continue;
      const result = await migrateChatSummariesToFiveTurn({
        chatId,
        userId: meta.user_id,
        characterId: meta.character_id,
        charName: charNames.get(meta.character_id) ?? "캐릭터",
      });
      if (result.status === "COMPLETED") {
        apply.MIGRATED_CHATS += 1;
        apply.MIGRATED_BATCHES += result.batchesCompleted;
      } else if (
        result.status === "SOURCE_CHANGED" ||
        result.status === "BLOCKED_STALE_EPOCH"
      ) {
        apply.STALE_REBUILDS_REJECTED += 1;
        apply.BLOCKED_CHATS += 1;
      } else if (result.status.startsWith("BLOCKED_")) {
        apply.BLOCKED_CHATS += 1;
      } else {
        apply.FAILED_CHATS += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  Object.assign(apply, collectApplyVerification(db));
  return { dryRun: dryRunReport, apply };
}

