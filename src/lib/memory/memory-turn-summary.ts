import { getDb } from "@/lib/db";
import { refreshGlobalMemoryMirrorFromRecords } from "./memory-global-projection";
import {
  resolveRecordSpan,
} from "./memory-summary-range";
import { MEMORY_RECORD_MAX_CHARS, ROLLING_SUMMARY_MIN_CHARS } from "./memory-constants";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import {
  appendBranchControlMutation,
  buildBranchControlMutation,
  snapshotBranchControlPrevious,
  type BranchControlSource,
} from "./memory-branch-control";
import {
  loadMemoryEligibleChatTurnsWithMessageIds,
  loadMemoryEligibleTurnContentsForRanges,
} from "./memory-turn-loader";
import { reconcileSummaryItemRoles } from "./memory-summary-integrity";
import {
  adoptPostManualEditToMain,
  encodeScopePayload,
  historyScopeLabel,
  isEmptyOocScope,
  lorebookTextFromScopes,
  normalizeSummaryScope,
  parseScopePayload,
  promotePostManualEditToBranch,
  readPostManualEdit,
  resolveSummaryRowScopes,
  scopesInjectedIntoPrompt,
  scopesVisibleInHistory,
  type BranchControlMutation,
  type BranchStatus,
  type MemorySummaryScope,
  type PostManualEditView,
  type ScopePayloadV1,
  type SummaryKind,
} from "./memory-summary-scope";

export const MEMORY_RECORD_MIN_CHARS = ROLLING_SUMMARY_MIN_CHARS;
export { MEMORY_RECORD_MAX_CHARS } from "./memory-constants";

export type MemoryRecordRow = {
  id: number;
  chat_id: number;
  turn_number: number;
  turn_end?: number | null;
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
  /** Slice after a user-saved Global's boundary, for a record that straddled it when sealed. */
  postManualEdit?: PostManualEditView | null;
  /** Promote/close/reopen stack already stored on the row. */
  branchControlMutations?: BranchControlMutation[];
};

function clampRecord(text: string, max = MEMORY_RECORD_MAX_CHARS): string {
  return clampMemoryRecordSummary(text, max, ROLLING_SUMMARY_MIN_CHARS);
}

function rowToViewOrNull(r: MemoryRecordRow): MemoryRecordView | null {
  const span = resolveRecordSpan(r);
  if (!span) {
    console.warn(
      `[memory] skipping summary row with invalid span chat=${r.chat_id} turn=${r.turn_number}`
    );
    return null;
  }
  const turnStart = span.turnStart;
  const turnEnd = span.turnEnd;
  const summaryKind = normalizeSummaryScope(r.summary_kind);
  const payload = parseScopePayload(r.scope_payload);
  const scopes = resolveSummaryRowScopes(r, payload);
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
    postManualEdit: readPostManualEdit(payload),
    branchControlMutations: payload?.branchControlMutations,
  };
}

function rowToView(r: MemoryRecordRow): MemoryRecordView {
  const view = rowToViewOrNull(r);
  if (!view) {
    throw new Error(
      `invalid summary span chat=${r.chat_id} turn=${r.turn_number}`
    );
  }
  return view;
}

export function formatTurnRangeLabel(startTurn: number, endTurn: number): string {
  return `${startTurn}~${endTurn}턴`;
}

export function formatMemoryBlock(startTurn: number, endTurn: number, summary: string): string {
  return `[${formatTurnRangeLabel(startTurn, endTurn)}] ${summary.trim()}`;
}

function selectSql(): string {
  return `SELECT id, chat_id, turn_number, turn_end, assistant_message_id, summary,
              COALESCE(summary_kind, 'narrative') AS summary_kind,
              scope_payload, branch_id, branch_status, promoted_by, promoted_at,
              COALESCE(inactive, 0) AS inactive,
              user_edited, created_at, updated_at
       FROM chat_turn_summaries`;
}

