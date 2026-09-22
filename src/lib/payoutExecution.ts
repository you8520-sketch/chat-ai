import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { parseAccountInfo, roundCreatorAmount } from "@/lib/creatorShared";
import { getPayoutProviderPort, resolveBankCode } from "@/lib/payoutGateway";
import type { PayoutProviderLookupResult } from "@/lib/payoutProviderTypes";
import {
  ensurePayoutTransferAttemptsSchema,
  getTransferAttemptByWithdrawalId,
  insertPendingTransferAttempt,
  recordTransferAttemptOutcome,
  stableProviderRequestId,
} from "@/lib/payoutTransferAttempts";

export type WithdrawalExecutionRow = {
  id: number;
  user_id: number;
  requested_cp: number;
  payout_amount: number;
  account_info: string;
  status: string;
  provider_request_id: string;
  failure_reason: string;
};

export type SingleWithdrawalOutcome =
  | "approved"
  | "failed"
  | "reconciliation_required"
  | "skipped";

export type PayoutExecutionLog = {
  withdrawalId: number;
  attemptIdentity: string;
  claimTime: string | null;
  providerRequestIdentity: string;
  providerResultClass: string;
  localFinalState: string;
  retryReason: string;
};

function logPayoutExecution(entry: PayoutExecutionLog): void {
  console.log("[payout-execution]", {
    withdrawalId: entry.withdrawalId,
    attemptIdentity: entry.attemptIdentity,
    claimTime: entry.claimTime,
    providerRequestIdentity: entry.providerRequestIdentity,
    providerResultClass: entry.providerResultClass,
    localFinalState: entry.localFinalState,
    retryReason: entry.retryReason,
  });
}

export function listWithdrawalsForExecution(db: Database.Database = getDb()): WithdrawalExecutionRow[] {
  ensurePayoutTransferAttemptsSchema(db);
  return db
    .prepare(
      `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
              COALESCE(provider_request_id, '') AS provider_request_id,
              COALESCE(failure_reason, '') AS failure_reason
       FROM withdrawal_requests
       WHERE status IN ('PENDING', 'PROCESSING', 'RECONCILIATION_REQUIRED')
       ORDER BY created_at ASC, id ASC`
    )
    .all() as WithdrawalExecutionRow[];
}

/** @deprecated Use listWithdrawalsForExecution — kept for tests importing listPendingWithdrawals. */
export function listPendingWithdrawals(): WithdrawalExecutionRow[] {
  return getDb()
    .prepare(
      `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
              COALESCE(provider_request_id, '') AS provider_request_id,
              COALESCE(failure_reason, '') AS failure_reason
       FROM withdrawal_requests
       WHERE status = 'PENDING'
       ORDER BY created_at ASC, id ASC`
    )
    .all() as WithdrawalExecutionRow[];
}

export function atomicClaimWithdrawal(
  db: Database.Database,
  withdrawalId: number
): { claimed: boolean; providerRequestId: string } {
  const providerRequestId = stableProviderRequestId(withdrawalId);
  const updated = db
    .prepare(
      `UPDATE withdrawal_requests
       SET status = 'PROCESSING',
           provider_request_id = CASE
             WHEN provider_request_id IS NULL OR provider_request_id = '' THEN ?
             ELSE provider_request_id
           END,
           claimed_at = datetime('now')
       WHERE id = ? AND status = 'PENDING'`
    )
    .run(providerRequestId, withdrawalId);
  if (Number(updated.changes) === 0) {
    const row = db
      .prepare(
        `SELECT provider_request_id FROM withdrawal_requests WHERE id = ?`
      )
      .get(withdrawalId) as { provider_request_id: string } | undefined;
    return {
      claimed: false,
      providerRequestId: row?.provider_request_id || providerRequestId,
    };
  }
  return { claimed: true, providerRequestId };
}

function finalizeApproved(
  db: Database.Database,
  withdrawalId: number,
  providerRef: string
): void {
  const updated = db
    .prepare(
      `UPDATE withdrawal_requests
       SET status = 'APPROVED', processed_at = datetime('now'), provider_ref = ?
       WHERE id = ? AND status IN ('PROCESSING', 'RECONCILIATION_REQUIRED')`
    )
    .run(providerRef, withdrawalId);
  if (updated.changes === 0) {
    throw new Error(`출금 #${withdrawalId} 승인 확정 실패 (이미 처리됨)`);
  }
}

