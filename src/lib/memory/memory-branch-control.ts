/**
 * Cross-row branch control provenance + last-turn deletion rollback (no LLM, no migration).
 */
import { getDb } from "@/lib/db";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import {
  classifyMemoryTurnScope,
  encodeScopePayload,
  normalizeSummaryScope,
  parseScopePayload,
  type BranchControlMutation,
  type BranchControlMutationPrevious,
  type MemorySummaryScope,
  type ScopePayloadV1,
} from "./memory-summary-scope";

export type BranchControlSource = {
  source: "user_turn" | "ui";
  sourceUserMessageId?: number | null;
  sourceTurn?: number | null;
  sourceBatchStart?: number | null;
};

export type BranchControlRowSnapshot = {
  id: number;
  summaryKind: MemorySummaryScope;
  scopes: Partial<Record<MemorySummaryScope, string>>;
  branchId: string | null;
  branchStatus: "active" | "closed" | null;
  promotedBy: string | null;
  promotedAt: string | null;
  inactive: boolean;
  scopePayloadRaw: string | null;
};

export function snapshotBranchControlPrevious(
  row: BranchControlRowSnapshot
): BranchControlMutationPrevious {
  return {
    summaryKind: row.summaryKind,
    scopes: { ...row.scopes },
    branchId: row.branchId,
    branchStatus: row.branchStatus,
    promotedBy: row.promotedBy,
    promotedAt: row.promotedAt,
  };
}

export function appendBranchControlMutation(
  payload: ScopePayloadV1,
  mutation: BranchControlMutation
): ScopePayloadV1 {
  const prev = payload.branchControlMutations ?? [];
  return {
    ...payload,
    branchControlMutations: [...prev, mutation],
  };
}

export function buildBranchControlMutation(
  action: BranchControlMutation["action"],
  previous: BranchControlMutationPrevious,
  control?: BranchControlSource | null
): BranchControlMutation {
  return {
    action,
    source: control?.source ?? "user_turn",
    sourceUserMessageId: control?.sourceUserMessageId ?? null,
    sourceTurn: control?.sourceTurn ?? null,
    sourceBatchStart: control?.sourceBatchStart ?? null,
    at: new Date().toISOString(),
    previous,
  };
}

function listBranchControlRows(chatId: number): BranchControlRowSnapshot[] {
  const rows = getDb()
    .prepare(
      `SELECT id, summary, summary_kind, scope_payload, branch_id, branch_status,
              promoted_by, promoted_at, COALESCE(inactive,0) AS inactive
       FROM chat_turn_summaries WHERE chat_id=? ORDER BY turn_number ASC`
    )
    .all(chatId) as Array<{
    id: number;
    summary: string;
    summary_kind: string | null;
    scope_payload: string | null;
    branch_id: string | null;
    branch_status: string | null;
    promoted_by: string | null;
    promoted_at: string | null;
    inactive: number;
  }>;

  return rows.map((r) => {
    const summaryKind = normalizeSummaryScope(r.summary_kind);
    const payload = parseScopePayload(r.scope_payload);
    const scopes: Partial<Record<MemorySummaryScope, string>> = {
      ...(payload?.scopes ?? {}),
    };
    if (!scopes[summaryKind] && r.summary?.trim() && summaryKind !== "empty_ooc") {
      scopes[summaryKind] = r.summary.trim();
    }
    return {
      id: r.id,
      summaryKind,
      scopes,
      branchId: r.branch_id ?? payload?.branchId ?? null,
      branchStatus:
        (r.branch_status as "active" | "closed" | null) ||
        payload?.branchStatus ||
        null,
      promotedBy: r.promoted_by ?? payload?.promotedBy ?? null,
      promotedAt: r.promoted_at ?? payload?.promotedAt ?? null,
      inactive: r.inactive === 1,
      scopePayloadRaw: r.scope_payload,
    };
  });
}

function applyPreviousToRow(
  recordId: number,
  chatId: number,
  previous: BranchControlMutationPrevious,
  remainingMutations: BranchControlMutation[]
): void {
  const payload: ScopePayloadV1 = {
    v: 1,
    scopes: { ...previous.scopes },
    branchId: previous.branchId,
    branchStatus: previous.branchStatus,
    promotedBy: previous.promotedBy,
    promotedAt: previous.promotedAt,
    branchControlMutations: remainingMutations,
  };
  const display =
    previous.scopes[previous.summaryKind]?.trim() ||
    previous.scopes.branch_canon ||
    previous.scopes.noncanon ||
    previous.scopes.main_canon ||
    "";
  getDb()
    .prepare(
      `UPDATE chat_turn_summaries SET
        summary_kind=?,
        summary=?,
        scope_payload=?,
        branch_id=?,
        branch_status=?,
        promoted_by=?,
        promoted_at=?,
        updated_at=datetime('now')
       WHERE id=? AND chat_id=?`
    )
    .run(
      previous.summaryKind,
      display,
      encodeScopePayload(payload),
      previous.branchId,
      previous.branchStatus,
      previous.promotedBy,
      previous.promotedAt,
      recordId,
      chatId
    );
}

/**
 * Roll back cross-row branch mutations caused by a deleted user message only.
 * Stack + exact sourceUserMessageId are the source of truth (last-turn delete).
 * Never rolls back source=ui. Does not re-scan surviving raw user text.
 */
export function rollbackBranchControlMutationsForDeletedUserMessage(
  chatId: number,
  deletedUserMessageId: number
): number {
  if (!Number.isFinite(deletedUserMessageId) || deletedUserMessageId <= 0) return 0;

  let rolled = 0;

  for (const row of listBranchControlRows(chatId)) {
    if (row.inactive) continue;
    const parsed = parseScopePayload(row.scopePayloadRaw);
    const mutations = [...(parsed?.branchControlMutations ?? [])];
    if (mutations.length === 0) continue;

    while (mutations.length > 0) {
      const top = mutations[mutations.length - 1]!;
      // Never roll back UI mutations (or anything not owned by the deleted user turn).
      if (top.source !== "user_turn") break;
      if (top.sourceUserMessageId !== deletedUserMessageId) break;

      mutations.pop();
      applyPreviousToRow(row.id, chatId, top.previous, mutations);
      rolled += 1;
    }
  }

  return rolled;
}

export function findBatchControlSource(
  entries: Array<{
    turnIndex: number;
    userMessageId?: number | null;
    turn: { user: string };
  }>,
  kind: "branch_continue" | "branch_close" | "main_adopt",
  opts?: { previousWasNoncanonOrBranch?: boolean }
): { userMessageId: number | null; turnIndex: number } | null {
  for (const e of entries) {
    const cls = classifyMemoryTurnScope(e.turn.user, {
      previousWasNoncanonOrBranch: opts?.previousWasNoncanonOrBranch,
    });
    if (cls === kind) {
      return {
        userMessageId: e.userMessageId ?? null,
        turnIndex: e.turnIndex,
      };
    }
  }
  return null;
}

/** @internal test helper — batch end for a start turn */
export function branchControlBatchEnd(turnStart: number): number {
  return turnStart + ROLLING_SUMMARY_INTERVAL - 1;
}
