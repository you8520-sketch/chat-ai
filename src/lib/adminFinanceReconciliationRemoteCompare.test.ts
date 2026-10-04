import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { buildAdminFinanceSummary } from "@/lib/adminFinance";
import {
  RECONCILIATION_ROOT_CAUSE_UNCONFIRMED,
  diagnoseProviderReconciliationLinkage,
} from "@/lib/adminFinanceReconciliationDiagnose";
import {
  RECONCILIATION_REMOTE_UNVERIFIED,
  compareProviderReconciliationRemote,
} from "@/lib/adminFinanceReconciliationRemoteCompare";
import {
  ensureProviderCostLedgerSchema,
  recordBackgroundProviderCost,
  recordMainGenerationProviderCost,
} from "@/lib/providerCostLedger";
import type { CheaperInferenceUsageRequest } from "@/lib/cheaperInferenceUsage";

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

function settled(
  requestId: string,
  billedMicroUsd: number,
  createdAt: string,
  extra?: { apiKeyId?: string | null; status?: string }
): CheaperInferenceUsageRequest {
  return {
    requestId,
    status: extra?.status ?? "settled",
    billedMicroUsd,
    settled: billedMicroUsd > 0 && extra?.status !== "pending",
    model: "deepseek-v4-pro-0813",
    endpoint: "/chat/completions",
    createdAt,
    apiKeyId: extra && "apiKeyId" in extra ? extra.apiKeyId : "key-a",
  };
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
      stages: [{ stage: "main", providerRequestId: opts.requestId, model: "deepseek-v4-pro-0813" }],
    }),
    opts.createdAt
  );
}

async function compare(
  d: Database.Database,
  input: {
    requests?: CheaperInferenceUsageRequest[];
    fetchOk?: boolean;
    incomplete?: boolean;
    reason?: "no_key" | "http" | "network";
    status?: number;
    includeKeyGroups?: boolean;
    observedSinceEnv?: string | null;
    nowMs?: number;
  }
) {
  return compareProviderReconciliationRemote(d, "2026-10", {
    includeKeyGroups: input.includeKeyGroups,
    observedSinceEnv: input.observedSinceEnv,
    now: input.nowMs != null ? () => input.nowMs! : undefined,
    fetchRequests: async () => {
      if (input.incomplete) {
        return {
          ok: false,
          reason: "incomplete",
          message: "usage requests pagination hit the 8-page safety cap with more pages remaining",
        };
      }
      if (input.fetchOk === false) {
        return {
          ok: false,
          reason: input.reason ?? "http",
          status: input.status ?? 403,
          message: "usage API 403",
        };
      }
      return { ok: true, value: { pages: 1, requests: input.requests ?? [] } };
    },
  });
}

function assertNoSecrets(payload: unknown, secrets: string[]): void {
  const raw = JSON.stringify(payload);
  for (const secret of secrets) {
    assert.equal(raw.includes(secret), false, `leaked ${secret}`);
  }
}