function finalizeFailedWithRollback(
  db: Database.Database,
  withdrawalId: number,
  userId: number,
  requestedCp: number,
  reason: string
): void {
  const cp = roundCreatorAmount(requestedCp);
  db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE withdrawal_requests
         SET status = 'FAILED', failure_reason = ?, processed_at = datetime('now')
         WHERE id = ? AND status IN ('PROCESSING', 'RECONCILIATION_REQUIRED')`
      )
      .run(reason.slice(0, 500), withdrawalId);
    if (updated.changes === 0) {
      throw new Error(`출금 #${withdrawalId} 실패 처리 불가 (이미 처리됨)`);
    }

    db.prepare("UPDATE users SET creator_points = ROUND(creator_points + ?, 1) WHERE id=?").run(
      cp,
      userId
    );

    db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      userId,
      cp,
      `출금 실패 CP 복구 #${withdrawalId} (${reason})`
    );
  })();
}

function markReconciliationRequired(
  db: Database.Database,
  withdrawalId: number,
  reason: string
): void {
  const updated = db
    .prepare(
      `UPDATE withdrawal_requests
       SET status = 'RECONCILIATION_REQUIRED',
           failure_reason = ?,
           processed_at = NULL
       WHERE id = ? AND status = 'PROCESSING'`
    )
    .run(reason.slice(0, 500), withdrawalId);
  if (updated.changes === 0) {
    throw new Error(`출금 #${withdrawalId} reconciliation 상태 전환 실패`);
  }
}

async function reconcileFromProviderLookup(
  db: Database.Database,
  row: WithdrawalExecutionRow,
  lookup: PayoutProviderLookupResult
): Promise<SingleWithdrawalOutcome> {
  switch (lookup.status) {
    case "success":
      recordTransferAttemptOutcome(db, {
        withdrawalId: row.id,
        resultClass: "success",
        providerRef: lookup.providerRef,
      });
      finalizeApproved(db, row.id, lookup.providerRef);
      logPayoutExecution({
        withdrawalId: row.id,
        attemptIdentity: stableProviderRequestId(row.id),
        claimTime: null,
        providerRequestIdentity: row.provider_request_id || stableProviderRequestId(row.id),
        providerResultClass: "success",
        localFinalState: "APPROVED",
        retryReason: "reconciliation_lookup_success",
      });
      return "approved";
    case "failed":
      recordTransferAttemptOutcome(db, {
        withdrawalId: row.id,
        resultClass: "failed",
        failureCode: lookup.code,
        failureMessage: lookup.message,
      });
      finalizeFailedWithRollback(db, row.id, row.user_id, row.requested_cp, lookup.message);
      logPayoutExecution({
        withdrawalId: row.id,
        attemptIdentity: stableProviderRequestId(row.id),
        claimTime: null,
        providerRequestIdentity: row.provider_request_id || stableProviderRequestId(row.id),
        providerResultClass: "failed",
        localFinalState: "FAILED",
        retryReason: "reconciliation_lookup_failed",
      });
      return "failed";
    case "unknown":
    case "pending":
    case "not_found":
      return "reconciliation_required";
    default: {
      const _exhaustive: never = lookup;
      return _exhaustive;
    }
  }
}

