import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CheaperInferenceUsageRequest } from "@/lib/cheaperInferenceUsage";
import {
  buildForwardReconAudit,
  markForwardReconFetchFailure,
  parseProvenObservedSince,
  parseStoredForwardReconAudit,
  resolveForwardObservationBaseline,
} from "@/lib/forwardReconAudit";

const T0 = "2026-10-03T12:00:00.000Z";

function req(
  requestId: string,
  createdAt: string,
  extra?: Partial<CheaperInferenceUsageRequest>
): CheaperInferenceUsageRequest {
  return {
    requestId,
    status: extra?.status ?? "settled",
    billedMicroUsd: extra?.billedMicroUsd ?? 10_000,
    settled: extra?.settled ?? extra?.status !== "pending",
    model: extra?.model ?? "gpt-6-luna",
    endpoint: extra?.endpoint ?? "/chat/completions",
    createdAt,
    apiKeyId: extra && "apiKeyId" in extra ? extra.apiKeyId : "key-a",
  };
}

function audit(
  requests: CheaperInferenceUsageRequest[],
  ledgerIds: string[] = [],
  observedSince = T0
) {
  return buildForwardReconAudit({
    requests,
    ledgerIds: new Set(ledgerIds),
    observedSince,
    observationSource: "first_successful_query",
    fetchStatus: "ok",
  });
}

describe("forward recon observation baseline", () => {
  it("accepts a proven ISO env instant and rejects non-ISO guesses", () => {
    assert.equal(
      parseProvenObservedSince("2026-10-03T08:15:00.000Z"),
      "2026-10-03T08:15:00.000Z"
    );
    assert.equal(parseProvenObservedSince("2026-10-03 08:15:00"), "2026-10-03T08:15:00.000Z");
    assert.equal(parseProvenObservedSince("yesterday"), null);
    assert.equal(parseProvenObservedSince("10/03/2026"), null);
    assert.equal(parseProvenObservedSince(""), null);
  });

  it("prefers proven env over a stored watermark", () => {
    const resolved = resolveForwardObservationBaseline({
      envValue: "2026-10-03T00:00:00.000Z",
      storedObservedSince: "2026-10-03T12:00:00.000Z",
      nowIso: "2026-10-03T18:00:00.000Z",
    });
    assert.equal(resolved.source, "proven_rotation_env");
    assert.equal(resolved.observedSince, "2026-10-03T00:00:00.000Z");
    assert.equal(resolved.persist, true);
  });

  it("uses the first successful query when rotation UTC is unproven", () => {
    const resolved = resolveForwardObservationBaseline({
      envValue: "",
      storedObservedSince: null,
      nowIso: T0,
    });
    assert.equal(resolved.source, "first_successful_query");
    assert.equal(resolved.observedSince, T0);
    assert.equal(resolved.persist, true);
  });
});

