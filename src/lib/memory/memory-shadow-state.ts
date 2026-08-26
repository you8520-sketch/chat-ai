/**
 * In-memory shadow summary state for migration rebuild (no DB side effects).
 */
import type { PersistPendingBranchControlOp } from "./memory-branch-control";
import {
  displaySummaryFromScopes,
  type BranchStatus,
  type MemorySummaryScope,
  type ScopePayloadV1,
} from "./memory-summary-scope";
import type { MemoryRecordView } from "./memory-turn-summary";

export type ShadowBatchSourceMeta = {
  sourceStartUserMessageId: number | null;
  sourceEndUserMessageId: number | null;
  assistantMessageId: number | null;
};

/** Deterministic synthetic row id — unique per turnStart within one chat shadow. */
export function syntheticShadowRecordId(turnStart: number): number {
  return turnStart;
}

export function buildScopePayloadFromShadowRecord(
  record: MemoryRecordView
): ScopePayloadV1 {
  return {
    v: 1,
    scopes: record.scopes,
    branchId: record.branchId,
    branchStatus: record.branchStatus,
    promotedBy: record.promotedBy,
    promotedAt: record.promotedAt,
  };
}

export function listClosedBranchIdsFromRecords(
  records: readonly MemoryRecordView[]
): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    if (
      !record.inactive &&
      record.summaryKind === "branch_canon" &&
      record.branchStatus === "closed" &&
      record.branchId?.trim()
    ) {
      ids.add(record.branchId.trim());
    }
  }
  return [...ids].sort();
}

export function shadowRecordFromComposed(opts: {
  id: number;
  turnStart: number;
  turnEnd: number;
  summaryKind: MemorySummaryScope;
  scopes: ScopePayloadV1["scopes"];
  branchId: string | null;
  branchStatus: BranchStatus | null;
  promotedBy: string | null;
  promotedAt: string | null;
  assistantMessageId: number | null;
  displaySummary?: string;
}): MemoryRecordView {
  const displaySummary =
    opts.displaySummary?.trim() ||
    displaySummaryFromScopes(opts.scopes, opts.summaryKind);
  return {
    id: opts.id,
    turnStart: opts.turnStart,
    turnEnd: opts.turnEnd,
    turnRangeLabel: `${opts.turnStart}~${opts.turnEnd}턴`,
    summary: displaySummary,
    summaryKind: opts.summaryKind,
    scopeLabel: opts.summaryKind,
    scopes: { ...opts.scopes },
    branchId: opts.branchId,
    branchStatus: opts.branchStatus,
    promotedBy: opts.promotedBy,
    promotedAt: opts.promotedAt,
    inactive: false,
    userEdited: false,
    charCount: displaySummary.length,
    assistantMessageId: opts.assistantMessageId,
  };
}

function promoteShadowRecords(
  records: MemoryRecordView[],
  recordIds: readonly number[],
  branchId: string,
  promotedBy: string
): MemoryRecordView[] {
  const idSet = new Set(recordIds);
  const now = new Date().toISOString();
  return records.map((record) => {
    if (!idSet.has(record.id) || record.inactive) return record;
    const scopes = { ...record.scopes };
    const non =
      scopes.noncanon || (record.summaryKind === "noncanon" ? record.summary : "");
    if (non) scopes.branch_canon = non;
    delete scopes.noncanon;
    return {
      ...record,
      summaryKind: "branch_canon",
      scopes,
      branchId,
      branchStatus: "active",
      promotedBy,
      promotedAt: now,
      summary: scopes.branch_canon || record.summary,
    };
  });
}

function closeActiveShadowBranches(
  records: MemoryRecordView[],
  exceptBranchId?: string | null
): MemoryRecordView[] {
  return records.map((record) => {
    if (
      record.inactive ||
      record.summaryKind !== "branch_canon" ||
      record.branchStatus !== "active" ||
      !record.branchId
    ) {
      return record;
    }
    if (exceptBranchId && record.branchId === exceptBranchId) return record;
    return { ...record, branchStatus: "closed" };
  });
}

function reopenShadowBranch(
  records: MemoryRecordView[],
  branchId: string
): MemoryRecordView[] {
  let state = closeActiveShadowBranches(records, branchId);
  state = state.map((record) => {
    if (record.branchId === branchId && record.summaryKind === "branch_canon") {
      return { ...record, branchStatus: "active", inactive: false };
    }
    return record;
  });
  return state;
}

export function applyPendingBranchOpsToShadowRecords(
  records: readonly MemoryRecordView[],
  ops: readonly PersistPendingBranchControlOp[]
): MemoryRecordView[] {
  let state = [...records];
  for (const op of ops) {
    if (op.op === "reopen_branch") {
      state = reopenShadowBranch(state, op.branchId);
    } else if (op.op === "close_active_branches") {
      state = closeActiveShadowBranches(state);
    } else if (op.op === "promote_noncanon_records") {
      state = promoteShadowRecords(state, op.recordIds, op.branchId, op.promotedBy);
    }
  }
  return state;
}

/** Per-chat shadow rebuild state — no global mutable id allocator. */
export class ShadowState {
  private records: MemoryRecordView[] = [];
  private readonly sourceMetaByTurnStart = new Map<number, ShadowBatchSourceMeta>();

  get priorRecords(): readonly MemoryRecordView[] {
    return this.records;
  }

  applyPendingOps(ops: readonly PersistPendingBranchControlOp[]): void {
    this.records = applyPendingBranchOpsToShadowRecords(this.records, ops);
  }

  appendFromComposed(
    batch: { turnStart: number; turnEnd: number },
    composed: {
      summaryKind: MemorySummaryScope;
      scopes: ScopePayloadV1["scopes"];
      branchId: string | null;
      branchStatus: BranchStatus | null;
      promotedBy: string | null;
      promotedAt: string | null;
      displaySummary: string;
    },
    sourceMeta: ShadowBatchSourceMeta
  ): void {
    const shadow = shadowRecordFromComposed({
      id: syntheticShadowRecordId(batch.turnStart),
      turnStart: batch.turnStart,
      turnEnd: batch.turnEnd,
      summaryKind: composed.summaryKind,
      scopes: composed.scopes,
      branchId: composed.branchId,
      branchStatus: composed.branchStatus,
      promotedBy: composed.promotedBy,
      promotedAt: composed.promotedAt,
      assistantMessageId: sourceMeta.assistantMessageId,
      displaySummary: composed.displaySummary,
    });
    this.records = [...this.records, shadow].sort((a, b) => a.turnStart - b.turnStart);
    this.sourceMetaByTurnStart.set(batch.turnStart, sourceMeta);
  }

  finalRecords(): readonly MemoryRecordView[] {
    return this.records;
  }

  sourceMetaFor(turnStart: number): ShadowBatchSourceMeta | undefined {
    return this.sourceMetaByTurnStart.get(turnStart);
  }
}

export type NormalizedShadowRecord = {
  turnStart: number;
  turnEnd: number;
  summaryKind: MemorySummaryScope;
  branchId: string | null;
  branchStatus: BranchStatus | null;
  promotedBy: string | null;
  scopes: ScopePayloadV1["scopes"];
};

export function normalizeShadowRecordForCompare(
  record: MemoryRecordView
): NormalizedShadowRecord {
  return {
    turnStart: record.turnStart,
    turnEnd: record.turnEnd,
    summaryKind: record.summaryKind,
    branchId: record.branchId,
    branchStatus: record.branchStatus,
    promotedBy: record.promotedBy,
    scopes: record.scopes,
  };
}
