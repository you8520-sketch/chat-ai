import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { buildForwardReconAudit, type ForwardReconAudit } from "./forwardReconAudit";
import { completeForwardRequestWitnesses, forwardRequestReviewKey, forwardSnapshotFingerprint, projectForwardReview } from "./forwardReconReview";
import { ensureProviderReconciliationStateTable, readProviderReconciliationState, reviewForwardUsageSnapshot } from "./providerCostReconciliation";
import { buildFinanceAnomalyReport } from "./financeAnomalyRadar";
import type { AdminFinanceSummary } from "./adminFinance";
import type { CheaperInferenceUsageRequest } from "./cheaperInferenceUsage";

function request(id: string, key = "cursor", micro = 100): CheaperInferenceUsageRequest {
  return { requestId: id, apiKeyId: key, status: "settled", settled: true, model: "gpt-6-luna", billedMicroUsd: micro, endpoint: "/v1/chat/completions", createdAt: "2026-10-20T09:13:09.949Z" };
}
function audit(ids = ["unknown-a"]): ForwardReconAudit {
  return buildForwardReconAudit({ requests: [request("linked", "production"), request("prod-orphan", "production"), ...ids.map(id => request(id))], ledgerIds: new Set(["linked"]), observedSince: "2026-10-05T03:00:00.175Z", observationSource: "stored_watermark", fetchStatus: "ok" });
}
function save(db: Database.Database, value: ForwardReconAudit) {
  ensureProviderReconciliationStateTable(db);
  db.prepare("INSERT INTO provider_cost_reconciliation_state (id, status, forward_audit_json) VALUES(1,'mismatch',?) ON CONFLICT(id) DO UPDATE SET forward_audit_json=excluded.forward_audit_json").run(JSON.stringify(value));
}
function warnings(db: Database.Database) {
  return buildFinanceAnomalyReport({ summary: { providerReconciliation: readProviderReconciliationState(db) } as AdminFinanceSummary, pricing: null }).anomalies;
}

describe("forward usage review keeps unresolved history and detects new IDs", () => {
  it("archives only the reviewed snapshot, preserves totals and warns on a new ID with the same count", () => {
    const db = new Database(":memory:");
    try {
      const initial = audit(); save(db, initial);
      const fingerprint = forwardSnapshotFingerprint(initial)!;
      assert.equal(warnings(db).length, 2);
      const view = reviewForwardUsageSnapshot(db, fingerprint, 1);
      assert.equal(view.reviewedUnresolved.count, 2);
      assert.equal(warnings(db).length, 0);
      assert.equal(readProviderReconciliationState(db)!.forwardAudit!.unmatchedLedgerCount, 2);
      assert.equal(readProviderReconciliationState(db)!.status, "mismatch");
      assert.deepEqual(readProviderReconciliationState(db)!.forwardAudit, initial);
      // Same aggregate count and cost; a different billing ID must not be hidden.
      save(db, audit(["unknown-b"]));
      assert.equal(warnings(db).length, 1);
      assert.equal(readProviderReconciliationState(db)!.forwardOps!.pendingUndetermined.count, 1);
      assert.equal(readProviderReconciliationState(db)!.forwardOps!.reviewedUnresolved.count, 1);
      assert.throws(() => reviewForwardUsageSnapshot(db, fingerprint, 1), /갱신/);
      assert.equal(warnings(db).length, 1);
    } finally { db.close(); }
  });

  it("reopens a reviewed request when its settled cost changes", () => {
    const initial = audit();
    const row = initial.unmatchedRequests![0]!;
    const review = { observedSince: initial.observedSince!, reviewedAt: "2026-10-20T10:00:00Z", reviewedBy: 1, requestKeys: [forwardRequestReviewKey(row)] };
    const changed = structuredClone(initial);
    changed.unmatchedRequests![0]!.billedMicroUsd++;
    changed.unmatchedSettledMicroUsd++;
    changed.productionScope.unmatchedSettledMicroUsd++;
    const view = projectForwardReview(changed, review);
    assert.equal(view.available, true);
    assert.equal(view.pendingProduction.count, 1);
  });

  it("identifies only exact captured Luna measurement IDs, keeping unknown adjacent calls pending", () => {
    const value = audit(["1d6ba9f8-c4bb-4a47-b181-22f4a8966eb6", "d9b75660-864c-4706-bce8-e1b9e90bfafa"]);
    const view = projectForwardReview(value, null);
    assert.equal(view.identifiedMeasurements.count, 1);
    assert.equal(view.pendingUndetermined.count, 1);
    assert.equal(view.pendingProduction.count, 1);
    assert.equal(value.unmatchedLedgerCount, 3);
    assert.match(view.evidenceSources[0]!, /4f95ea31/);
    value.unmatchedRequests![1]!.model = "other-model";
    assert.equal(projectForwardReview(value, null).identifiedMeasurements.count, 0);
  });

  it("does not archive incomplete, failed, old or inconsistent snapshots", () => {
    const original = audit();
    for (const change of [
      { unmatchedRequests: undefined },
      { fetchStatus: "incomplete" as const },
      { verificationStatus: "unverified" as const },
      { unmatchedLedgerCount: 99 },
      { unmatchedRequests: [original.unmatchedRequests![0], original.unmatchedRequests![0]] },
    ]) {
      const value = { ...original, ...change };
      assert.equal(completeForwardRequestWitnesses(value), false);
      assert.equal(projectForwardReview(value, null).available, false);
      const db = new Database(":memory:");
      try { save(db, value); assert.throws(() => reviewForwardUsageSnapshot(db, "0".repeat(64), 1), /자료/); }
      finally { db.close(); }
    }
  });

  it("keeps a provider fetch failure visible after an earlier review", () => {
    const db = new Database(":memory:");
    try {
      const original = audit(); save(db, original);
      reviewForwardUsageSnapshot(db, forwardSnapshotFingerprint(original)!, 1);
      save(db, { ...original, fetchStatus: "network", verificationStatus: "fetch_failed" });
      assert.equal(readProviderReconciliationState(db)!.forwardOps!.available, false);
      assert.equal(warnings(db).some(row => row.code === "FORWARD_RECON_FETCH_FAILURE"), true);
    } finally { db.close(); }
  });
});
