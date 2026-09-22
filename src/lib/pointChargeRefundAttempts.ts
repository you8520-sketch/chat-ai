import type Database from "better-sqlite3";

export type PointChargeRefundAttemptState =
  | "CLAIMED"
  | "DISPATCHED"
  | "REQUESTED"
  | "SUCCEEDED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";

export type PointChargeRefundAttemptRow = {
  id: number;
  charge_batch_id: number;
  portone_checkout_id: number;
  payment_id: string;
  refund_request_id: string;
  state: PointChargeRefundAttemptState;
  provider_cancellation_id: string;
  provider_status: string;
  failure_code: string;
  failure_message: string;
  claimed_at: string;
  dispatched_at: string | null;
  resolved_at: string | null;
};

export function ensurePointChargeRefundAttemptsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_charge_refund_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      charge_batch_id INTEGER NOT NULL UNIQUE,
      portone_checkout_id INTEGER NOT NULL,
      payment_id TEXT NOT NULL,
      refund_request_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'CLAIMED'
        CHECK(state IN ('CLAIMED','DISPATCHED','REQUESTED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
      provider_cancellation_id TEXT NOT NULL DEFAULT '',
      provider_status TEXT NOT NULL DEFAULT '',
      failure_code TEXT NOT NULL DEFAULT '',
      failure_message TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      dispatched_at TEXT,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_point_charge_refund_attempts_state
      ON point_charge_refund_attempts(state, claimed_at);
    CREATE INDEX IF NOT EXISTS idx_point_charge_refund_attempts_payment
      ON point_charge_refund_attempts(payment_id);
  `);
}

export function stableRefundRequestId(chargeBatchId: number): string {
  return `refund-${chargeBatchId}`;
}

export function getPointChargeRefundAttempt(
  db: Database.Database,
  chargeBatchId: number
): PointChargeRefundAttemptRow | null {
  ensurePointChargeRefundAttemptsSchema(db);
  const row = db
    .prepare(
      `SELECT id, charge_batch_id, portone_checkout_id, payment_id, refund_request_id,
              state, provider_cancellation_id, provider_status, failure_code,
              failure_message, claimed_at, dispatched_at, resolved_at
       FROM point_charge_refund_attempts
       WHERE charge_batch_id = ?`
    )
    .get(chargeBatchId) as PointChargeRefundAttemptRow | undefined;
  return row ?? null;
}

export function insertRefundAttempt(
  db: Database.Database,
  input: {
    chargeBatchId: number;
    portoneCheckoutId: number;
    paymentId: string;
  }
): boolean {
  ensurePointChargeRefundAttemptsSchema(db);
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO point_charge_refund_attempts
         (charge_batch_id, portone_checkout_id, payment_id, refund_request_id, state)
       VALUES (?, ?, ?, ?, 'CLAIMED')`
    )
    .run(
      input.chargeBatchId,
      input.portoneCheckoutId,
      input.paymentId,
      stableRefundRequestId(input.chargeBatchId)
    );
  return Number(result.changes) > 0;
}

export function markRefundAttemptDispatched(
  db: Database.Database,
  chargeBatchId: number
): boolean {
  const result = db
    .prepare(
      `UPDATE point_charge_refund_attempts
       SET state='DISPATCHED', dispatched_at=datetime('now')
       WHERE charge_batch_id=? AND state='CLAIMED'`
    )
    .run(chargeBatchId);
  return Number(result.changes) > 0;
}

export function recordRefundAttemptState(
  db: Database.Database,
  input: {
    chargeBatchId: number;
    state: Extract<
      PointChargeRefundAttemptState,
      "REQUESTED" | "SUCCEEDED" | "FAILED" | "RECONCILIATION_REQUIRED"
    >;
    providerCancellationId?: string;
    providerStatus?: string;
    failureCode?: string;
    failureMessage?: string;
  }
): boolean {
  const result = db
    .prepare(
      `UPDATE point_charge_refund_attempts
       SET state=?,
           provider_cancellation_id=COALESCE(?, provider_cancellation_id),
           provider_status=COALESCE(?, provider_status),
           failure_code=COALESCE(?, failure_code),
           failure_message=COALESCE(?, failure_message),
           resolved_at=CASE WHEN ? IN ('SUCCEEDED','FAILED') THEN datetime('now') ELSE NULL END
       WHERE charge_batch_id=?
         AND state NOT IN ('SUCCEEDED','FAILED')`
    )
    .run(
      input.state,
      input.providerCancellationId ?? null,
      input.providerStatus ?? null,
      input.failureCode ?? null,
      input.failureMessage ?? null,
      input.state,
      input.chargeBatchId
    );
  return Number(result.changes) > 0;
}
