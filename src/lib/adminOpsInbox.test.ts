import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { listAdminOpsIncidents } from "@/lib/adminOpsInbox";
import { ADMIN_OPS_STUCK_EXECUTION_MINUTES } from "@/lib/adminOpsInboxShared";
import { ensurePayoutTransferAttemptsSchema } from "@/lib/payoutTransferAttempts";
import { ensurePointChargeRefundAttemptsSchema } from "@/lib/pointChargeRefundAttempts";
import { ensureSchedulerRunRegistrySchema } from "@/lib/schedulerRunRegistry";

process.env.DISABLE_PAYOUT_SCHEDULER = "1";
process.env.DISABLE_TRAINING_PIPELINE = "1";
delete process.env.ENABLE_TRAINING_PIPELINE;
delete process.env.DISABLE_FINANCE_SCHEDULER;

const NOW = new Date("2026-09-23T09:00:00.000Z");

function db(): Database.Database {
  const value = new Database(":memory:");
  ensurePayoutTransferAttemptsSchema(value);
  ensurePointChargeRefundAttemptsSchema(value);
  ensureSchedulerRunRegistrySchema(value);
  value
    .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-01 00:00:00' WHERE id=1")
    .run();
  return value;
}

describe("admin ops inbox projection", () => {
  it("projects canonical exception states without creating a parallel incident table", () => {
    const database = db();

    database
      .prepare(
        `INSERT INTO scheduler_run_slots
           (job_name, slot_key, status, trigger_kind, execution_token, attempt_count,
            started_at, heartbeat_at, finished_at, last_error, result_json)
         VALUES ('finance_daily','2026-09-23','FAILED','cron','token',1,
                 '2026-09-23 03:00:00','2026-09-23 03:01:00','2026-09-23 03:01:00',
                 'finance fixture failed','')`
      )
      .run();

    database
      .prepare(
        `INSERT INTO payout_transfer_attempts
           (withdrawal_id, provider_request_id, state, failure_code, failure_message, claimed_at)
         VALUES (11,'secret-provider-request','RECONCILIATION_REQUIRED','LOOKUP_UNKNOWN',
                 'provider unresolved','2026-09-23 08:55:00')`
      )
      .run();

    database
      .prepare(
        `INSERT INTO point_charge_refund_attempts
           (charge_batch_id, portone_checkout_id, payment_id, refund_request_id, state,
            failure_code, failure_message, claimed_at)
         VALUES (22,33,'secret-payment-id','refund-22','RECONCILIATION_REQUIRED',
                 'PORTONE_LOOKUP_UNKNOWN','refund unresolved','2026-09-23 08:58:00')`
      )
      .run();

    const incidents = listAdminOpsIncidents(database, NOW);
    assert.ok(incidents.some((row) => row.id === "scheduler:finance_daily:2026-09-23"));
    assert.ok(incidents.some((row) => row.id === "payout:11"));
    assert.ok(incidents.some((row) => row.id === "point_refund:22"));

    const serialized = JSON.stringify(incidents);
    assert.doesNotMatch(serialized, /secret-provider-request/);
    assert.doesNotMatch(serialized, /secret-payment-id/);

    const parallel = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'admin_ops%'"
      )
      .all();
    assert.deepEqual(parallel, []);

    database.close();
  });

  it("does not alert transient execution states before the observability threshold", () => {
    const database = db();

    database
      .prepare(
        `INSERT INTO payout_transfer_attempts
           (withdrawal_id, provider_request_id, state, claimed_at, dispatched_at)
         VALUES (31,'wd-31','DISPATCHED','2026-09-23 08:40:01','2026-09-23 08:40:01')`
      )
      .run();
    database
      .prepare(
        `INSERT INTO point_charge_refund_attempts
           (charge_batch_id, portone_checkout_id, payment_id, refund_request_id, state,
            claimed_at, dispatched_at)
         VALUES (32,132,'pay-32','refund-32','REQUESTED',
                 '2026-09-23 08:40:01','2026-09-23 08:40:01')`
      )
      .run();

    const incidents = listAdminOpsIncidents(database, NOW);
    assert.equal(incidents.some((row) => row.id === "payout:31"), false);
    assert.equal(incidents.some((row) => row.id === "point_refund:32"), false);
    assert.equal(ADMIN_OPS_STUCK_EXECUTION_MINUTES, 30);

    database.close();
  });

  it("surfaces stuck CLAIMED/DISPATCHED/REQUESTED states at the threshold", () => {
    const database = db();

    database
      .prepare(
        `INSERT INTO payout_transfer_attempts
           (withdrawal_id, provider_request_id, state, claimed_at)
         VALUES (41,'wd-41','CLAIMED','2026-09-23 08:30:00')`
      )
      .run();
    database
      .prepare(
        `INSERT INTO payout_transfer_attempts
           (withdrawal_id, provider_request_id, state, claimed_at, dispatched_at)
         VALUES (42,'wd-42','DISPATCHED','2026-09-23 08:20:00','2026-09-23 08:30:00')`
      )
      .run();
    database
      .prepare(
        `INSERT INTO point_charge_refund_attempts
           (charge_batch_id, portone_checkout_id, payment_id, refund_request_id, state,
            claimed_at, dispatched_at)
         VALUES (43,143,'pay-43','refund-43','REQUESTED',
                 '2026-09-23 08:20:00','2026-09-23 08:30:00')`
      )
      .run();

    const incidents = listAdminOpsIncidents(database, NOW);
    assert.equal(incidents.find((row) => row.id === "payout:41")?.severity, "warning");
    assert.equal(incidents.find((row) => row.id === "payout:42")?.severity, "critical");
    assert.equal(incidents.find((row) => row.id === "point_refund:43")?.severity, "warning");

    database.close();
  });

  it("omits terminal success/failure rows owned by their source systems", () => {
    const database = db();

    database
      .prepare(
        `INSERT INTO payout_transfer_attempts
           (withdrawal_id, provider_request_id, state, claimed_at, resolved_at)
         VALUES (51,'wd-51','SUCCEEDED','2026-09-23 07:00:00','2026-09-23 07:01:00')`
      )
      .run();
    database
      .prepare(
        `INSERT INTO point_charge_refund_attempts
           (charge_batch_id, portone_checkout_id, payment_id, refund_request_id, state,
            claimed_at, resolved_at)
         VALUES (52,152,'pay-52','refund-52','FAILED',
                 '2026-09-23 07:00:00','2026-09-23 07:01:00')`
      )
      .run();

    const incidents = listAdminOpsIncidents(database, NOW);
    assert.equal(incidents.some((row) => row.id === "payout:51"), false);
    assert.equal(incidents.some((row) => row.id === "point_refund:52"), false);

    database.close();
  });
});
