import type Database from "better-sqlite3";
import type { PayoutProviderResultClass } from "@/lib/payoutProviderTypes";

export type PayoutTransferAttemptRow = {
  id: number;
  withdrawal_id: number;
  provider_request_id: string;
  result_class: PayoutProviderResultClass;
  provider_ref: string;
  failure_code: string;
  failure_message: string;
  requested_at: string;
  resolved_at: string | null;
};

export function ensurePayoutTransferAttemptsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payout_transfer_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      withdrawal_id INTEGER NOT NULL UNIQUE,
      provider_request_id TEXT NOT NULL UNIQUE,
      result_class TEXT NOT NULL DEFAULT 'pending'
        CHECK(result_class IN ('pending','success','failed','unknown')),
      provider_ref TEXT NOT NULL DEFAULT '',
      failure_code TEXT NOT NULL DEFAULT '',
      failure_message TEXT NOT NULL DEFAULT '',
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payout_transfer_attempts_request
      ON payout_transfer_attempts(provider_request_id);
  `);
}

export function stableProviderRequestId(withdrawalId: number): string {
  return `wd-${withdrawalId}`;
}

export function getTransferAttemptByWithdrawalId(
  db: Database.Database,
  withdrawalId: number
): PayoutTransferAttemptRow | null {
  const row = db
    .prepare(
      `SELECT id, withdrawal_id, provider_request_id, result_class, provider_ref,
              failure_code, failure_message, requested_at, resolved_at
       FROM payout_transfer_attempts
       WHERE withdrawal_id = ?`
    )
    .get(withdrawalId) as PayoutTransferAttemptRow | undefined;
  return row ?? null;
}

export function insertPendingTransferAttempt(
  db: Database.Database,
  params: { withdrawalId: number; providerRequestId: string }
): "inserted" | "exists" {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO payout_transfer_attempts
         (withdrawal_id, provider_request_id, result_class)
       VALUES (?, ?, 'pending')`
    )
    .run(params.withdrawalId, params.providerRequestId);
  return Number(result.changes) > 0 ? "inserted" : "exists";
}

export function recordTransferAttemptOutcome(
  db: Database.Database,
  params: {
    withdrawalId: number;
    resultClass: PayoutProviderResultClass;
    providerRef?: string;
    failureCode?: string;
    failureMessage?: string;
  }
): void {
  db.prepare(
    `UPDATE payout_transfer_attempts
     SET result_class = ?,
         provider_ref = COALESCE(?, provider_ref),
         failure_code = COALESCE(?, failure_code),
         failure_message = COALESCE(?, failure_message),
         resolved_at = CASE WHEN ? IN ('success','failed','unknown') THEN datetime('now') ELSE resolved_at END
     WHERE withdrawal_id = ?`
  ).run(
    params.resultClass,
    params.providerRef ?? null,
    params.failureCode ?? null,
    params.failureMessage ?? null,
    params.resultClass,
    params.withdrawalId
  );
}
