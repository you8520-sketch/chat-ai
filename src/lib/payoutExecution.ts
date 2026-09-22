import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { parseAccountInfo, roundCreatorAmount } from "@/lib/creatorShared";
import { getPayoutProviderPort, resolveBankCode } from "@/lib/payoutGateway";
import type { PayoutProviderLookupResult } from "@/lib/payoutProviderTypes";
import {
  claimTransferAttempt,
  ensurePayoutTransferAttemptsSchema,
  getTransferAttemptByWithdrawalId,
  markAttemptDispatched,
  recordTransferAttemptOutcome,
  stableProviderRequestId,
  type PayoutTransferAttemptRow,
} from "@/lib/payoutTransferAttempts";

export type WithdrawalExecutionRow = {
  id: number;
  user_id: number;
  requested_cp: number;
  payout_amount: number;
  account_info: string;
  status: string;
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
  providerRequestIdentity: string;
  providerResultClass: string;
  localFinalState: string;
  retryReason: string;
};

function logPayoutExecution(entry: PayoutExecutionLog): void {
  console.log("[payout-execution]", {
    withdrawalId: entry.withdrawalId,
    attemptIdentity: entry.attemptIdentity,
    providerRequestIdentity: entry.providerRequestIdentity,
    providerResultClass: entry.providerResultClass,
    localFinalState: entry.localFinalState,
    retryReason: entry.retryReason,
  });
}

export function listWithdrawalsForExecution(
  db: Database.Database = getDb()
): WithdrawalExecutionRow[] {
  ensurePayoutTransferAttemptsSchema(db);
  return db
    .prepare(
      `SELECT id, user_id, requested_cp, payout_amount, account_info, status,
              COALESCE(failure_reason, '') AS failure_reason
       FROM withdrawal_requests
       WHERE status = 'PENDING'
       ORDER BY created_at ASC, id ASC`
    )
    .all() as WithdrawalExecutionRow[];
}

/** @deprecated Use listWithdrawalsForExecution. */
export function listPendingWithdrawals(): WithdrawalExecutionRow[] {
  return listWithdrawalsForExecution();
}

/**
 * Atomic payout execution claim.
 * The canonical execution lock lives in payout_transfer_attempts, not withdrawal_requests.status.
 */
export function atomicClaimWithdrawal(
  db: Database.Database,
  withdrawalId: number
): { claimed: boolean; providerRequestId: string } {
  ensurePayoutTransferAttemptsSchema(db);
  const providerRequestId = stableProviderRequestId(withdrawalId);
  const result = claimTransferAttempt(db, { withdrawalId, providerRequestId });
  const existing = getTransferAttemptByWithdrawalId(db, withdrawalId);
  return {
    claimed: result === "claimed",
    providerRequestId: existing?.provider_request_id || providerRequestId,
  };
}

function finalizeApproved(
  db: Database.Database,
  withdrawalId: number,
  providerRef: string
): void {
  const updated = db
    .prepare(
      `UPDATE withdrawal_requests
       SET status = 'APPROVED',
           processed_at = datetime('now'),
           provider_ref = ?,
           failure_reason = ''
       WHERE id = ? AND status = 'PENDING'`
    )
    .run(providerRef, withdrawalId);
  if (updated.changes === 0) {
    const current = db
      .prepare("SELECT status FROM withdrawal_requests WHERE id=?")
      .get(withdrawalId) as { status: string } | undefined;
    if (current?.status === "APPROVED") return;
    throw new Error(`출금 #${withdrawalId} 승인 확정 실패 (현재 상태: ${current?.status ?? "missing"})`);
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
         WHERE id = ? AND status = 'PENDING'`
      )
      .run(reason.slice(0, 500), withdrawalId);

    if (updated.changes === 0) {
      const current = db
        .prepare("SELECT status FROM withdrawal_requests WHERE id=?")
        .get(withdrawalId) as { status: string } | undefined;
      if (current?.status === "FAILED") return;
      throw new Error(
        `출금 #${withdrawalId} 실패 처리 불가 (현재 상태: ${current?.status ?? "missing"})`
      );
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
  reason: string,
  code = "UNKNOWN_OUTCOME"
): void {
  recordTransferAttemptOutcome(db, {
    withdrawalId,
    state: "RECONCILIATION_REQUIRED",
    failureCode: code,
    failureMessage: reason,
  });
}

