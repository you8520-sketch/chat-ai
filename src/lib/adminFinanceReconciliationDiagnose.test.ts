import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { buildAdminFinanceSummary } from "@/lib/adminFinance";
import {
  RECONCILIATION_ROOT_CAUSE_UNCONFIRMED,
  assertReconciliationDiagnosisSafePayload,
  diagnoseProviderReconciliationLinkage,
} from "@/lib/adminFinanceReconciliationDiagnose";
import {
  ensureProviderCostLedgerSchema,
  recordMainGenerationProviderCost,
} from "@/lib/providerCostLedger";
import {
  ensureProviderReconciliationStateTable,
  readProviderReconciliationState,
} from "@/lib/providerCostReconciliation";

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', request_id TEXT, usage TEXT, deduction_slices TEXT,
      model TEXT NOT NULL DEFAULT '', alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0, generation_status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), is_refunded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE point_gifts (id INTEGER PRIMARY KEY, paid_fee_amount REAL NOT NULL DEFAULT 0,
      free_fee_amount REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE creator_earnings (id INTEGER PRIMARY KEY, reward_amount REAL NOT NULL DEFAULT 0,
      reversed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE withdrawal_requests (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 0,
      requested_cp REAL NOT NULL DEFAULT 0, tax_amount REAL NOT NULL DEFAULT 0,
      platform_fee REAL NOT NULL DEFAULT 0, payout_amount REAL NOT NULL DEFAULT 0,
      account_info TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING',
      processed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE portone_checkouts (id INTEGER PRIMARY KEY, amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', paid_at TEXT);
    CREATE TABLE chat_image_generations (id INTEGER PRIMARY KEY, upstream_cost_usd REAL,
      deduction_slices TEXT, exchange_rate_krw_per_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  ensureProviderCostLedgerSchema(d);
  return d;
}

function insertIdentity(
  d: Database.Database,
  opts: { id: number; requestId: string; createdAt: string }
): void {
  d.prepare(
    `INSERT INTO messages (id, chat_id, role, content, usage, created_at)
     VALUES (?, 1, 'assistant', 'ok', ?, ?)`
  ).run(
    opts.id,
    JSON.stringify({
      stages: [
        {
          stage: "main",
          providerRequestId: opts.requestId,
          model: "deepseek-v4-pro-0813",
        },
      ],
    }),
    opts.createdAt
  );
}

function insertLedgerRow(
  d: Database.Database,
  opts: {
    createdAt: string;
    source: string | null;
    status: string | null;
    actualUsd: number | null;
    providerRequestId: string | null;
    provider?: string;
  }
): void {
  d.prepare(
    `INSERT INTO api_cost_ledger (
       provider, model, request_kind, input_tokens, output_tokens,
       exchange_rate_krw_per_usd, cost_krw, estimated, created_at,
       actual_cost_usd, actual_cost_source, event_status, provider_request_id
     ) VALUES (?, 'deepseek-v4-pro-0813', 'test', 1, 1,
               1500, 0, 0, ?, ?, ?, ?, ?)`
  ).run(
    opts.provider ?? "cheaperinference",
    opts.createdAt,
    opts.actualUsd,
    opts.source,
    opts.status,
    opts.providerRequestId
  );
}

function seedStoredUnreconciled(d: Database.Database, unreconciledMicroUsd: number): void {
  ensureProviderReconciliationStateTable(d);
  d.prepare(
    `INSERT INTO provider_cost_reconciliation_state
       (id, status, ran_at, window_start, window_end, provider_requests,
        settled_micro_usd, local_micro_usd, daily_micro_usd, daily_delta_micro_usd,
        unreconciled_micro_usd, message)
     VALUES (1, 'mismatch', '2026-10-02 00:00:00', '2026-10-01 00:00:00',
             '2026-11-01 00:00:00', 1, ?, 0, ?, ?, ?, 'synthetic')`
  ).run(
    unreconciledMicroUsd,
    unreconciledMicroUsd,
    unreconciledMicroUsd,
    unreconciledMicroUsd
  );
}

function assertNoFixtureIds(payload: unknown, ids: string[]): void {
  const raw = JSON.stringify(payload);
  for (const id of ids) {
    assert.equal(raw.includes(id), false, `diagnosis leaked ${id}`);
  }
  assertReconciliationDiagnosisSafePayload(payload);
}

describe("admin finance reconciliation diagnose #1337 follow-up", () => {
  it("returns zero aggregates and stays UNCONFIRMED on an empty ledger", () => {
    const d = db();
    try {
      const diagnosis = diagnoseProviderReconciliationLinkage(d, "2026-10");
      assert.equal(diagnosis.windowStart, "2026-10-01 00:00:00");
      assert.equal(diagnosis.windowEnd, "2026-11-01 00:00:00");
      assert.equal(diagnosis.windowSemantics, "naive_calendar_month_treated_as_utc");
      assert.equal(diagnosis.ledgerInWindow.rows, 0);
      assert.equal(diagnosis.messagesInWindow.distinctStoredRequestIds, 0);
      assert.equal(diagnosis.messagesOutOfWindow.distinctStoredRequestIds, 0);
      assert.equal(diagnosis.storedReconciliation.present, false);
      assert.equal(diagnosis.evidence.missingRequestIdsInWindow, true);
      assert.equal(diagnosis.evidence.remotePerRequestDataAvailable, false);
      assert.equal(diagnosis.evidence.classification, RECONCILIATION_ROOT_CAUSE_UNCONFIRMED);
      assert.ok(diagnosis.evidence.requiredToConfirm.length >= 3);
      assertNoFixtureIds(diagnosis, []);
    } finally {
      d.close();
    }
  });

  it("aggregates exact ledger rows by source, status, and request-id presence", () => {
    const d = db();
    try {
      insertLedgerRow(d, {
        createdAt: "2026-10-02 01:00:00",
        source: "cheaper_inference_billed",
        status: "settled",
        actualUsd: 0.05,
        providerRequestId: "ledger-exact-1",
      });
      insertLedgerRow(d, {
        createdAt: "2026-10-03 01:00:00",
        source: "cheaper_inference_usage_api",
        status: "settled",
        actualUsd: 0.02,
        providerRequestId: null,
      });
      insertLedgerRow(d, {
        createdAt: "2026-10-04 01:00:00",
        source: null,
        status: "started",
        actualUsd: null,
        providerRequestId: null,
      });
      insertLedgerRow(d, {
        createdAt: "2026-09-30 01:00:00",
        source: "cheaper_inference_billed",
        status: "settled",
        actualUsd: 0.09,
        providerRequestId: "outside-month",
      });

      const diagnosis = diagnoseProviderReconciliationLinkage(d, "2026-10");
      assert.equal(diagnosis.ledgerInWindow.rows, 3);
      assert.equal(diagnosis.ledgerInWindow.exactRows, 2);
      assert.equal(diagnosis.ledgerInWindow.inexactRows, 1);
      assert.equal(diagnosis.ledgerInWindow.withProviderRequestId, 1);
      assert.equal(diagnosis.ledgerInWindow.withoutProviderRequestId, 2);
      assert.equal(diagnosis.ledgerInWindow.bySource.cheaper_inference_billed, 1);
      assert.equal(diagnosis.ledgerInWindow.bySource.cheaper_inference_usage_api, 1);
      assert.equal(diagnosis.ledgerInWindow.bySource["(null)"], 1);
      assert.equal(diagnosis.ledgerInWindow.byStatus.settled, 2);
      assert.equal(diagnosis.ledgerInWindow.byStatus.started, 1);
      assertNoFixtureIds(diagnosis, ["ledger-exact-1", "outside-month"]);
    } finally {
      d.close();
    }
  });

  it("excludes other provider rows from CheaperInference counts and request linkage", () => {
    const d = db();
    try {
      const createdAt = "2026-10-02 01:00:00";
      insertIdentity(d, { id: 36, requestId: "cross-provider-id", createdAt });
      insertLedgerRow(d, {
        provider: "openrouter",
        createdAt,
        source: "provider_reported",
        status: "settled",
        actualUsd: 0.25,
        providerRequestId: "cross-provider-id",
      });
      insertLedgerRow(d, {
        provider: "cheaperinference",
        createdAt,
        source: "cheaper_inference_billed",
        status: "settled",
        actualUsd: 0.05,
        providerRequestId: "ci-only-id",
      });
      const diagnosis = diagnoseProviderReconciliationLinkage(d, "2026-10");
      assert.equal(diagnosis.ledgerInWindow.rows, 1);
      assert.equal(diagnosis.ledgerInWindow.exactRows, 1);
      assert.equal(diagnosis.ledgerInWindow.withProviderRequestId, 1);
      assert.equal(diagnosis.ledgerInWindow.bySource.cheaper_inference_billed, 1);
      assert.equal(diagnosis.ledgerInWindow.bySource.provider_reported, undefined);
      assert.equal(diagnosis.messagesInWindow.linkedToLedgerAny, 0);
      assert.equal(diagnosis.messagesInWindow.linkedToLedgerInWindow, 0);
      assert.equal(diagnosis.messagesInWindow.unlinkedToLedger, 1);
      assertNoFixtureIds(diagnosis, ["cross-provider-id", "ci-only-id"]);
    } finally {
      d.close();
    }
  });

  it("splits message request-id linkage inside vs outside the existing month window", () => {
    const d = db();
    try {
      insertIdentity(d, {
        id: 1,
        requestId: "in-window-linked",
        createdAt: "2026-10-02 01:00:00",
      });
      insertIdentity(d, {
        id: 2,
        requestId: "in-window-unlinked",
        createdAt: "2026-10-15 01:00:00",
      });
      insertIdentity(d, {
        id: 3,
        requestId: "late-message",
        createdAt: "2026-11-01 00:00:05",
      });
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 1,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "in-window-linked",
          cheaperInferenceBilledCostUsd: 0.05,
          outcome: "success",
          persistInTests: true,
          eventTime: "2026-10-02 01:00:00",
        },
        d
      );

      const diagnosis = diagnoseProviderReconciliationLinkage(d, "2026-10");
      assert.equal(diagnosis.messagesInWindow.messagesWithStoredRequestId, 2);
      assert.equal(diagnosis.messagesInWindow.distinctStoredRequestIds, 2);
      assert.equal(diagnosis.messagesInWindow.usableIdentities, 2);
      assert.equal(diagnosis.messagesInWindow.linkedToLedgerAny, 1);
      assert.equal(diagnosis.messagesInWindow.linkedToLedgerInWindow, 1);
      assert.equal(diagnosis.messagesInWindow.unlinkedToLedger, 1);
      assert.equal(diagnosis.evidence.inWindowIdentitiesUnlinked, true);
      assert.equal(diagnosis.messagesOutOfWindow.messagesWithStoredRequestId, 1);
      assert.equal(diagnosis.messagesOutOfWindow.distinctStoredRequestIds, 1);
      assert.equal(diagnosis.messagesOutOfWindow.unlinkedToLedger, 1);
      assert.equal(diagnosis.messagesOutOfWindow.nearBoundary9h, 1);
      assert.equal(diagnosis.evidence.outOfWindowIdentitiesPresent, true);
      assert.equal(diagnosis.evidence.timezoneBoundaryCandidate, true);
      assertNoFixtureIds(diagnosis, [
        "in-window-linked",
        "in-window-unlinked",
        "late-message",
      ]);
    } finally {
      d.close();
    }
  });

  it("flags a KST month-start identity as an out-of-window timezone candidate", () => {
    const d = db();
    try {
      insertIdentity(d, {
        id: 10,
        requestId: "kst-oct-1",
        createdAt: "2026-09-30 15:00:00",
      });
      const diagnosis = diagnoseProviderReconciliationLinkage(d, "2026-10");
      assert.equal(diagnosis.messagesInWindow.distinctStoredRequestIds, 0);
      assert.equal(diagnosis.messagesOutOfWindow.distinctStoredRequestIds, 1);
      assert.equal(diagnosis.messagesOutOfWindow.nearBoundary9h, 1);
      assert.equal(diagnosis.evidence.missingRequestIdsInWindow, true);
      assert.equal(diagnosis.evidence.timezoneBoundaryCandidate, true);
      assert.equal(diagnosis.evidence.classification, RECONCILIATION_ROOT_CAUSE_UNCONFIRMED);
      assertNoFixtureIds(diagnosis, ["kst-oct-1"]);
    } finally {
      d.close();
    }
  });

  it("cannot confirm remote-only spend without per-request provider data", () => {
    const d = db();
    try {
      insertIdentity(d, {
        id: 11,
        requestId: "already-local",
        createdAt: "2026-10-02 01:00:00",
      });
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 11,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "already-local",
          cheaperInferenceBilledCostUsd: 0.01,
          outcome: "success",
          persistInTests: true,
          eventTime: "2026-10-02 01:00:00",
        },
        d
      );
      seedStoredUnreconciled(d, 125_000);

      const diagnosis = diagnoseProviderReconciliationLinkage(d, "2026-10");
      assert.equal(diagnosis.storedReconciliation.unreconciledProviderMicroUsd, 125_000);
      assert.equal(diagnosis.messagesInWindow.unlinkedToLedger, 0);
      assert.equal(diagnosis.evidence.remoteOnlyOrIdMismatchCandidate, true);
      assert.equal(diagnosis.evidence.remotePerRequestDataAvailable, false);
      assert.equal(diagnosis.evidence.classification, RECONCILIATION_ROOT_CAUSE_UNCONFIRMED);
      assertNoFixtureIds(diagnosis, ["already-local"]);
    } finally {
      d.close();
    }
  });

  it("does not mutate ledger or stored reconciliation state", () => {
    const d = db();
    try {
      insertIdentity(d, {
        id: 12,
        requestId: "readonly-check",
        createdAt: "2026-10-02 01:00:00",
      });
      insertLedgerRow(d, {
        createdAt: "2026-10-02 01:00:00",
        source: "cheaper_inference_billed",
        status: "settled",
        actualUsd: 0.03,
        providerRequestId: "readonly-check",
      });
      seedStoredUnreconciled(d, 30_000);
      const beforeLedger = d
        .prepare("SELECT COUNT(*) AS c, SUM(actual_cost_usd) AS s FROM api_cost_ledger")
        .get() as { c: number; s: number };
      const beforeState = readProviderReconciliationState(d);
      const beforeFinance = buildAdminFinanceSummary(d, "2026-10");

      diagnoseProviderReconciliationLinkage(d, "2026-10");

      const afterLedger = d
        .prepare("SELECT COUNT(*) AS c, SUM(actual_cost_usd) AS s FROM api_cost_ledger")
        .get() as { c: number; s: number };
      const afterState = readProviderReconciliationState(d);
      const afterFinance = buildAdminFinanceSummary(d, "2026-10");
      assert.equal(afterLedger.c, beforeLedger.c);
      assert.equal(afterLedger.s, beforeLedger.s);
      assert.equal(afterState?.unreconciledProviderMicroUsd, beforeState?.unreconciledProviderMicroUsd);
      assert.equal(afterState?.status, beforeState?.status);
      assert.equal(afterFinance.totalApiCostKrw, beforeFinance.totalApiCostKrw);
      assert.equal(afterFinance.aiCost.totalActualKrw, beforeFinance.aiCost.totalActualKrw);
    } finally {
      d.close();
    }
  });
});
