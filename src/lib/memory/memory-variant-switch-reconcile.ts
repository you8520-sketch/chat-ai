/**
 * Phase B1-D2 — Deterministic LTM invalidation after variant switch (LLM=0).
 *
 * Rejected-variant prose must not re-enter canon through rolling summary.
 *
 * `reconcileMemoryAfterVariantSwitchCore(db, …)` is transaction-free and must
 * run inside the caller's BEGIN IMMEDIATE (numeric variant switch).
 *
 * Does NOT call the rolling-summary LLM.
 */
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { invalidateSummarySealBatchEpisodicFactsForSourceMutation } from "@/lib/episodicMemoryFacts";
import { ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import { isMemoryFeatureEnabled } from "./memory-feature";
import { calcUsedChars } from "./memory-used-chars";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import {
  formatMemoryBlock,
  type MemoryRecordRow,
  type MemoryRecordView,
} from "./memory-turn-summary";
import {
  isEmptyOocScope,
  lorebookTextFromScopes,
  normalizeSummaryScope,
  parseScopePayload,
  scopesInjectedIntoPrompt,
  type BranchStatus,
  type MemorySummaryScope,
} from "./memory-summary-scope";
import type { MemoryTier } from "./memory-types";
import {
  getMemorySourceBoundaryCore,
  isMemorySourceEligible,
} from "./memory-source-boundary";
import {
  countMemoryEligibleCompletedTurnsCore,
  resolveMemoryEligibleTurnNumberCore,
} from "./memory-turn-loader";

type Db = Database.Database;

export type VariantSwitchMemoryReconcileResult = {
  attempted: boolean;
  inactivatedRecordIds: number[];
  lorebookRebuilt: boolean;
  summarizedTurnCount: number | null;
};

export type VariantSwitchMemoryReconcileInput = {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  memoryCapacity: number;
  sourceTurn: number;
  sourceUserMessageId?: number | null;
  /** When false, skip entirely (memory feature off). Default: isMemoryFeatureEnabled(). */
  enabled?: boolean;
  /** @internal test-only */
  __testThrowAfterInvalidate?: boolean;
  /** @internal test-only */
  __testThrowAfterRebuild?: boolean;
};

function selectSql(): string {
  return `SELECT id, chat_id, turn_number, assistant_message_id, summary,
              COALESCE(summary_kind, 'narrative') AS summary_kind,
              scope_payload, branch_id, branch_status, promoted_by, promoted_at,
              COALESCE(inactive, 0) AS inactive,
              user_edited, created_at, updated_at
       FROM chat_turn_summaries`;
}

function rowToView(r: MemoryRecordRow): MemoryRecordView {
  const turnStart = r.turn_number;
  const turnEnd = turnStart + ROLLING_SUMMARY_INTERVAL - 1;
  const summaryKind = normalizeSummaryScope(r.summary_kind);
  const payload = parseScopePayload(r.scope_payload);
  const scopes: Partial<Record<MemorySummaryScope, string>> = {
    ...(payload?.scopes ?? {}),
  };
  if (!scopes[summaryKind] && r.summary?.trim() && summaryKind !== "empty_ooc") {
    scopes[summaryKind] = r.summary.trim();
  }
  const branchStatus =
    (r.branch_status as BranchStatus | null) ||
    payload?.branchStatus ||
    null;

  return {
    id: r.id,
    turnStart,
    turnEnd,
    turnRangeLabel: `${turnStart}~${turnEnd}턴`,
    summary: r.summary,
    summaryKind,
    scopeLabel: summaryKind,
    scopes,
    branchId: r.branch_id ?? payload?.branchId ?? null,
    branchStatus,
    promotedBy: r.promoted_by ?? payload?.promotedBy ?? null,
    promotedAt: r.promoted_at ?? payload?.promotedAt ?? null,
    inactive: (r.inactive ?? 0) === 1 || !!payload?.inactive,
    userEdited: r.user_edited === 1,
    charCount: r.summary.length,
    assistantMessageId: r.assistant_message_id ?? null,
  };
}

function listMemoryRecordsForChatDb(db: Db, chatId: number): MemoryRecordView[] {
  const rows = db
    .prepare(`${selectSql()} WHERE chat_id=? ORDER BY turn_number ASC`)
    .all(chatId) as MemoryRecordRow[];
  return rows.map(rowToView);
}

function rebuildLorebookFromRecordsDb(db: Db, chatId: number): string {
  const records = listMemoryRecordsForChatDb(db, chatId).filter((r) => {
    if (r.inactive) return false;
    const text = lorebookTextFromScopes(r.scopes, { branchStatus: r.branchStatus });
    if (!text.trim()) {
      return (
        scopesInjectedIntoPrompt(r.summaryKind) &&
        !(r.summaryKind === "branch_canon" && r.branchStatus === "closed") &&
        !isEmptyOocScope(r.summaryKind) &&
        !!r.summary.trim() &&
        r.summaryKind !== "noncanon"
      );
    }
    return true;
  });
  return records
    .map((r) => {
      const body =
        lorebookTextFromScopes(r.scopes, { branchStatus: r.branchStatus }) ||
        (scopesInjectedIntoPrompt(r.summaryKind) &&
        r.summaryKind !== "noncanon" &&
        !(r.summaryKind === "branch_canon" && r.branchStatus === "closed")
          ? r.summary
          : "");
      if (!body.trim()) return "";
      return formatMemoryBlock(r.turnStart, r.turnEnd, body);
    })
    .filter(Boolean)
    .join("\n\n");
}

function ensureChatMemoryRowDb(
  db: Db,
  chatId: number,
  userId: number,
  characterId: number,
  tier: MemoryTier
): void {
  const existing = db
    .prepare(`SELECT chat_id FROM chat_memories WHERE chat_id=?`)
    .get(chatId) as { chat_id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE chat_memories SET membership_tier=?, updated_at=datetime('now') WHERE chat_id=?`
    ).run(tier, chatId);
    return;
  }
  db.prepare(
    `INSERT INTO chat_memories
      (chat_id, user_id, character_id, recent_summary, archive_summary,
       membership_tier, used_chars, summarized_turn_count)
     VALUES (?,?,?,?,?,?,?,0)`
  ).run(chatId, userId, characterId, "", "", tier, 0);
}

/**
 * Transaction-free LTM suppression core.
 * Outer BEGIN IMMEDIATE owner must call this; nested transactions forbidden.
 */
export function reconcileMemoryAfterVariantSwitchCore(
  db: Db,
  opts: VariantSwitchMemoryReconcileInput
): VariantSwitchMemoryReconcileResult {
  const enabled =
    opts.enabled !== undefined ? opts.enabled : isMemoryFeatureEnabled();
  if (!enabled) {
    return {
      attempted: false,
      inactivatedRecordIds: [],
      lorebookRebuilt: false,
      summarizedTurnCount: null,
    };
  }
  if (!Number.isFinite(opts.sourceTurn) || opts.sourceTurn <= 0) {
    return {
      attempted: false,
      inactivatedRecordIds: [],
      lorebookRebuilt: false,
      summarizedTurnCount: null,
    };
  }
  const boundary = getMemorySourceBoundaryCore(db, opts.chatId);
  if (!isMemorySourceEligible({ sourceUserMessageId: opts.sourceUserMessageId, boundary })) {
    return {
      attempted: false,
      inactivatedRecordIds: [],
      lorebookRebuilt: false,
      summarizedTurnCount: null,
    };
  }
  const memorySourceTurn = opts.sourceUserMessageId
    ? resolveMemoryEligibleTurnNumberCore(db, opts.chatId, opts.sourceUserMessageId)
    : opts.sourceTurn;
  if (memorySourceTurn == null) {
    return {
      attempted: false,
      inactivatedRecordIds: [],
      lorebookRebuilt: false,
      summarizedTurnCount: null,
    };
  }

  ensureChatMemoryRowDb(
    db,
    opts.chatId,
    opts.userId,
    opts.characterId,
    opts.tier
  );

  const records = listMemoryRecordsForChatDb(db, opts.chatId);
  const inactivatedRecordIds: number[] = [];
  for (const r of records) {
    if (r.inactive) continue;
    if (r.userEdited) continue;
    if (r.turnStart <= memorySourceTurn && r.turnEnd >= memorySourceTurn) {
      const info = db
        .prepare(
          `UPDATE chat_turn_summaries SET inactive=1, updated_at=datetime('now')
           WHERE id=? AND chat_id=?`
        )
        .run(r.id, opts.chatId);
      if (Number(info.changes) > 0) {
        inactivatedRecordIds.push(r.id);
      }
    }
  }

  invalidateSummarySealBatchEpisodicFactsForSourceMutation(db, {
    chatId: opts.chatId,
    affectedUserMessageIds:
      opts.sourceUserMessageId != null ? [opts.sourceUserMessageId] : [],
  });

  if (opts.__testThrowAfterInvalidate) {
    throw new Error("TEST_THROW_AFTER_LTM_INVALIDATE");
  }

  const playableTurnCount = countMemoryEligibleCompletedTurnsCore(db, opts.chatId);
  const activeAfter = listMemoryRecordsForChatDb(db, opts.chatId).filter(
    (r) => !r.inactive
  );
  const contiguous = highestContiguousCompletedTurn(
    activeAfter,
    playableTurnCount
  );

  let lorebook = rebuildLorebookFromRecordsDb(db, opts.chatId);
  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
  if (lorebook.length > budget) {
    lorebook = trimLorebookToBudgetSync(lorebook, budget);
  }

  if (opts.__testThrowAfterRebuild) {
    throw new Error("TEST_THROW_AFTER_LTM_REBUILD");
  }

  const mem = db
    .prepare(
      `SELECT archive_summary FROM chat_memories WHERE chat_id=?`
    )
    .get(opts.chatId) as
    | { archive_summary: string }
    | undefined;
  const used = calcUsedChars({
    recent_summary: lorebook,
    archive_summary: mem?.archive_summary ?? "",
  });

  db.prepare(
    `UPDATE chat_memories SET
       recent_summary=?,
       used_chars=?,
       summarized_turn_count=?,
       membership_tier=?,
       updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(lorebook, used, contiguous, opts.tier, opts.chatId);

  console.info(
    `[memory] reconcile after variant switch chat=${opts.chatId} sourceTurn=${memorySourceTurn} inactivated=${inactivatedRecordIds.length} summarized=${contiguous}`
  );

  return {
    attempted: true,
    inactivatedRecordIds,
    lorebookRebuilt: true,
    summarizedTurnCount: contiguous,
  };
}

/**
 * Convenience wrapper for non-txn callers (uses process getDb).
 * Numeric variant switch must NOT use this — call Core inside BEGIN IMMEDIATE.
 */
export function reconcileMemoryAfterVariantSwitch(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  memoryCapacity: number;
  sourceTurn: number;
}): VariantSwitchMemoryReconcileResult {
  return reconcileMemoryAfterVariantSwitchCore(getDb(), {
    ...opts,
    enabled: isMemoryFeatureEnabled(),
  });
}