/** Canonical prompt-injectible row predicate — Global rebuild + Medium share this owner. */
export function isPromptInjectibleMemoryRecord(record: MemoryRecordView): boolean {
  if (record.inactive) return false;
  const scopedText = lorebookTextFromScopes(record.scopes, { branchStatus: record.branchStatus });
  if (scopedText.trim()) return true;
  return (
    scopesInjectedIntoPrompt(record.summaryKind) &&
    !(record.summaryKind === "branch_canon" && record.branchStatus === "closed") &&
    !isEmptyOocScope(record.summaryKind) &&
    !!record.summary.trim() &&
    record.summaryKind !== "noncanon"
  );
}

/** Canonical injectible body — matches rebuildLorebookFromRecords rendering. */
export function resolvePromptInjectibleMemoryRecordBody(record: MemoryRecordView): string {
  const scopedBody = lorebookTextFromScopes(record.scopes, { branchStatus: record.branchStatus });
  if (scopedBody.trim()) return scopedBody.trim();
  if (
    scopesInjectedIntoPrompt(record.summaryKind) &&
    record.summaryKind !== "noncanon" &&
    !(record.summaryKind === "branch_canon" && record.branchStatus === "closed")
  ) {
    return record.summary.trim();
  }
  return "";
}

export const SUMMARY_ITEM_ROLE_HINT = /계속\s*소유|끼워|끼웠/u;

export type SummaryRoleTurn = {
  turnNumber: number;
  user: string;
  assistant: string;
};

function formatTurnsForItemRoleReconciliation(turns: readonly SummaryRoleTurn[]): string {
  return turns
    .map((turn) => `[${turn.turnNumber}턴]\n유저: ${turn.user}\n캐릭터: ${turn.assistant}`)
    .join("\n\n");
}

/**
 * Read-time correction for a sealed summary body. Stored rows stay unchanged.
 * User-edited text is returned as saved.
 */
export function reconcilePromptMemoryRecordBody(
  record: Pick<MemoryRecordView, "userEdited" | "inactive" | "turnStart" | "turnEnd">,
  body: string,
  turns: readonly SummaryRoleTurn[]
): string {
  if (record.userEdited || record.inactive || !body.trim()) return body;
  if (!SUMMARY_ITEM_ROLE_HINT.test(body)) return body;
  const dialogue = formatTurnsForItemRoleReconciliation(
    turns.filter(
      (turn) => turn.turnNumber >= record.turnStart && turn.turnNumber <= record.turnEnd
    )
  );
  if (!dialogue) return body;
  return reconcileSummaryItemRoles(body, dialogue).text;
}

export type PromptSummaryItemRolePlan =
  | { action: "keep"; reason: "no_hint" | "headerless_global" }
  | { action: "per_block" };

/** Headerless compact prose is not rewritten. A full-dialogue pass would hide one bad sentence by rewriting every other sentence. */
export function planPromptSummaryItemRoleRewrite(text: string): PromptSummaryItemRolePlan {
  if (!text.trim() || !SUMMARY_ITEM_ROLE_HINT.test(text)) {
    return { action: "keep", reason: "no_hint" };
  }
  if (!/\[\d+~\d+턴\]/u.test(text)) return { action: "keep", reason: "headerless_global" };
  return { action: "per_block" };
}

/** Loads source turns only for summary batches whose own text can contain an item-role contradiction. */
export function loadTurnsForSummaryRoleReconciliation(
  chatId: number,
  bodies: readonly string[],
  ranges: readonly { turnStart: number; turnEnd: number }[] = []
): SummaryRoleTurn[] {
  if (ranges.length === 0 || !bodies.some((body) => SUMMARY_ITEM_ROLE_HINT.test(body))) return [];
  try {
    return loadMemoryEligibleTurnContentsForRanges(chatId, ranges).map((turn) => ({
      turnNumber: turn.turnNumber,
      user: turn.user,
      assistant: turn.assistant,
    }));
  } catch {
    return [];
  }
}

/**
 * Prompt-visible lorebook text. Each `[start~end턴]` block is checked against that
 * record's own turns. Prose without those headers is returned unchanged.
 */