async function executeProviderTransfer(
  db: Database.Database,
  row: WithdrawalExecutionRow,
  providerRequestId: string
): Promise<SingleWithdrawalOutcome> {
  const account = parseAccountInfo(row.account_info);
  if (!account) {
    finalizeFailedWithRollback(db, row.id, row.user_id, row.requested_cp, "계좌 정보 파싱 실패");
    return "failed";
  }

  const bankCode = resolveBankCode(account.bankName);
  if (!bankCode) {
    finalizeFailedWithRollback(
      db,
      row.id,
      row.user_id,
      row.requested_cp,
      `미지원 은행: ${account.bankName}`
    );
    return "failed";
  }

  const attempt = getTransferAttemptByWithdrawalId(db, row.id);
  if (attempt?.result_class === "success" && attempt.provider_ref) {
    finalizeApproved(db, row.id, attempt.provider_ref);
    return "approved";
  }
  if (attempt?.result_class === "failed") {
    finalizeFailedWithRollback(
      db,
      row.id,
      row.user_id,
      row.requested_cp,
      attempt.failure_message || "provider confirmed failure"
    );
    return "failed";
  }
  if (attempt?.result_class === "unknown") {
    markReconciliationRequired(
      db,
      row.id,
      attempt.failure_message || "provider outcome unknown"
    );
    return "reconciliation_required";
  }

  insertPendingTransferAttempt(db, {
    withdrawalId: row.id,
    providerRequestId,
  });

  const provider = getPayoutProviderPort();
  const result = await provider.transfer({
    bankCode,
    accountNo: account.accountNumber,
    amount: row.payout_amount,
    idempotencyKey: providerRequestId,
    withdrawalId: row.id,
  });

  if (result.resultClass === "success") {
    recordTransferAttemptOutcome(db, {
      withdrawalId: row.id,
      resultClass: "success",
      providerRef: result.providerRef,
    });
    finalizeApproved(db, row.id, result.providerRef);
    logPayoutExecution({
      withdrawalId: row.id,
      attemptIdentity: providerRequestId,
      claimTime: new Date().toISOString(),
      providerRequestIdentity: providerRequestId,
      providerResultClass: "success",
      localFinalState: "APPROVED",
      retryReason: result.deduplicated ? "provider_deduplicated" : "provider_success",
    });
    return "approved";
  }

  if (result.resultClass === "failed") {
    recordTransferAttemptOutcome(db, {
      withdrawalId: row.id,
      resultClass: "failed",
      failureCode: result.code,
      failureMessage: result.message,
    });
    finalizeFailedWithRollback(db, row.id, row.user_id, row.requested_cp, result.message);
    logPayoutExecution({
      withdrawalId: row.id,
      attemptIdentity: providerRequestId,
      claimTime: new Date().toISOString(),
      providerRequestIdentity: providerRequestId,
      providerResultClass: "failed",
      localFinalState: "FAILED",
      retryReason: result.deduplicated ? "provider_deduplicated_failure" : "provider_failed",
    });
    return "failed";
  }

  recordTransferAttemptOutcome(db, {
    withdrawalId: row.id,
    resultClass: result.resultClass,
    failureCode: result.code,
    failureMessage: result.message,
  });
  markReconciliationRequired(db, row.id, result.message);
  logPayoutExecution({
    withdrawalId: row.id,
    attemptIdentity: providerRequestId,
    claimTime: new Date().toISOString(),
    providerRequestIdentity: providerRequestId,
    providerResultClass: result.resultClass,
    localFinalState: "RECONCILIATION_REQUIRED",
    retryReason: "unknown_outcome_no_auto_resend_no_rollback",
  });
  return "reconciliation_required";
}

/**
 * Canonical single-withdrawal execution owner.
 * Scheduled cron, manual script, and future admin retry must call this.
 */
export async function executeWithdrawalPayout(
  row: WithdrawalExecutionRow,
  db: Database.Database = getDb()
): Promise<SingleWithdrawalOutcome> {
  ensurePayoutTransferAttemptsSchema(db);

  if (row.status === "APPROVED" || row.status === "FAILED" || row.status === "REJECTED") {
    throw new Error(`출금 #${row.id} 상태 갱신 실패 (이미 처리됨)`);
  }

  if (row.status === "RECONCILIATION_REQUIRED") {
    const providerRequestId = row.provider_request_id || stableProviderRequestId(row.id);
    const lookup = await getPayoutProviderPort().lookup(providerRequestId);
    return reconcileFromProviderLookup(db, row, lookup);
  }

  let providerRequestId = row.provider_request_id || stableProviderRequestId(row.id);

  if (row.status === "PENDING") {
    const claim = atomicClaimWithdrawal(db, row.id);
    if (!claim.claimed) {
      return "skipped";
    }
    providerRequestId = claim.providerRequestId;
  } else if (row.status === "PROCESSING") {
    providerRequestId = row.provider_request_id || stableProviderRequestId(row.id);
  }

  return executeProviderTransfer(db, { ...row, status: "PROCESSING", provider_request_id: providerRequestId }, providerRequestId);
}

/** @deprecated Alias — use executeWithdrawalPayout. */
export async function processSingleWithdrawal(
  row: WithdrawalExecutionRow
): Promise<"approved" | "failed"> {
  const outcome = await executeWithdrawalPayout(row);
  switch (outcome) {
    case "approved":
    case "failed":
      return outcome;
    case "reconciliation_required":
      throw new Error(`출금 #${row.id} reconciliation required — no auto resend`);
    case "skipped":
      throw new Error(`출금 #${row.id} skipped — lost claim or already processing`);
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}