async function reconcileFromProviderLookup(
  db: Database.Database,
  row: WithdrawalExecutionRow,
  attempt: PayoutTransferAttemptRow,
  lookup: PayoutProviderLookupResult
): Promise<SingleWithdrawalOutcome> {
  switch (lookup.status) {
    case "success":
      recordTransferAttemptOutcome(db, {
        withdrawalId: row.id,
        state: "SUCCEEDED",
        providerRef: lookup.providerRef,
      });
      finalizeApproved(db, row.id, lookup.providerRef);
      logPayoutExecution({
        withdrawalId: row.id,
        attemptIdentity: attempt.provider_request_id,
        providerRequestIdentity: attempt.provider_request_id,
        providerResultClass: "success",
        localFinalState: "APPROVED",
        retryReason: "reconciliation_lookup_success",
      });
      return "approved";

    case "failed":
      recordTransferAttemptOutcome(db, {
        withdrawalId: row.id,
        state: "FAILED",
        failureCode: lookup.code,
        failureMessage: lookup.message,
      });
      finalizeFailedWithRollback(db, row.id, row.user_id, row.requested_cp, lookup.message);
      logPayoutExecution({
        withdrawalId: row.id,
        attemptIdentity: attempt.provider_request_id,
        providerRequestIdentity: attempt.provider_request_id,
        providerResultClass: "failed",
        localFinalState: "FAILED",
        retryReason: "reconciliation_lookup_failed",
      });
      return "failed";

    case "unknown":
    case "pending":
    case "not_found":
      markReconciliationRequired(
        db,
        row.id,
        `provider lookup unresolved: ${lookup.status}`,
        `LOOKUP_${lookup.status.toUpperCase()}`
      );
      return "reconciliation_required";

    default: {
      const _exhaustive: never = lookup;
      return _exhaustive;
    }
  }
}

