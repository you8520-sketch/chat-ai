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