describe("admin finance reconciliation remote compare", () => {
  it("matches a remote settled request to a ledger and message identity", async () => {
    const d = db();
    try {
      insertIdentity(d, { id: 1, requestId: "linked-main", createdAt: "2026-10-02 01:00:00" });
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 1,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "linked-main",
          cheaperInferenceBilledCostUsd: 0.05,
          outcome: "success",
          persistInTests: true,
          eventTime: "2026-10-02 01:00:00",
        },
        d
      );
      const result = await compare(d, {
        requests: [settled("linked-main", 50_000, "2026-10-02 01:00:00")],
      });
      assert.equal(result.remote.fetchStatus, "ok");
      assert.equal(result.remote.settledCount, 1);
      assert.equal(result.match.remoteSettledMatchedLedgerInWindow, 1);
      assert.equal(result.match.remoteSettledMatchedMessagesInWindow, 1);
      assert.equal(result.evidence.classification, RECONCILIATION_ROOT_CAUSE_UNCONFIRMED);
      assertNoSecrets(result, ["linked-main", "key-a"]);
    } finally {
      d.close();
    }
  });

  it("treats background exact rows without request ids as a confirmed linkage gap", async () => {
    const d = db();
    try {
      recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          requestKind: "background-memory",
          cheaperInferenceBilledCostUsd: 0.04,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      d.prepare("UPDATE api_cost_ledger SET created_at = ?").run("2026-10-02 01:00:00");
      const result = await compare(d, {
        requests: [settled("remote-only-bg", 40_000, "2026-10-02 01:00:00")],
      });
      assert.equal(result.localLedgerInWindow.rows, 1);
      assert.equal(result.localLedgerInWindow.withProviderRequestId, 0);
      assert.equal(result.localLedgerInWindow.backgroundWithoutProviderRequestId, 1);
      assert.equal(result.match.remoteSettledMatchedLedgerAny, 0);
      assert.equal(result.evidence.ledgerIdsAbsentInWindow, true);
      assert.equal(result.evidence.backgroundRowsExplainNoIdLedger, true);
      // Local absence of IDs is proven; remote-only usage may coexist, so the
      // underlying provider-spend discrepancy is NOT causally resolved.
      assert.equal(result.evidence.classification, RECONCILIATION_ROOT_CAUSE_UNCONFIRMED);
      assert.equal(result.evidence.confirmedMechanism, "LEDGER_REQUEST_IDS_ABSENT");
      assert.ok(result.evidence.requiredToConfirm.length > 0);
      assertNoSecrets(result, ["remote-only-bg"]);
    } finally {
      d.close();
    }
  });

  it("does not mistake external-only settled spend for a confirmed local ledger root cause", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        requests: [settled("external-workspace-call", 100_000, "2026-10-02 01:00:00")],
      });
      assert.equal(result.localLedgerInWindow.rows, 0);
      assert.equal(result.evidence.ledgerIdsAbsentInWindow, true);
      assert.equal(result.match.remoteSettledMatchedLedgerAny, 0);
      assert.equal(result.evidence.remoteOnlyCandidate, true);
      assert.equal(result.evidence.classification, RECONCILIATION_ROOT_CAUSE_UNCONFIRMED);
      assert.equal(result.evidence.confirmedMechanism, null);
      assert.ok(result.evidence.requiredToConfirm.length > 0);
      assertNoSecrets(result, ["external-workspace-call"]);
    } finally {
      d.close();
    }
  });

  it("flags spend that arrives under more than one remote API key", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        requests: [
          settled("a-1", 10_000, "2026-10-02 01:00:00", { apiKeyId: "key-hav" }),
          settled("b-1", 20_000, "2026-10-02 02:00:00", { apiKeyId: "key-other" }),
        ],
      });
      assert.equal(result.remote.apiKeyDistinction, "available");
      assert.equal(result.remote.distinctApiKeyIds, 2);
      assert.equal(result.evidence.otherApiKeyCandidate, true);
      assertNoSecrets(result, ["a-1", "b-1", "key-hav", "key-other"]);
    } finally {
      d.close();
    }
  });

  it("does not treat an OpenRouter ledger id as a CheaperInference match", async () => {
    const d = db();
    try {
      insertIdentity(d, { id: 2, requestId: "shared-id", createdAt: "2026-10-02 01:00:00" });
      d.prepare(
        `INSERT INTO api_cost_ledger (
           provider, model, request_kind, input_tokens, output_tokens,
           exchange_rate_krw_per_usd, cost_krw, estimated, created_at,
           actual_cost_usd, actual_cost_source, event_status, provider_request_id
         ) VALUES ('openrouter', 'gpt-5.6-luna', 'test', 1, 1, 1500, 0, 0,
                   '2026-10-02 01:00:00', 0.2, 'provider_reported', 'settled', ?)`
      ).run("shared-id");
      const result = await compare(d, {
        requests: [settled("shared-id", 20_000, "2026-10-02 01:00:00")],
      });
      assert.equal(result.localLedgerInWindow.rows, 0);
      assert.equal(result.match.remoteSettledMatchedLedgerAny, 0);
      assert.equal(result.match.remoteSettledMatchedMessagesInWindow, 1);
      assertNoSecrets(result, ["shared-id"]);
    } finally {
      d.close();
    }
  });

  it("excludes pending remote rows from settled totals", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        requests: [
          {
            requestId: "pending-1",
            status: "pending",
            billedMicroUsd: 0,
            settled: false,
            model: "deepseek-v4-pro-0813",
            endpoint: "/chat/completions",
            createdAt: "2026-10-02 01:00:00",
            apiKeyId: "key-a",
          },
          settled("settled-1", 15_000, "2026-10-02 01:00:00"),
        ],
      });
      assert.equal(result.remote.requestCount, 2);
      assert.equal(result.remote.settledCount, 1);
      assert.equal(result.remote.pendingOrUnsettledCount, 1);
      assert.equal(result.remote.settledMicroUsd, 15_000);
      assertNoSecrets(result, ["pending-1", "settled-1"]);
    } finally {
      d.close();
    }
  });

  it("counts duplicate remote request ids without leaking them", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        requests: [
          settled("dup-1", 10_000, "2026-10-02 01:00:00"),
          settled("dup-1", 10_000, "2026-10-02 01:00:01"),
        ],
      });
      assert.equal(result.remote.requestCount, 2);
      assert.equal(result.remote.distinctRequestIds, 1);
      assert.equal(result.remote.duplicateRequestIds, 1);
      assert.equal(result.match.remoteSettledUnmatchedLedger, 1);
      assertNoSecrets(result, ["dup-1"]);
    } finally {
      d.close();
    }
  });

  it("marks a KST month-start remote timestamp as a timezone candidate", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        requests: [settled("kst-edge", 10_000, "2026-09-30 15:00:00")],
      });
      assert.equal(result.remote.nearBoundary9h, 1);
      assert.equal(result.evidence.timezoneBoundaryCandidate, true);
      assert.equal(result.evidence.classification, RECONCILIATION_ROOT_CAUSE_UNCONFIRMED);
      assert.equal(result.evidence.confirmedMechanism, null);
      assertNoSecrets(result, ["kst-edge"]);
    } finally {
      d.close();
    }
  });

  it("marks truncated provider pages UNVERIFIED", async () => {
    const d = db();
    try {
      const result = await compare(d, { incomplete: true });
      assert.equal(result.remote.fetchStatus, "incomplete");
      assert.equal(result.evidence.classification, RECONCILIATION_REMOTE_UNVERIFIED);
    } finally {
      d.close();
    }
  });

  it("marks a remote 403 UNVERIFIED without mutating the ledger", async () => {
    const d = db();
    try {
      recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          requestKind: "background-memory",
          cheaperInferenceBilledCostUsd: 0.01,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const before = d
        .prepare("SELECT COUNT(*) AS c, SUM(actual_cost_usd) AS s FROM api_cost_ledger")
        .get() as { c: number; s: number };
      const beforeFinance = buildAdminFinanceSummary(d, "2026-10");
      const result = await compare(d, { fetchOk: false, reason: "http", status: 403 });
      assert.equal(result.remote.fetchStatus, "http");
      assert.equal(result.remote.httpStatus, 403);
      assert.equal(result.evidence.classification, RECONCILIATION_REMOTE_UNVERIFIED);
      const after = d
        .prepare("SELECT COUNT(*) AS c, SUM(actual_cost_usd) AS s FROM api_cost_ledger")
        .get() as { c: number; s: number };
      const afterFinance = buildAdminFinanceSummary(d, "2026-10");
      assert.equal(after.c, before.c);
      assert.equal(after.s, before.s);
      assert.equal(afterFinance.totalApiCostKrw, beforeFinance.totalApiCostKrw);
    } finally {
      d.close();
    }
  });

  it("adds an overall abort budget to the existing per-page usage client signal", async () => {
    const d = db();
    const source = new AbortController();
    let sawBudget = false;
    try {
      const result = await compareProviderReconciliationRemote(d, "2026-10", {
        fetchImpl: async (_input, init) => {
          assert.ok(init?.signal);
          assert.notEqual(init.signal, source.signal);
          assert.equal(init.signal.aborted, false);
          source.abort();
          assert.equal(init.signal.aborted, true);
          sawBudget = true;
          return new Response("{}", { status: 200 });
        },
        fetchRequests: async (opts) => {
          assert.ok(opts.fetchImpl);
          await opts.fetchImpl!("https://example.invalid/fixture", { signal: source.signal });
          return { ok: true, value: { pages: 1, requests: [] } };
        },
      });
      assert.equal(sawBudget, true);
      assert.equal(result.remote.fetchStatus, "ok");
    } finally {
      d.close();
    }
  });

  it("does not change the existing local diagnosis payload shape", async () => {
    const d = db();
    try {
      const local = diagnoseProviderReconciliationLinkage(d, "2026-10");
      const remote = await compare(d, { requests: [] });
      assert.equal(local.evidence.remotePerRequestDataAvailable, false);
      assert.equal(local.evidence.classification, RECONCILIATION_ROOT_CAUSE_UNCONFIRMED);
      assert.equal(typeof remote.remote.fetchStatus, "string");
      assert.equal("reconciliationDiagnosis" in remote, false);
      assert.equal("apiKeyGroups" in remote, false);
    } finally {
      d.close();
    }
  });

  it("omits API-key groups unless they are explicitly requested", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        requests: [
          settled("a-1", 10_000, "2026-10-02 01:00:00", { apiKeyId: "key-hav" }),
          settled("b-1", 20_000, "2026-10-02 02:00:00", { apiKeyId: "key-other" }),
        ],
      });
      assert.equal("apiKeyGroups" in result, false);
      assertNoSecrets(result, ["key-hav", "key-other", "a-1", "b-1"]);
    } finally {
      d.close();
    }
  });

  it("omits key groups rather than presenting 0=0 when the upstream read fails", async () => {
    const d = db();
    try {
      const unavailable = await compare(d, {
        includeKeyGroups: true,
        fetchOk: false,
        status: 403,
      });
      assert.equal(unavailable.remote.fetchStatus, "http");
      assert.equal(unavailable.evidence.classification, RECONCILIATION_REMOTE_UNVERIFIED);
      assert.equal("apiKeyGroups" in unavailable, false);

      const incomplete = await compare(d, {
        includeKeyGroups: true,
        incomplete: true,
      });
      assert.equal(incomplete.remote.fetchStatus, "incomplete");
      assert.equal(incomplete.evidence.classification, RECONCILIATION_REMOTE_UNVERIFIED);
      assert.equal("apiKeyGroups" in incomplete, false);
    } finally {
      d.close();
    }
  });

  it("returns anonymous per-key aggregates that sum to remote settled totals", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        includeKeyGroups: true,
        requests: [
          settled("a-1", 10_000, "2026-10-02 01:00:00", { apiKeyId: "key-hav" }),
          settled("a-2", 5_000, "2026-10-02 01:10:00", { apiKeyId: "key-hav" }),
          settled("b-1", 30_000, "2026-10-02 02:00:00", { apiKeyId: "key-other" }),
          settled("c-1", 4_000, "2026-10-02 03:00:00", { apiKeyId: null }),
        ],
      });
      assert.ok(result.apiKeyGroups);
      assert.equal(result.apiKeyGroups.groups.length, 2);
      assert.equal(result.apiKeyGroups.groups[0]!.ordinal, 1);
      assert.equal(result.apiKeyGroups.groups[0]!.settledCount, 1);
      assert.equal(result.apiKeyGroups.groups[0]!.settledMicroUsd, 30_000);
      assert.equal(result.apiKeyGroups.groups[1]!.settledCount, 2);
      assert.equal(result.apiKeyGroups.groups[1]!.settledMicroUsd, 15_000);
      assert.equal(result.apiKeyGroups.ungroupedSettledCount, 1);
      assert.equal(result.apiKeyGroups.ungroupedSettledMicroUsd, 4_000);
      assert.equal(result.apiKeyGroups.groupsSettledCount, 3);
      assert.equal(result.apiKeyGroups.groupsSettledMicroUsd, 45_000);
      assert.equal(result.remote.settledCount, 4);
      assert.equal(result.remote.settledMicroUsd, 49_000);
      assert.equal(result.apiKeyGroups.totalsMatchRemoteSettled, true);
      assert.equal(result.apiKeyGroups.productionKeyMapping, "unavailable");
      assert.equal(result.apiKeyGroups.groups[0]!.byModel["deepseek-v4-pro-0813"], 1);
      assert.equal(result.apiKeyGroups.groups[0]!.byEndpoint["/chat/completions"], 1);
      assertNoSecrets(result, ["key-hav", "key-other", "a-1", "a-2", "b-1", "c-1"]);
    } finally {
      d.close();
    }
  });

  it("audits only requests at or after the observation baseline", async () => {
    const d = db();
    try {
      insertIdentity(d, { id: 3, requestId: "new-linked", createdAt: "2026-10-03 13:00:00" });
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 3,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "gpt-6-luna",
          providerRequestId: "new-linked",
          cheaperInferenceBilledCostUsd: 0.012,
          outcome: "success",
          persistInTests: true,
          eventTime: "2026-10-03 13:00:00",
        },
        d
      );
      const result = await compare(d, {
        observedSinceEnv: "2026-10-03T12:00:00.000Z",
        requests: [
          settled("old-unmatched", 3_000_000, "2026-10-02 01:00:00"),
          {
            requestId: "new-linked",
            status: "settled",
            billedMicroUsd: 12_000,
            settled: true,
            model: "gpt-6-luna",
            endpoint: "/chat/completions",
            createdAt: "2026-10-03 13:00:00",
            apiKeyId: "key-a",
          },
          {
            requestId: "new-unmatched",
            status: "settled",
            billedMicroUsd: 8_000,
            settled: true,
            model: "gpt-6-luna",
            endpoint: "/chat/completions",
            createdAt: "2026-10-03 13:05:00",
            apiKeyId: "key-a",
          },
          {
            requestId: "new-pending",
            status: "pending",
            billedMicroUsd: 0,
            settled: false,
            model: "gpt-6-luna",
            endpoint: "/chat/completions",
            createdAt: "2026-10-03 13:06:00",
            apiKeyId: "key-a",
          },
        ],
      });
      assert.equal(result.remote.settledCount, 3);
      assert.equal(result.remote.settledMicroUsd, 3_020_000);
      assert.equal(result.forwardAudit.observationSource, "proven_rotation_env");
      assert.equal(result.forwardAudit.requestCount, 3);
      assert.equal(result.forwardAudit.matchedLedgerCount, 1);
      assert.equal(result.forwardAudit.unmatchedLedgerCount, 1);
      assert.equal(result.forwardAudit.unmatchedSettledMicroUsd, 8_000);
      assert.equal(result.forwardAudit.pendingCount, 1);
      assert.ok(result.forwardAudit.cases.includes("matched_luna"));
      assert.ok(result.forwardAudit.cases.includes("unmatched_luna"));
      assert.ok(result.forwardAudit.cases.includes("pending_settlement"));
      assert.equal(result.forwardAudit.havExclusiveCostConfirmed, false);
      assertNoSecrets(result, ["old-unmatched", "new-linked", "new-unmatched", "new-pending", "key-a"]);
    } finally {
      d.close();
    }
  });

  it("keeps a failed remote read from inventing forward unmatched cost", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        observedSinceEnv: "2026-10-03T12:00:00.000Z",
        fetchOk: false,
        reason: "http",
        status: 403,
      });
      assert.equal(result.forwardAudit.fetchStatus, "http");
      assert.deepEqual(result.forwardAudit.cases, ["fetch_failure"]);
      assert.equal(result.forwardAudit.unmatchedSettledMicroUsd, 0);
    } finally {
      d.close();
    }
  });

  it("accepts numeric provider api_key_id values without leaking them", async () => {
    const d = db();
    try {
      const result = await compare(d, {
        includeKeyGroups: true,
        nowMs: Date.parse("2026-10-03T13:00:00.000Z"),
        requests: [
          settled("n-1", 8_000, "2026-10-02 01:00:00", { apiKeyId: "42" }),
          settled("n-2", 2_000, "2026-10-02 01:01:00", { apiKeyId: "42" }),
        ],
      });
      assert.equal(result.apiKeyGroups?.groups.length, 1);
      assert.equal(result.apiKeyGroups?.groups[0]!.settledCount, 2);
      assert.equal(result.apiKeyGroups?.keyIdValueKinds.number, 2);
      assert.equal(result.apiKeyGroups?.totalsMatchRemoteSettled, true);
      assertNoSecrets(result, ["n-1", "n-2", "42"]);
    } finally {
      d.close();
    }
  });
});
