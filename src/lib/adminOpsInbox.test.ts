import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  listAdminOpsIncidents,
  mergeAdminOpsIncidents,
  projectGithubAutomationIncidents,
} from "@/lib/adminOpsInbox";
import { ADMIN_OPS_STUCK_EXECUTION_MINUTES } from "@/lib/adminOpsInboxShared";
import { ensurePayoutTransferAttemptsSchema } from "@/lib/payoutTransferAttempts";
import { ensurePointChargeRefundAttemptsSchema } from "@/lib/pointChargeRefundAttempts";
import { ensureSchedulerRunRegistrySchema } from "@/lib/schedulerRunRegistry";
import { recordBackgroundProviderCost } from "@/lib/providerCostLedger";

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
  value.exec(`
    CREATE TABLE web_push_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      claim_token TEXT,
      claimed_until TEXT,
      UNIQUE(subscription_id, event_key)
    );
  `);
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


describe("admin ops web push projection", () => {
  it("surfaces repeated failures and exhausted rows without exposing provider errors", () => {
    const database = db();

    database
      .prepare(
        `INSERT INTO web_push_outbox
           (subscription_id, user_id, event_key, payload_json, attempts, last_error)
         VALUES
           (1, 7, 'push:repeat', '{}', 3, 'secret endpoint/provider detail'),
           (2, 8, 'push:exhausted', '{}', 5, 'secret exhausted detail')`
      )
      .run();

    const incidents = listAdminOpsIncidents(database, NOW);
    const repeated = incidents.find((row) => row.id === "web_push:1");
    const exhausted = incidents.find((row) => row.id === "web_push:2");

    assert.equal(repeated?.source, "web_push");
    assert.equal(repeated?.state, "REPEATED_FAILURE");
    assert.equal(repeated?.severity, "warning");
    assert.equal(exhausted?.state, "EXHAUSTED");
    assert.equal(exhausted?.severity, "critical");

    const serialized = JSON.stringify([repeated, exhausted]);
    assert.doesNotMatch(serialized, /secret endpoint\/provider detail/);
    assert.doesNotMatch(serialized, /secret exhausted detail/);

    database.close();
  });

  it("waits for the existing stuck threshold before surfacing an expired claim", () => {
    const database = db();

    database
      .prepare(
        `INSERT INTO web_push_outbox
           (subscription_id, user_id, event_key, payload_json, claim_token, claimed_until)
         VALUES
           (1, 7, 'push:fresh-stale', '{}', 'token-a', '2026-09-23 08:40:01'),
           (2, 8, 'push:stuck-stale', '{}', 'token-b', '2026-09-23 08:30:00')`
      )
      .run();

    const incidents = listAdminOpsIncidents(database, NOW);
    assert.equal(incidents.some((row) => row.id === "web_push:1"), false);

    const stale = incidents.find((row) => row.id === "web_push:2");
    assert.equal(stale?.state, "STALE_CLAIM");
    assert.equal(stale?.severity, "warning");
    assert.equal(stale?.ageMinutes, ADMIN_OPS_STUCK_EXECUTION_MINUTES);

    database.close();
  });

  it("omits sent web push rows even when their attempt count is high", () => {
    const database = db();

    database
      .prepare(
        `INSERT INTO web_push_outbox
           (subscription_id, user_id, event_key, payload_json, attempts, sent_at, last_error)
         VALUES (1, 7, 'push:sent', '{}', 5, '2026-09-23 08:59:00', 'old error')`
      )
      .run();

    const incidents = listAdminOpsIncidents(database, NOW);
    assert.equal(incidents.some((row) => row.id === "web_push:1"), false);

    database.close();
  });
});