export function reconcilePromptVisibleSummaryText(chatId: number, text: string): string {
  if (planPromptSummaryItemRoleRewrite(text).action === "keep") return text;
  let records: MemoryRecordView[] = [];
  try {
    records = listMemoryRecordsForChat(chatId);
  } catch {
    return text;
  }
  const ranges: { turnStart: number; turnEnd: number }[] = [];
  for (const match of text.matchAll(/\[(\d+)~(\d+)턴\] ([^\n]+)/gu)) {
    const turnStart = Number(match[1]);
    const turnEnd = Number(match[2]);
    const body = match[3] ?? "";
    if (!SUMMARY_ITEM_ROLE_HINT.test(body)) continue;
    const record = records.find((row) => row.turnStart === turnStart && row.turnEnd === turnEnd);
    if (record?.userEdited || record?.inactive) continue;
    ranges.push({ turnStart, turnEnd });
  }
  if (ranges.length === 0) return text;
  const turns = loadTurnsForSummaryRoleReconciliation(chatId, [text], ranges);
  if (turns.length === 0) return text;

  return text.replace(
    /\[(\d+)~(\d+)턴\] ([^\n]+)/g,
    (full, startText: string, endText: string, body: string) => {
      const turnStart = Number(startText);
      const turnEnd = Number(endText);
      const record = records.find((row) => row.turnStart === turnStart && row.turnEnd === turnEnd);
      if (record?.userEdited || record?.inactive) return full;
      const reconciled = reconcilePromptMemoryRecordBody(
        { userEdited: false, inactive: false, turnStart, turnEnd },
        body,
        turns
      );
      return reconciled === body ? full : `[${startText}~${endText}턴] ${reconciled}`;
    }
  );
}

export type ManualGlobalMediumDelivery = {
  /** First source turn the delivered text covers: the record start, or the turn after the user's save. */
  deliveredFromTurn: number;
  body: string;
};

/**
 * What Medium delivers of one injectible record while a user-saved Global covers turns 1..manualBoundary.
 * - fully covered record: nothing (the user's text already carries it)
 * - record after the boundary: its full body
 * - record straddling the boundary: only the post-save slice stored at seal time. Never the full batch,
 *   which still carries the pre-save facts the user corrected. A record without a slice (or with a slice
 *   that starts inside the covered range) delivers nothing instead of guessing.
 * - user-edited record: the user's own text is delivered as written.
 */
export function resolveManualGlobalMediumDelivery(
  record: MemoryRecordView,
  manualBoundary: number
): ManualGlobalMediumDelivery | null {
  if (record.turnEnd <= manualBoundary) return null;
  if (record.turnStart > manualBoundary || record.userEdited) {
    const body = resolvePromptInjectibleMemoryRecordBody(record);
    return body ? { deliveredFromTurn: record.turnStart, body } : null;
  }
  const slice = record.postManualEdit;
  if (!slice || slice.fromTurn <= manualBoundary) return null;
  const body = lorebookTextFromScopes(slice.scopes, { branchStatus: record.branchStatus }).trim();
  return body ? { deliveredFromTurn: slice.fromTurn, body } : null;
}

/**
 * Canonical prompt-injectible record list for Global + Medium.
 * Optional RAW cutoff uses turnStart < excludeTurnStartGte (partial overlap preserved).
 */
export function listPromptInjectibleMemoryRecords(
  chatId: number,
  opts?: {
    excludeTurnStartGte?: number;
    /** Drop records that overlap this end boundary (inclusive). */
    excludeTurnEndGte?: number;
    excludeAssistantMessageId?: number | null;
  }
): MemoryRecordView[] {
  let records = listMemoryRecordsForChat(chatId).filter(isPromptInjectibleMemoryRecord);
  const cutoff = opts?.excludeTurnStartGte;
  if (cutoff != null && cutoff > 0) {
    records = records.filter((record) => record.turnStart < cutoff);
  }
  const endCutoff = opts?.excludeTurnEndGte;
  if (endCutoff != null && endCutoff > 0) {
    records = records.filter((record) => record.turnEnd < endCutoff);
  }
  if (opts?.excludeAssistantMessageId != null) {
    records = records.filter(
      (record) => record.assistantMessageId !== opts.excludeAssistantMessageId
    );
  }
  return records;
}

