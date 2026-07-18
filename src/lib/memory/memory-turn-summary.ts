import { getDb } from "@/lib/db";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import {
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_MIN_CHARS,
} from "./memory-constants";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import {
  appendBranchControlMutation,
  buildBranchControlMutation,
  snapshotBranchControlPrevious,
  type BranchControlSource,
} from "./memory-branch-control";
import {
  encodeScopePayload,
  historyScopeLabel,
  isEmptyOocScope,
  lorebookTextFromScopes,
  normalizeSummaryScope,
  parseScopePayload,
  scopesInjectedIntoPrompt,
  scopesVisibleInHistory,
  type BranchStatus,
  type MemorySummaryScope,
  type ScopePayloadV1,
  type SummaryKind,
} from "./memory-summary-scope";

export const MEMORY_RECORD_MIN_CHARS = ROLLING_SUMMARY_MIN_CHARS;
export const MEMORY_RECORD_MAX_CHARS = ROLLING_SUMMARY_MAX_CHARS;

export type MemoryRecordRow = {
  id: number;
  chat_id: number;
  turn_number: number;
  assistant_message_id: number | null;
  summary: string;
  summary_kind?: string | null;
  scope_payload?: string | null;
  branch_id?: string | null;
  branch_status?: string | null;
  promoted_by?: string | null;
  promoted_at?: string | null;
  inactive?: number | null;
  user_edited: number;
  created_at: string;
  updated_at: string;
};

export type MemoryRecordView = {
  id: number;
  turnStart: number;
  turnEnd: number;
  turnRangeLabel: string;
  summary: string;
  summaryKind: MemorySummaryScope;
  /** Legacy alias — true when empty_ooc */
  summaryKindLegacy?: SummaryKind;
  scopeLabel: string;
  scopes: Partial<Record<MemorySummaryScope, string>>;
  branchId: string | null;
  branchStatus: BranchStatus | null;
  promotedBy: string | null;
  promotedAt: string | null;
  inactive: boolean;
  userEdited: boolean;
  charCount: number;
  assistantMessageId: number | null;
};

