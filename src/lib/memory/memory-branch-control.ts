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
import { loadChatTurnsWithMessageIds } from "./memory-turn-loader";

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

function survivingHasBranchContinue(chatId: number): boolean {
  const turns = loadChatTurnsWithMessageIds(chatId).filter((t) => t.turnNumber > 0);
  const hasPriorBranchOrNoncanon = listBranchControlRows(chatId).some(
    (r) =>
      !r.inactive &&
      (r.summaryKind === "noncanon" ||
        r.summaryKind === "branch_canon" ||
        !!r.scopes.noncanon ||
        !!r.scopes.branch_canon)
  );
  for (const t of turns) {
    const cls = classifyMemoryTurnScope(t.user, {
      previousWasNoncanonOrBranch: hasPriorBranchOrNoncanon,
    });
    if (cls === "branch_continue") return true;
  }
  return false;
}

function survivingHasBranchClose(chatId: number): boolean {
  for (const t of loadChatTurnsWithMessageIds(chatId)) {
    if (t.turnNumber <= 0) continue;
    if (classifyMemoryTurnScope(t.user) === "branch_close") return true;
  }
  return false;
}

function survivingHasMainAdopt(chatId: number): boolean {
  for (const t of loadChatTurnsWithMessageIds(chatId)) {
    if (t.turnNumber <= 0) continue;
    if (classifyMemoryTurnScope(t.user) === "main_adopt") return true;
  }
  return false;
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
 * Never rolls back source=ui. Respects surviving continue/close commands.
 */
export function rollbackBranchControlMutationsForDeletedUserMessage(
  chatId: number,
  deletedUserMessageId: number
): number {
  if (!Number.isFinite(deletedUserMessageId) || deletedUserMessageId <= 0) return 0;

  let rolled = 0;
  const keepContinue = survivingHasBranchContinue(chatId);
  const keepClose = survivingHasBranchClose(chatId);
  const keepAdopt = survivingHasMainAdopt(chatId);

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

      // Surviving commands keep the effective branch outcome.
      // reopen_branch uses exact provenance only — do not gate on other surviving resume text.
      if (top.action === "promote_branch" && keepContinue) break;
      if (top.action === "close_branch" && (keepClose || keepAdopt)) break;

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