/** Injected lorebook — main_canon + active branch_canon + preference only. */
export function rebuildLorebookFromRecords(
  chatId: number,
  opts?: { excludeTurnStartGte?: number; excludeTurnEndGte?: number }
): string {
  return listPromptInjectibleMemoryRecords(chatId, opts)
    .map((record) => {
      const body = resolvePromptInjectibleMemoryRecordBody(record);
      if (!body) return "";
      return formatMemoryBlock(record.turnStart, record.turnEnd, body);
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

  return rows.map(rowToViewOrNull).filter((view): view is MemoryRecordView => view != null);
}

/** Read-only historical candidates. Never changes Global/Medium's canonical eligibility. */
export function listNoncanonRecallRecords(
  chatId: number,
  opts?: { excludeTurnStartGte?: number }
): Array<{ record: MemoryRecordView; scope: "noncanon" | "closed_branch"; text: string }> {
  return listMemoryRecordsForChat(chatId).flatMap<{ record: MemoryRecordView; scope: "noncanon" | "closed_branch"; text: string }>((record) => {
    if (record.inactive ||
        (opts?.excludeTurnStartGte != null && record.turnEnd >= opts.excludeTurnStartGte)) return [];
    const noncanon = record.scopes.noncanon?.trim();
    const closed = record.branchStatus === "closed" ? record.scopes.branch_canon?.trim() : "";
    return [
      ...(noncanon ? [{ record, scope: "noncanon" as const, text: noncanon }] : []),
      ...(closed ? [{ record, scope: "closed_branch" as const, text: closed }] : []),
    ];
  });
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

export function updateMemoryRecordById(
  chatId: number,
  recordId: number,
  summary: string
): MemoryRecordView | null {
  const text = clampRecord(summary);
  if (!text.trim() || text.length < MEMORY_RECORD_MIN_CHARS) return null;

  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, summary, summary_kind, scope_payload FROM chat_turn_summaries WHERE id=? AND chat_id=?"
    )
    .get(recordId, chatId) as
    | { id: number; summary: string; summary_kind?: string | null; scope_payload?: string | null }
    | undefined;
  if (!row) return null;
  // The edit replaces the text of the scope the user saw. branch_canon / preference records keep their scope
  // (branch lifecycle, closed-branch exclusion and sibling scopes stay intact); promotion to main is the explicit
  // "본편으로 반영" action. Every other kind keeps the existing "user edits become main_canon content" behavior.
  const previousKind = normalizeSummaryScope(row.summary_kind);
  const keepsScope = previousKind === "branch_canon" || previousKind === "preference";
  const nextKind: MemorySummaryScope = keepsScope ? previousKind : "main_canon";
  const payload = parseScopePayload(row.scope_payload);
  let scopePayload = row.scope_payload ?? null;
  if (payload) {
    const scopes = { ...payload.scopes };
    if (!keepsScope && previousKind !== "empty_ooc" && scopes[previousKind]?.trim() === row.summary.trim()) {
      delete scopes[previousKind];
    }
    scopes[nextKind] = text.trim();
    scopePayload = encodeScopePayload({ ...payload, scopes });
  }
  db.prepare(
    `UPDATE chat_turn_summaries SET summary=?, summary_kind=?, scope_payload=?, user_edited=1, updated_at=datetime('now') WHERE id=?`
  ).run(text, nextKind, scopePayload, recordId);

  refreshGlobalMemoryMirrorFromRecords(chatId);

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
  if (info.changes > 0) {
    refreshGlobalMemoryMirrorFromRecords(chatId);
  }
  return info.changes > 0;
}

/**
 * Latest contiguous noncanon group for seal-time promotion (P1-B).
 * Walk live rows newest→oldest: include noncanon; skip preference/empty_ooc;
 * stop at main_canon / branch_canon. Returns ids in chronological order.
 */
export function selectLatestContiguousNoncanonRecordIds(
  priorRecords: Array<{
    id: number;
    turnStart: number;
    summaryKind: MemorySummaryScope;
    inactive: boolean;
  }>
): number[] {
  const live = priorRecords
    .filter((r) => !r.inactive)
    .slice()
    .sort((a, b) => a.turnStart - b.turnStart);

  let started = false;
  const collected: Array<{ id: number; turnStart: number }> = [];

  for (let i = live.length - 1; i >= 0; i--) {
    const r = live[i]!;
    const kind = r.summaryKind;

    if (!started) {
      if (kind === "preference" || kind === "empty_ooc") continue;
      if (kind === "noncanon") {
        started = true;
        collected.push(r);
        continue;
      }
      if (kind === "main_canon" || kind === "branch_canon") {
        return [];
      }
      continue;
    }

    if (kind === "noncanon") {
      collected.push(r);
      continue;
    }
    if (kind === "preference" || kind === "empty_ooc") continue;
    if (kind === "main_canon" || kind === "branch_canon") break;
  }

  collected.reverse();
  return collected.map((r) => r.id);
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
      ...(basePayload.postManualEdit
        ? { postManualEdit: promotePostManualEditToBranch(basePayload.postManualEdit) }
        : {}),
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
  if (n > 0) {
    refreshGlobalMemoryMirrorFromRecords(opts.chatId);
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
export function reopenClosedBranchCanonCore(opts: {
  chatId: number;
  branchId?: string | null;
  recordId?: number | null;
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

  return {
    ok: true,
    branchId: targetBranchId,
    reopenedRowIds,
    closedOtherRowIds,
  };
}

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
  const result = db.transaction(() => reopenClosedBranchCanonCore(opts)).immediate();

  if (opts.source && result.ok) {
    console.info(
      `[memory] reopen branch chat=${opts.chatId} branchId=${result.branchId} source=${opts.source} rows=${result.reopenedRowIds.length} closedOther=${result.closedOtherRowIds.length}`
    );
    refreshGlobalMemoryMirrorFromRecords(opts.chatId);
  }

  return result;
}

function resolveUiCloseControl(
  chatId: number,
  control?: BranchControlSource | null
): BranchControlSource | null | undefined {
  if (control?.source !== "ui") return control;
  const needsTurn = control.sourceTurn == null || control.sourceTurn <= 0;
  const needsMessage =
    control.sourceUserMessageId == null || control.sourceUserMessageId <= 0;
  if (!needsTurn && !needsMessage) return control;
  const turns = loadMemoryEligibleChatTurnsWithMessageIds(chatId);
  const frontier = turns.length > 0 ? turns[turns.length - 1] : undefined;
  if (!frontier) return control;
  return {
    source: "ui",
    sourceBatchStart: control.sourceBatchStart,
    sourceTurn: needsTurn ? frontier.turnNumber : control.sourceTurn,
    sourceUserMessageId: needsMessage
      ? frontier.userMessageId
      : control.sourceUserMessageId,
  };
}

export function closeActiveBranchCanonCore(
  chatId: number,
  control?: BranchControlSource | null
): number {
  const db = getDb();
  const effectiveControl = resolveUiCloseControl(chatId, control);
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
        buildBranchControlMutation("close_branch", previous, effectiveControl)
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

export function closeActiveBranchCanon(
  chatId: number,
  control?: BranchControlSource | null
): number {
  const db = getDb();
  const n = db.transaction(() => closeActiveBranchCanonCore(chatId, control)).immediate();
  if (n > 0) {
    refreshGlobalMemoryMirrorFromRecords(chatId);
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
  const adoptedSlice = adoptPostManualEditToMain(view.postManualEdit ?? undefined);
  const payload: ScopePayloadV1 = {
    v: 1,
    scopes: { main_canon: text, ...view.scopes, branch_canon: undefined, noncanon: undefined },
    branchId: view.branchId,
    branchStatus: "closed",
    promotedBy: opts.promotedBy,
    promotedAt: now,
    ...(adoptedSlice ? { postManualEdit: adoptedSlice } : {}),
  };
  db.prepare(
    `UPDATE chat_turn_summaries SET
      summary_kind='main_canon', summary=?, scope_payload=?,
      branch_status='closed', promoted_by=?, promoted_at=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(text, encodeScopePayload(payload), opts.promotedBy, now, opts.recordId);
  refreshGlobalMemoryMirrorFromRecords(opts.chatId);
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