function clampRecord(text: string, max = MEMORY_RECORD_MAX_CHARS): string {
  return clampMemoryRecordSummary(text, max, ROLLING_SUMMARY_MIN_CHARS);
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
    turnRangeLabel: formatTurnRangeLabel(turnStart, turnEnd),
    summary: r.summary,
    summaryKind,
    scopeLabel: historyScopeLabel(
      branchStatus === "active" && scopes.branch_canon
        ? "branch_canon"
        : summaryKind
    ),
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

export function formatTurnRangeLabel(startTurn: number, endTurn: number): string {
  return `${startTurn}~${endTurn}턴`;
}

export function formatMemoryBlock(startTurn: number, endTurn: number, summary: string): string {
  return `[${formatTurnRangeLabel(startTurn, endTurn)}] ${summary.trim()}`;
}

function selectSql(): string {
  return `SELECT id, chat_id, turn_number, assistant_message_id, summary,
              COALESCE(summary_kind, 'narrative') AS summary_kind,
              scope_payload, branch_id, branch_status, promoted_by, promoted_at,
              COALESCE(inactive, 0) AS inactive,
              user_edited, created_at, updated_at
       FROM chat_turn_summaries`;
}

/** Injected lorebook — main_canon + active branch_canon + preference only. */
export function rebuildLorebookFromRecords(
  chatId: number,
  opts?: { excludeTurnStartGte?: number }
): string {
  let records = listMemoryRecordsForChat(chatId).filter((r) => {
    if (r.inactive) return false;
    const text = lorebookTextFromScopes(r.scopes, { branchStatus: r.branchStatus });
    if (!text.trim()) {
      // Legacy single-field rows
      return scopesInjectedIntoPrompt(r.summaryKind) &&
        !(r.summaryKind === "branch_canon" && r.branchStatus === "closed") &&
        !isEmptyOocScope(r.summaryKind) &&
        !!r.summary.trim() &&
        r.summaryKind !== "noncanon";
    }
    return true;
  });
  const cutoff = opts?.excludeTurnStartGte;
  if (cutoff != null && cutoff > 0) {
    records = records.filter((r) => r.turnEnd < cutoff);
  }
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

/** Rows shown in memory history UI (hides empty_ooc by default). */
export function listVisibleMemoryRecordsForChat(chatId: number): MemoryRecordView[] {
  return listMemoryRecordsForChat(chatId).filter(
    (r) => !r.inactive && scopesVisibleInHistory(r.summaryKind)
  );
}

export function listMemoryRecordsForChat(chatId: number): MemoryRecordView[] {
  const rows = getDb()
    .prepare(`${selectSql()} WHERE chat_id=? ORDER BY turn_number ASC`)
    .all(chatId) as MemoryRecordRow[];

  return rows.map(rowToView);
}

/** @deprecated listMemoryRecordsForChat 사용 */
export function listTurnSummariesForChat(chatId: number): {
  id: number;
  turnNumber: number;
  summary: string;
  userEdited: boolean;
  charCount: number;
}[] {
  return listVisibleMemoryRecordsForChat(chatId).map((r) => ({
    id: r.id,
    turnNumber: r.turnStart,
    summary: r.summary,
    userEdited: r.userEdited,
    charCount: r.charCount,
  }));
}

export async function upsertMemoryRecord(opts: {
  chatId: number;
  turnStart: number;
  assistantMessageId: number | null;
  summary: string;
  userEdited?: boolean;
  summaryKind?: SummaryKind | MemorySummaryScope;
  scopePayload?: ScopePayloadV1 | null;
  branchId?: string | null;
  branchStatus?: BranchStatus | null;
  promotedBy?: string | null;
  promotedAt?: string | null;
  inactive?: boolean;
}): Promise<MemoryRecordView> {
  const kind = normalizeSummaryScope(opts.summaryKind);
  const summary = kind === "empty_ooc" ? opts.summary.trim() : clampRecord(opts.summary);
  const payloadJson = opts.scopePayload ? encodeScopePayload(opts.scopePayload) : null;
  const db = getDb();
  const existing = db
    .prepare("SELECT id, summary_kind FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?")
    .get(opts.chatId, opts.turnStart) as { id: number; summary_kind?: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE chat_turn_summaries SET
        summary=?, summary_kind=?, assistant_message_id=COALESCE(?, assistant_message_id),
        scope_payload=COALESCE(?, scope_payload),
        branch_id=COALESCE(?, branch_id),
        branch_status=COALESCE(?, branch_status),
        promoted_by=COALESCE(?, promoted_by),
        promoted_at=COALESCE(?, promoted_at),
        inactive=COALESCE(?, inactive),
        user_edited=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(
      summary,
      kind,
      opts.assistantMessageId,
      payloadJson,
      opts.branchId ?? null,
      opts.branchStatus ?? null,
      opts.promotedBy ?? null,
      opts.promotedAt ?? null,
      opts.inactive == null ? null : opts.inactive ? 1 : 0,
      opts.userEdited ? 1 : 0,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO chat_turn_summaries
        (chat_id, turn_number, assistant_message_id, summary, summary_kind, user_edited,
         scope_payload, branch_id, branch_status, promoted_by, promoted_at, inactive)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      opts.chatId,
      opts.turnStart,
      opts.assistantMessageId,
      summary,
      kind,
      opts.userEdited ? 1 : 0,
      payloadJson,
      opts.branchId ?? null,
      opts.branchStatus ?? null,
      opts.promotedBy ?? null,
      opts.promotedAt ?? null,
      opts.inactive ? 1 : 0
    );
  }

  const row = db
    .prepare(`${selectSql()} WHERE chat_id=? AND turn_number=?`)
    .get(opts.chatId, opts.turnStart) as MemoryRecordRow;

  return rowToView(row);
}

export function updateMemoryRecordById(
  chatId: number,
  recordId: number,
  summary: string
): MemoryRecordView | null {
  const text = clampRecord(summary);
  if (!text.trim() || text.length < MEMORY_RECORD_MIN_CHARS) return null;

  const db = getDb();
  const row = db
    .prepare("SELECT id, turn_number, summary_kind FROM chat_turn_summaries WHERE id=? AND chat_id=?")
    .get(recordId, chatId) as { id: number; turn_number: number; summary_kind?: string } | undefined;
  if (!row) return null;
  // User edits become main_canon content
  db.prepare(
    `UPDATE chat_turn_summaries SET summary=?, summary_kind='main_canon', user_edited=1, updated_at=datetime('now') WHERE id=?`
  ).run(text, recordId);

  const updated = db
    .prepare(`${selectSql()} WHERE id=?`)
    .get(recordId) as MemoryRecordRow;

  return rowToView(updated);
}

/** Soft-delete derived summary when source messages are removed. */
export function markMemoryRecordInactive(chatId: number, recordId: number): boolean {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE chat_turn_summaries SET inactive=1, updated_at=datetime('now') WHERE id=? AND chat_id=?`
    )
    .run(recordId, chatId);
  return info.changes > 0;
}

/** Promote noncanon row(s) to branch_canon (current chat only). */
export function promoteRecordsToBranchCanon(opts: {
  chatId: number;
  recordIds: number[];
  branchId: string;
  promotedBy: string;
  control?: BranchControlSource | null;
}): number {
  const db = getDb();
  const now = new Date().toISOString();
  let n = 0;
  for (const id of opts.recordIds) {
    const row = db
      .prepare(`${selectSql()} WHERE id=? AND chat_id=?`)
      .get(id, opts.chatId) as MemoryRecordRow | undefined;
    if (!row || (row.inactive ?? 0) === 1) continue;
    const view = rowToView(row);
    const previous = snapshotBranchControlPrevious({
      id: view.id,
      summaryKind: view.summaryKind,
      scopes: view.scopes,
      branchId: view.branchId,
      branchStatus: view.branchStatus,
      promotedBy: view.promotedBy,
      promotedAt: view.promotedAt,
      inactive: view.inactive,
      scopePayloadRaw: row.scope_payload ?? null,
    });
    const scopes = { ...view.scopes };
    const non = scopes.noncanon || (view.summaryKind === "noncanon" ? view.summary : "");
    if (non) scopes.branch_canon = non;
    delete scopes.noncanon;
    const basePayload = parseScopePayload(row.scope_payload) ?? {
      v: 1 as const,
      scopes: view.scopes,
      branchControlMutations: [],
    };
    let payload: ScopePayloadV1 = {
      ...basePayload,
      v: 1,
      scopes,
      branchId: opts.branchId,
      branchStatus: "active",
      promotedBy: opts.promotedBy,
      promotedAt: now,
    };
    if (
      opts.control &&
      (opts.control.source === "ui" ||
        (opts.control.sourceUserMessageId != null &&
          opts.control.sourceUserMessageId > 0))
    ) {
      payload = appendBranchControlMutation(
        payload,
        buildBranchControlMutation("promote_branch", previous, opts.control)
      );
    }
    db.prepare(
      `UPDATE chat_turn_summaries SET
        summary_kind='branch_canon',
        summary=?,
        scope_payload=?,
        branch_id=?,
        branch_status='active',
        promoted_by=?,
        promoted_at=?,
        updated_at=datetime('now')
       WHERE id=?`
    ).run(
      scopes.branch_canon || view.summary,
      encodeScopePayload(payload),
      opts.branchId,
      opts.promotedBy,
      now,
      id
    );
    n++;
  }
  return n;
}

/**
 * Distinct active branch_id count (same branch_id across rows = one branch).
 * Invariant: <= 1 after reopen / single-active policy enforcement.
 */
export function countDistinctActiveBranchIds(chatId: number): number {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT branch_id AS branch_id FROM chat_turn_summaries
       WHERE chat_id=? AND summary_kind='branch_canon'
         AND COALESCE(branch_status,'active')='active'
         AND COALESCE(inactive,0)=0
         AND branch_id IS NOT NULL AND TRIM(branch_id) != ''`
    )
    .all(chatId) as Array<{ branch_id: string }>;
  return rows.length;
}

/** Distinct closed branch_id values (inactive excluded). */
export function listDistinctClosedBranchIds(chatId: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT branch_id AS branch_id FROM chat_turn_summaries
       WHERE chat_id=? AND summary_kind='branch_canon'
         AND COALESCE(branch_status,'active')='closed'
         AND COALESCE(inactive,0)=0
         AND branch_id IS NOT NULL AND TRIM(branch_id) != ''
       ORDER BY branch_id ASC`
    )
    .all(chatId) as Array<{ branch_id: string }>;
  return rows.map((r) => r.branch_id);
}

export { isExplicitClosedBranchContinueIntent } from "./memory-summary-scope";

/**
 * Deterministic sole-closed continue reopen gate (no LLM / no scene-dialogue guess).
 * Returns the sole closed branch_id, or null when ambiguous / not applicable.
 * hasContinueIntent must come from isExplicitClosedBranchContinueIntent.
 */
export function resolveSoleClosedContinueReopen(opts: {
  hasActiveBranch: boolean;
  hasNoncanonCandidate: boolean;
  closedBranchIds: string[];
  hasContinueIntent: boolean;
}): string | null {
  if (opts.hasActiveBranch || opts.hasNoncanonCandidate) return null;
  if (!opts.hasContinueIntent) return null;
  if (opts.closedBranchIds.length !== 1) return null;
  return opts.closedBranchIds[0] ?? null;
}

/** Close every active branch_canon except keepBranchId (no deletion-stack provenance). */
export function closeActiveBranchesExcept(chatId: number, keepBranchId: string): number {
  const keep = keepBranchId.trim();
  if (!keep) return 0;
  const rows = getDb()
    .prepare(
      `${selectSql()} WHERE chat_id=? AND summary_kind='branch_canon'
         AND COALESCE(branch_status,'active')='active'
         AND COALESCE(inactive,0)=0
         AND (branch_id IS NULL OR branch_id != ?)`
    )
    .all(chatId, keep) as MemoryRecordRow[];
  for (const row of rows) {
    setRowBranchStatusOnly(chatId, row, "closed");
  }
  return rows.length;
}

function setRowBranchStatusOnly(
  chatId: number,
  row: MemoryRecordRow,
  nextStatus: BranchStatus
): void {
  const view = rowToView(row);
  const basePayload = parseScopePayload(row.scope_payload) ?? {
    v: 1 as const,
    scopes: view.scopes,
  };
  const payload: ScopePayloadV1 = {
    ...basePayload,
    v: 1,
    scopes: view.scopes,
    branchId: view.branchId,
    branchStatus: nextStatus,
    promotedBy: view.promotedBy,
    promotedAt: view.promotedAt,
    // Preserve deletion-rollback stack; do not append reopen/close provenance here.
    branchControlMutations: basePayload.branchControlMutations,
  };
  getDb()
    .prepare(
      `UPDATE chat_turn_summaries SET
        branch_status=?,
        scope_payload=?,
        updated_at=datetime('now')
       WHERE id=? AND chat_id=?`
    )
    .run(nextStatus, encodeScopePayload(payload), row.id, chatId);
}

export type ReopenClosedBranchResult =
  | {
      ok: true;
      branchId: string;
      reopenedRowIds: number[];
      closedOtherRowIds: number[];
    }
  | { ok: false; reason: string };

/**
 * Reopen a closed branch_canon by branch_id (or resolve from recordId).
 * Single-active policy: other active branches are closed first.
 * Preserves branch_id / scopes / promoted_* ; no new branch_id; no LLM.
 *
 * user_turn control (seal auto-reopen): appends reopen_branch provenance for
 * each closed→active row so last-turn delete can restore prior closed.
 * UI reopen: omit control or use source=ui without user_turn stack entries.
 */
export function reopenClosedBranchCanon(opts: {
  chatId: number;
  branchId?: string | null;
  recordId?: number | null;
  /** Log-only label; not persisted to schema. */
  source?: string;
  /** When source=user_turn with message id, records reopen_branch mutations. */
  control?: BranchControlSource | null;
}): ReopenClosedBranchResult {
  const db = getDb();
  let targetBranchId = (opts.branchId ?? "").trim();

  if (!targetBranchId && opts.recordId != null && opts.recordId > 0) {
    const row = db
      .prepare(`${selectSql()} WHERE id=? AND chat_id=?`)
      .get(opts.recordId, opts.chatId) as MemoryRecordRow | undefined;
    if (!row || (row.inactive ?? 0) === 1) {
      return { ok: false, reason: "RECORD_NOT_FOUND" };
    }
    const view = rowToView(row);
    if (view.summaryKind !== "branch_canon") {
      return { ok: false, reason: "NOT_BRANCH_CANON" };
    }
    targetBranchId = (view.branchId ?? "").trim();
  }

  if (!targetBranchId) {
    return { ok: false, reason: "MISSING_BRANCH_ID" };
  }

  const targetRows = db
    .prepare(
      `${selectSql()} WHERE chat_id=? AND summary_kind='branch_canon'
         AND branch_id=? AND COALESCE(inactive,0)=0`
    )
    .all(opts.chatId, targetBranchId) as MemoryRecordRow[];

  if (targetRows.length === 0) {
    return { ok: false, reason: "BRANCH_NOT_FOUND" };
  }

  const recordUserTurnProvenance =
    opts.control?.source === "user_turn" &&
    opts.control.sourceUserMessageId != null &&
    opts.control.sourceUserMessageId > 0;

  const closedOtherRowIds: number[] = [];
  const reopenedRowIds: number[] = [];

  const run = db.transaction(() => {
    const beforeClose = db
      .prepare(
        `SELECT id FROM chat_turn_summaries
         WHERE chat_id=? AND summary_kind='branch_canon'
           AND COALESCE(branch_status,'active')='active'
           AND COALESCE(inactive,0)=0
           AND (branch_id IS NULL OR branch_id != ?)`
      )
      .all(opts.chatId, targetBranchId) as Array<{ id: number }>;
    closeActiveBranchesExcept(opts.chatId, targetBranchId);
    for (const r of beforeClose) closedOtherRowIds.push(r.id);

    for (const row of targetRows) {
      const view = rowToView(row);
      const wasClosed = view.branchStatus !== "active";
      if (!wasClosed) {
        reopenedRowIds.push(row.id);
        continue;
      }

      if (recordUserTurnProvenance) {
        const previous = snapshotBranchControlPrevious({
          id: view.id,
          summaryKind: view.summaryKind,
          scopes: view.scopes,
          branchId: view.branchId,
          branchStatus: view.branchStatus,
          promotedBy: view.promotedBy,
          promotedAt: view.promotedAt,
          inactive: view.inactive,
          scopePayloadRaw: row.scope_payload ?? null,
        });
        const basePayload = parseScopePayload(row.scope_payload) ?? {
          v: 1 as const,
          scopes: view.scopes,
          branchControlMutations: [],
        };
        const payload = appendBranchControlMutation(
          {
            ...basePayload,
            v: 1,
            scopes: view.scopes,
            branchId: view.branchId,
            branchStatus: "active",
            promotedBy: view.promotedBy,
            promotedAt: view.promotedAt,
          },
          buildBranchControlMutation("reopen_branch", previous, opts.control)
        );
        db.prepare(
          `UPDATE chat_turn_summaries SET
            branch_status='active',
            scope_payload=?,
            updated_at=datetime('now')
           WHERE id=? AND chat_id=?`
        ).run(encodeScopePayload(payload), row.id, opts.chatId);
      } else {
        setRowBranchStatusOnly(opts.chatId, row, "active");
      }
      reopenedRowIds.push(row.id);
    }
  });

  run();

  if (opts.source) {
    console.info(
      `[memory] reopen branch chat=${opts.chatId} branchId=${targetBranchId} source=${opts.source} rows=${reopenedRowIds.length} closedOther=${closedOtherRowIds.length}`
    );
  }

  return {
    ok: true,
    branchId: targetBranchId,
    reopenedRowIds,
    closedOtherRowIds,
  };
}

export function closeActiveBranchCanon(
  chatId: number,
  control?: BranchControlSource | null
): number {
  const db = getDb();
  const rows = db
    .prepare(
      `${selectSql()} WHERE chat_id=? AND summary_kind='branch_canon'
         AND COALESCE(branch_status,'active')='active' AND COALESCE(inactive,0)=0`
    )
    .all(chatId) as MemoryRecordRow[];
  let n = 0;
  for (const row of rows) {
    const view = rowToView(row);
    const previous = snapshotBranchControlPrevious({
      id: view.id,
      summaryKind: view.summaryKind,
      scopes: view.scopes,
      branchId: view.branchId,
      branchStatus: view.branchStatus,
      promotedBy: view.promotedBy,
      promotedAt: view.promotedAt,
      inactive: view.inactive,
      scopePayloadRaw: row.scope_payload ?? null,
    });
    const basePayload = parseScopePayload(row.scope_payload) ?? {
      v: 1 as const,
      scopes: view.scopes,
      branchControlMutations: [],
    };
    let payload: ScopePayloadV1 = {
      ...basePayload,
      v: 1,
      scopes: view.scopes,
      branchId: view.branchId,
      branchStatus: "closed",
      promotedBy: view.promotedBy,
      promotedAt: view.promotedAt,
    };
    if (
      control &&
      (control.source === "ui" ||
        (control.sourceUserMessageId != null && control.sourceUserMessageId > 0))
    ) {
      payload = appendBranchControlMutation(
        payload,
        buildBranchControlMutation("close_branch", previous, control)
      );
    }
    db.prepare(
      `UPDATE chat_turn_summaries SET
        branch_status='closed',
        scope_payload=?,
        updated_at=datetime('now')
       WHERE id=? AND chat_id=?`
    ).run(encodeScopePayload(payload), row.id, chatId);
    n++;
  }
  return n;
}

export function adoptBranchToMainCanon(opts: {
  chatId: number;
  recordId: number;
  promotedBy: string;
}): boolean {
  const db = getDb();
  const row = db
    .prepare(`${selectSql()} WHERE id=? AND chat_id=?`)
    .get(opts.recordId, opts.chatId) as MemoryRecordRow | undefined;
  if (!row) return false;
  const view = rowToView(row);
  const text =
    view.scopes.branch_canon ||
    view.scopes.noncanon ||
    view.summary;
  const now = new Date().toISOString();
  const payload: ScopePayloadV1 = {
    v: 1,
    scopes: { main_canon: text, ...view.scopes, branch_canon: undefined, noncanon: undefined },
    branchId: view.branchId,
    branchStatus: "closed",
    promotedBy: opts.promotedBy,
    promotedAt: now,
  };
  db.prepare(
    `UPDATE chat_turn_summaries SET
      summary_kind='main_canon', summary=?, scope_payload=?,
      branch_status='closed', promoted_by=?, promoted_at=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(text, encodeScopePayload(payload), opts.promotedBy, now, opts.recordId);
  return true;
}

/** @deprecated updateMemoryRecordById 사용 */
export function updateTurnSummaryById(chatId: number, summaryId: number, summary: string) {
  const updated = updateMemoryRecordById(chatId, summaryId, summary);
  if (!updated) return null;
  return {
    id: updated.id,
    turnNumber: updated.turnStart,
    summary: updated.summary,
    userEdited: updated.userEdited,
    assistantMessageId: null as number | null,
    charCount: updated.charCount,
  };
}

export function clearMemoryRecordsForChat(chatId: number): void {
  getDb().prepare(`DELETE FROM chat_turn_summaries WHERE chat_id=?`).run(chatId);
}

/** @deprecated clearMemoryRecordsForChat(chatId) 사용 */
export function clearTurnSummariesForChat(chatId: number): void {
  clearMemoryRecordsForChat(chatId);
}

export { loadChatTurnsWithMessageIds, countChatTurns } from "./memory-turn-loader";