async function executeClaimedAttempt(
  db: Database.Database,
  row: WithdrawalExecutionRow,
  attempt: PayoutTransferAttemptRow
): Promise<SingleWithdrawalOutcome> {
  const account = parseAccountInfo(row.account_info);
  if (!account) {
    recordTransferAttemptOutcome(db, {
      withdrawalId: row.id,
      state: "FAILED",
      failureCode: "INVALID_ACCOUNT_INFO",
      failureMessage: "계좌 정보 파싱 실패",
    });
    finalizeFailedWithRollback(db, row.id, row.user_id, row.requested_cp, "계좌 정보 파싱 실패");
    return "failed";
  }

  const bankCode = resolveBankCode(account.bankName);
  if (!bankCode) {
    const reason = `미지원 은행: ${account.bankName}`;
    recordTransferAttemptOutcome(db, {
      withdrawalId: row.id,
      state: "FAILED",
      failureCode: "UNSUPPORTED_BANK",
      failureMessage: reason,
    });
    finalizeFailedWithRollback(db, row.id, row.user_id, row.requested_cp, reason);
    return "failed";
  }

  if (!markAttemptDispatched(db, row.id)) {
    return "skipped";
  }

  const provider = getPayoutProviderPort();
  let result;
  try {
    result = await provider.transfer({
      bankCode,
      accountNo: account.accountNumber,
      amount: row.payout_amount,
      idempotencyKey: attempt.provider_request_id,
      withdrawalId: row.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markReconciliationRequired(db, row.id, message || "provider transfer threw", "PROVIDER_THROW");
    logPayoutExecution({
      withdrawalId: row.id,
      attemptIdentity: attempt.provider_request_id,
      providerRequestIdentity: attempt.provider_request_id,
      providerResultClass: "unknown",
      localFinalState: "RECONCILIATION_REQUIRED",
      retryReason: "provider_throw_after_dispatch_no_resend",
    });
    return "reconciliation_required";
  }

  if (result.resultClass === "success") {
    recordTransferAttemptOutcome(db, {
      withdrawalId: row.id,
      state: "SUCCEEDED",
      providerRef: result.providerRef,
    });
    finalizeApproved(db, row.id, result.providerRef);
    logPayoutExecution({
      withdrawalId: row.id,
      attemptIdentity: attempt.provider_request_id,
      providerRequestIdentity: attempt.provider_request_id,
      providerResultClass: "success",
      localFinalState: "APPROVED",
      retryReason: result.deduplicated ? "provider_deduplicated" : "provider_success",
    });
    return "approved";
  }

  if (result.resultClass === "failed") {
    recordTransferAttemptOutcome(db, {
      withdrawalId: row.id,
      state: "FAILED",
      failureCode: result.code,
      failureMessage: result.message,
    });
    finalizeFailedWithRollback(db, row.id, row.user_id, row.requested_cp, result.message);
    logPayoutExecution({
      withdrawalId: row.id,
      attemptIdentity: attempt.provider_request_id,
      providerRequestIdentity: attempt.provider_request_id,
      providerResultClass: "failed",
      localFinalState: "FAILED",
      retryReason: result.deduplicated ? "provider_deduplicated_failure" : "provider_failed",
    });
    return "failed";
  }

  markReconciliationRequired(db, row.id, result.message, result.code);
  logPayoutExecution({
    withdrawalId: row.id,
    attemptIdentity: attempt.provider_request_id,
    providerRequestIdentity: attempt.provider_request_id,
    providerResultClass: result.resultClass,
    localFinalState: "RECONCILIATION_REQUIRED",
    retryReason: "unknown_outcome_no_auto_resend_no_rollback",
  });
  return "reconciliation_required";
}

/**
 * Canonical single-withdrawal execution owner.
 * Scheduled cron, manual script, and future admin retry must call this.
 *
 * Safety invariant:
 * - CLAIMED means provider dispatch has not started and may be resumed.
 * - DISPATCHED/RECONCILIATION_REQUIRED never call transfer() again automatically.
 * - Recovery after DISPATCHED is lookup/reconciliation only.
 */
export async function executeWithdrawalPayout(
  row: WithdrawalExecutionRow,
  db: Database.Database = getDb()
): Promise<SingleWithdrawalOutcome> {
  ensurePayoutTransferAttemptsSchema(db);

  if (row.status !== "PENDING") {
    throw new Error(`출금 #${row.id} 상태 갱신 실패 (현재 상태: ${row.status})`);
  }

  let attempt = getTransferAttemptByWithdrawalId(db, row.id);
  if (!attempt) {
    const claim = atomicClaimWithdrawal(db, row.id);
    attempt = getTransferAttemptByWithdrawalId(db, row.id);
    if (!attempt) throw new Error(`출금 #${row.id} payout attempt claim missing`);
    if (!claim.claimed && attempt.state === "CLAIMED") {
      return "skipped";
    }
  }

  switch (attempt.state) {
    case "SUCCEEDED":
      if (!attempt.provider_ref) {
        markReconciliationRequired(db, row.id, "success attempt missing provider ref", "MISSING_REF");
        return "reconciliation_required";
      }
      finalizeApproved(db, row.id, attempt.provider_ref);
      return "approved";

    case "FAILED":
      finalizeFailedWithRollback(
        db,
        row.id,
        row.user_id,
        row.requested_cp,
        attempt.failure_message || "provider confirmed failure"
      );
      return "failed";

    case "DISPATCHED":
    case "RECONCILIATION_REQUIRED": {
      const lookup = await getPayoutProviderPort().lookup(attempt.provider_request_id);
      return reconcileFromProviderLookup(db, row, attempt, lookup);
    }

    case "CLAIMED":
      return executeClaimedAttempt(db, row, attempt);

    default: {
      const _exhaustive: never = attempt.state;
      return _exhaustive;
    }
  }
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
      throw new Error(`출금 #${row.id} skipped — another worker owns the attempt`);
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}