describe("forward recon audit fixtures", () => {
  it("keeps historical month spend out of the new-cost window", () => {
    const result = audit(
      [
        req("hist-unmatched", "2026-10-02 01:00:00", { billedMicroUsd: 3_071_719 }),
        req("hist-matched", "2026-10-02 02:00:00", { billedMicroUsd: 54_886 }),
      ],
      ["hist-matched"]
    );
    assert.equal(result.requestCount, 0);
    assert.equal(result.settledMicroUsd, 0);
    assert.equal(result.unmatchedSettledMicroUsd, 0);
    assert.deepEqual(result.cases, ["zero_new_calls"]);
    assert.equal(result.havExclusiveCostConfirmed, false);
  });

  it("classifies zero new calls after the observation baseline", () => {
    const result = audit([]);
    assert.deepEqual(result.cases, ["zero_new_calls"]);
    assert.equal(result.unmatchedLedgerCount, 0);
  });

  it("classifies a normal linked Luna call", () => {
    const result = audit(
      [req("luna-ok", "2026-10-03 13:00:00", { billedMicroUsd: 12_000 })],
      ["luna-ok"]
    );
    assert.deepEqual(result.cases, ["matched_luna"]);
    assert.equal(result.matchedLedgerCount, 1);
    assert.equal(result.unmatchedLedgerCount, 0);
    assert.equal(result.settledMicroUsd, 12_000);
    assert.equal(result.unmatchedSettledMicroUsd, 0);
    assert.equal(result.byModel["gpt-6-luna"]?.settledCount, 1);
    assert.equal(result.byModel["gpt-6-luna"]?.unmatchedCount, 0);
  });

  it("classifies a new unmatched Luna call without mixing month residue", () => {
    const result = audit(
      [
        req("old-269", "2026-10-01 04:00:00", { billedMicroUsd: 3_000_000 }),
        req("new-luna", "2026-10-03 13:05:00", { billedMicroUsd: 8_000 }),
      ],
      []
    );
    assert.deepEqual(result.cases, ["unmatched_luna"]);
    assert.equal(result.requestCount, 1);
    assert.equal(result.unmatchedLedgerCount, 1);
    assert.equal(result.unmatchedSettledMicroUsd, 8_000);
    assert.equal(result.settledMicroUsd, 8_000);
    assert.equal(result.byModel["gpt-6-luna"]?.unmatchedCount, 1);
    assert.equal(result.havExclusiveCostConfirmed, false);
    assert.equal(result.productionKeyMapping, "unavailable");
  });

  it("distinguishes other-key calls without applying a key-level audit", () => {
    const result = audit([
      req("a", "2026-10-03 13:00:00", { apiKeyId: "key-hav", billedMicroUsd: 1_000 }),
      req("b", "2026-10-03 13:01:00", { apiKeyId: "key-other", billedMicroUsd: 2_000 }),
    ]);
    assert.ok(result.cases.includes("other_key"));
    assert.ok(result.cases.includes("unmatched_luna"));
    assert.equal(result.distinctApiKeyIds, 2);
    assert.equal(result.otherApiKeyCandidate, true);
    assert.equal(result.productionKeyMapping, "unavailable");
    const raw = JSON.stringify(result);
    assert.equal(raw.includes("key-hav"), false);
    assert.equal(raw.includes("key-other"), false);
    assert.equal(raw.includes("\"a\""), false);
  });

  it("classifies pending settlement separately from unmatched spend", () => {
    const result = audit([
      req("pend", "2026-10-03 13:00:00", {
        status: "pending",
        settled: false,
        billedMicroUsd: 0,
      }),
    ]);
    assert.deepEqual(result.cases, ["pending_settlement"]);
    assert.equal(result.pendingCount, 1);
    assert.equal(result.settledCount, 0);
    assert.equal(result.unmatchedLedgerCount, 0);
    assert.equal(result.unmatchedSettledMicroUsd, 0);
  });

  it("classifies fetch failure without inventing new unmatched cost", () => {
    const failed = buildForwardReconAudit({
      requests: [req("new-luna", "2026-10-03 13:00:00")],
      ledgerIds: new Set(),
      observedSince: T0,
      observationSource: "stored_watermark",
      fetchStatus: "http",
    });
    assert.deepEqual(failed.cases, ["fetch_failure"]);
    assert.equal(failed.requestCount, 0);
    assert.equal(failed.unmatchedSettledMicroUsd, 0);

    const previous = audit([req("new-luna", "2026-10-03 13:00:00")]);
    const marked = markForwardReconFetchFailure(previous, "network");
    assert.deepEqual(marked.cases, ["fetch_failure"]);
    assert.equal(marked.fetchStatus, "network");
    assert.equal(marked.observedSince, T0);
    assert.equal(marked.unmatchedSettledMicroUsd, previous.unmatchedSettledMicroUsd);
  });

  it("does not treat a stored month total as parseable new cost", () => {
    const stored = parseStoredForwardReconAudit({
      observedSince: T0,
      observationSource: "first_successful_query",
      observationNote: "stored",
      fetchStatus: "ok",
      requestCount: 0,
      settledCount: 0,
      pendingCount: 0,
      matchedLedgerCount: 0,
      unmatchedLedgerCount: 0,
      settledMicroUsd: 0,
      matchedSettledMicroUsd: 0,
      unmatchedSettledMicroUsd: 0,
      byModel: {},
      distinctApiKeyIds: 0,
      otherApiKeyCandidate: false,
      havExclusiveCostConfirmed: true,
      productionKeyMapping: "hav-production",
      cases: ["zero_new_calls"],
    });
    assert.ok(stored);
    assert.equal(stored.havExclusiveCostConfirmed, false);
    assert.equal(stored.productionKeyMapping, "unavailable");
    assert.equal(parseStoredForwardReconAudit("{not-json"), null);
  });
});