describe("admin ops GitHub scheduled automation projection", () => {
  it("surfaces only the latest failed/cancelled scheduled runs", () => {
    const projection = {
      status: "OK" as const,
      error: null,
      groups: [
        {
          key: "Memory Cycle::.github/workflows/memory.yml",
          name: "Memory Cycle",
          path: ".github/workflows/memory.yml",
          latest: {
            id: 101,
            name: "Memory Cycle",
            path: ".github/workflows/memory.yml",
            status: "completed",
            conclusion: "failure",
            runNumber: 12,
            createdAt: "2026-09-23T08:00:00Z",
            updatedAt: "2026-09-23T08:05:00Z",
            htmlUrl: "https://github.com/example/run/101",
          },
          history: [],
        },
        {
          key: "Supply Radar::.github/workflows/supply.yml",
          name: "Supply Radar",
          path: ".github/workflows/supply.yml",
          latest: {
            id: 102,
            name: "Supply Radar",
            path: ".github/workflows/supply.yml",
            status: "completed",
            conclusion: "cancelled",
            runNumber: 22,
            createdAt: "2026-09-23T08:10:00Z",
            updatedAt: "2026-09-23T08:12:00Z",
            htmlUrl: "https://github.com/example/run/102",
          },
          history: [],
        },
        {
          key: "Healthy::.github/workflows/healthy.yml",
          name: "Healthy",
          path: ".github/workflows/healthy.yml",
          latest: {
            id: 103,
            name: "Healthy",
            path: ".github/workflows/healthy.yml",
            status: "completed",
            conclusion: "success",
            runNumber: 7,
            createdAt: "2026-09-23T08:20:00Z",
            updatedAt: "2026-09-23T08:21:00Z",
            htmlUrl: "https://github.com/example/run/103",
          },
          history: [],
        },
      ],
    };

    const incidents = projectGithubAutomationIncidents(projection, NOW);
    const failed = incidents.find((row) => row.id.startsWith("github_automation:Memory Cycle"));
    const cancelled = incidents.find((row) => row.id.startsWith("github_automation:Supply Radar"));

    assert.equal(incidents.length, 2);
    assert.equal(failed?.source, "github_automation");
    assert.equal(failed?.severity, "critical");
    assert.equal(failed?.state, "FAILURE");
    assert.equal(cancelled?.severity, "warning");
    assert.equal(cancelled?.state, "CANCELLED");
    assert.equal(incidents.some((row) => row.title.startsWith("Healthy")), false);
  });

  it("does not invent incidents when the GitHub projection is unavailable", () => {
    assert.deepEqual(
      projectGithubAutomationIncidents({
        status: "UNAVAILABLE",
        error: "GitHub Actions API 403",
        groups: [],
      }, NOW),
      []
    );
  });

  it("merges external incidents through the same canonical severity/age sort", () => {
    const merged = mergeAdminOpsIncidents([
      [{
        id: "warning",
        source: "github_automation",
        severity: "warning",
        state: "CANCELLED",
        title: "warning",
        summary: "",
        sourceRef: "",
        occurredAt: "",
        ageMinutes: 10,
        href: null,
      }],
      [{
        id: "critical",
        source: "scheduler",
        severity: "critical",
        state: "FAILED",
        title: "critical",
        summary: "",
        sourceRef: "",
        occurredAt: "",
        ageMinutes: 1,
        href: null,
      }],
    ]);

    assert.deepEqual(merged.map((row) => row.id), ["critical", "warning"]);
  });
});


describe("admin ops procurement contract watch", () => {
  it("surfaces one read-only quote-review warning from canonical settled spend", () => {
    const database = db();
    recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "fixture-model",
        requestKind: "ops-contract-watch",
        costCenter: "chat_turn",
        providerRequestId: "ops-contract-watch-1",
        inputTokens: 1000,
        outputTokens: 500,
        cheaperInferenceBilledCostUsd: 25_000,
        outcome: "success",
        persistInTests: true,
      },
      database
    );
    database
      .prepare(
        "UPDATE api_cost_ledger SET created_at='2026-09-20 12:00:00' WHERE provider_request_id='ops-contract-watch-1'"
      )
      .run();

    const incidents = listAdminOpsIncidents(database, NOW);
    const contract = incidents.find(
      (row) => row.id === "procurement:openrouter-contract-review"
    );
    assert.ok(contract);
    assert.equal(contract?.source, "procurement");
    assert.equal(contract?.severity, "warning");
    assert.equal(contract?.state, "QUOTE_REVIEW");
    assert.equal(contract?.href, "/admin/pricing");
    assert.match(contract?.summary ?? "", /Enterprise 자격 확정이 아니라/);

    const parallel = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%contract_watch%'"
      )
      .all();
    assert.deepEqual(parallel, []);

    database.close();
  });
});
