import type Database from "better-sqlite3";

export type PayoutAttemptState =
  | "CLAIMED"
  | "DISPATCHED"
  | "SUCCEEDED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";

export type PayoutTransferAttemptRow = {
  id: number;
  withdrawal_id: number;
  provider_request_id: string;
  state: PayoutAttemptState;
  provider_ref: string;
  failure_code: string;
  failure_message: string;
  claimed_at: string;
  dispatched_at: string | null;
  resolved_at: string | null;
};

export function ensurePayoutTransferAttemptsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payout_transfer_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      withdrawal_id INTEGER NOT NULL UNIQUE,
      provider_request_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'CLAIMED'
        CHECK(state IN ('CLAIMED','DISPATCHED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
      provider_ref TEXT NOT NULL DEFAULT '',
      failure_code TEXT NOT NULL DEFAULT '',
      failure_message TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      dispatched_at TEXT,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payout_transfer_attempts_request
      ON payout_transfer_attempts(provider_request_id);
    CREATE INDEX IF NOT EXISTS idx_payout_transfer_attempts_state
      ON payout_transfer_attempts(state, claimed_at);
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
      `SELECT id, withdrawal_id, provider_request_id, state, provider_ref,
              failure_code, failure_message, claimed_at, dispatched_at, resolved_at
       FROM payout_transfer_attempts
       WHERE withdrawal_id = ?`
    )
    .get(withdrawalId) as PayoutTransferAttemptRow | undefined;
  return row ?? null;
}

export function claimTransferAttempt(
  db: Database.Database,
  params: { withdrawalId: number; providerRequestId: string }
): "claimed" | "exists" {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO payout_transfer_attempts
         (withdrawal_id, provider_request_id, state)
       VALUES (?, ?, 'CLAIMED')`
    )
    .run(params.withdrawalId, params.providerRequestId);
  return Number(result.changes) > 0 ? "claimed" : "exists";
}

/**
 * Marks the provider boundary before any external transfer call.
 * Once DISPATCHED, automatic transfer retry is forbidden; recovery must use lookup/reconciliation.
 */
export function markAttemptDispatched(
  db: Database.Database,
  withdrawalId: number
): boolean {
  const updated = db
    .prepare(
      `UPDATE payout_transfer_attempts
       SET state='DISPATCHED', dispatched_at=datetime('now')
       WHERE withdrawal_id=? AND state='CLAIMED'`
    )
    .run(withdrawalId);
  return Number(updated.changes) > 0;
}

export function recordTransferAttemptOutcome(
  db: Database.Database,
  params: {
    withdrawalId: number;
    state: Extract<PayoutAttemptState, "SUCCEEDED" | "FAILED" | "RECONCILIATION_REQUIRED">;
    providerRef?: string;
    failureCode?: string;
    failureMessage?: string;
  }
): void {
  db.prepare(
    `UPDATE payout_transfer_attempts
     SET state = ?,
         provider_ref = COALESCE(?, provider_ref),
         failure_code = COALESCE(?, failure_code),
         failure_message = COALESCE(?, failure_message),
         resolved_at = CASE WHEN ? IN ('SUCCEEDED','FAILED') THEN datetime('now') ELSE NULL END
     WHERE withdrawal_id = ?`
  ).run(
    params.state,
    params.providerRef ?? null,
    params.failureCode ?? null,
    params.failureMessage ?? null,
    params.state,
    params.withdrawalId
  );
}
