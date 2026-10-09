import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashProviderRequestId } from "@/lib/approvedExperimentSpend";
import type { CheaperInferenceUsageRequest } from "@/lib/cheaperInferenceUsage";
import { buildFinanceAnomalyReport } from "@/lib/financeAnomalyRadar";
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
    apiKeyName: extra?.apiKeyName ?? null,
  };
}

function audit(
  requests: CheaperInferenceUsageRequest[],
  ledgerIds: string[] = [],
  observedSince = T0,
  experimentEvidence?: Parameters<typeof buildForwardReconAudit>[0]["experimentEvidence"]
) {
  return buildForwardReconAudit({
    requests,
    ledgerIds: new Set(ledgerIds),
    observedSince,
    observationSource: "first_successful_query",
    fetchStatus: "ok",
    experimentEvidence,
  });
}

describe("forward recon observation baseline", () => {
  it("accepts a proven ISO env instant and rejects non-ISO guesses", () => {
    assert.equal(
      parseProvenObservedSince("2026-10-03T08:15:00.000Z"),
      "2026-10-03T08:15:00.000Z"
    );
    assert.equal(parseProvenObservedSince("2026-10-03 08:15:00"), null);
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
    assert.equal(resolved.configInvalid, false);
  });

  it("accepts explicit UTC Z or offset and rejects timezone-less cutoffs", () => {
    assert.equal(parseProvenObservedSince("2026-10-03T08:15:00Z"), "2026-10-03T08:15:00.000Z");
    assert.equal(
      parseProvenObservedSince("2026-10-03T17:15:00+09:00"),
      "2026-10-03T08:15:00.000Z"
    );
    assert.equal(parseProvenObservedSince("2026-10-03 08:15:00"), null);
    assert.equal(parseProvenObservedSince("2026-10-03T08:15:00"), null);
  });

  it("does not substitute another window when the env cutoff is nonempty and invalid", () => {
    const resolved = resolveForwardObservationBaseline({
      envValue: "2026-10-03 08:15:00",
      storedObservedSince: "2026-10-03T12:00:00.000Z",
      nowIso: "2026-10-03T18:00:00.000Z",
    });
    assert.equal(resolved.configInvalid, true);
    assert.equal(resolved.observedSince, null);
    assert.equal(resolved.source, null);
    assert.equal(resolved.persist, false);
    const raw = JSON.stringify(resolved);
    assert.equal(raw.includes("2026-10-03 08:15:00"), false);
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

  it("marks a missing or malformed provider timestamp unverifiable instead of zero new calls", () => {
    const result = audit([
      req("old-well-formed", "2026-10-02 01:00:00", { billedMicroUsd: 3_000_000 }),
      {
        requestId: "settled-luna-no-time",
        status: "settled",
        billedMicroUsd: 9_000,
        settled: true,
        model: "gpt-6-luna",
        endpoint: "/chat/completions",
        createdAt: null,
        apiKeyId: "key-a",
      },
      {
        requestId: "settled-luna-bad-time",
        status: "settled",
        billedMicroUsd: 7_000,
        settled: true,
        model: "gpt-6-luna",
        endpoint: "/chat/completions",
        createdAt: "not-a-timestamp",
        apiKeyId: "key-a",
      },
    ]);
    assert.equal(result.fetchStatus, "ok");
    assert.equal(result.verificationStatus, "unverified");
    assert.ok(result.cases.includes("unverifiable_timestamp"));
    assert.equal(result.cases.includes("zero_new_calls"), false);
    assert.equal(result.unverifiableTimestampCount, 2);
    assert.equal(result.unverifiableSettledCount, 2);
    assert.equal(result.requestCount, 0);
    assert.equal(result.unmatchedSettledMicroUsd, 0);
    assert.equal(result.unmatchedLedgerCount, 0);
    const raw = JSON.stringify(result);
    assert.equal(raw.includes("settled-luna-no-time"), false);
    assert.equal(raw.includes("settled-luna-bad-time"), false);
  });

  it("keeps well-formed zero new calls verified when timestamps are present", () => {
    const result = audit([req("old-only", "2026-10-02 01:00:00")]);
    assert.deepEqual(result.cases, ["zero_new_calls"]);
    assert.equal(result.verificationStatus, "verified");
    assert.equal(result.unverifiableTimestampCount, 0);
  });
});

describe("forward recon approved-experiment fixtures", () => {
  const geminiIds = Array.from({ length: 13 }, (_, i) => `gemini-exp-${i + 1}`);
  const evidence = {
    confirmedRequestIdHashes: new Set(geminiIds.map(hashProviderRequestId)),
    exclusiveKeyNamePrefixes: ["HAV-1354-"],
  };

  function geminiReqs(ids = geminiIds) {
    return ids.map((id, i) =>
      req(id, `2026-10-08 09:${String(i).padStart(2, "0")}:00`, {
        model: "gemini-3.8-flash",
        billedMicroUsd: 6_000 + i,
        apiKeyName: "operator-agent",
      })
    );
  }

  function radar(forward: ReturnType<typeof audit>) {
    return buildFinanceAnomalyReport({
      summary: {
        monthKey: "2026-10",
        providerReconciliation: {
          status: "mismatch",
          windowStart: "2026-10-01 00:00:00",
          windowEnd: "2026-11-01 00:00:00",
          dailyDeltaMicroUsd: 88_511,
          unreconciledProviderMicroUsd: 88_511,
          forwardAudit: forward,
        },
      } as never,
      pricing: null,
    });
  }

  it("1. approved experiment 13 only → unmatched WARNING 0 and no invented extra cost", () => {
    const result = audit(geminiReqs(), [], T0, evidence);
    assert.equal(result.approvedExperimentCount, 13);
    assert.equal(result.unmatchedLedgerCount, 0);
    assert.equal(result.unmatchedSettledMicroUsd, 0);
    assert.equal(result.matchedLedgerCount, 0);
    assert.ok(result.cases.includes("approved_experiment"));
    assert.equal(result.cases.includes("unmatched_luna"), false);
    const report = radar(result);
    assert.equal(
      report.anomalies.some((row) => row.code === "FORWARD_UNMATCHED_REMOTE_SPEND"),
      false
    );
  });

  it("2. approved experiment + production ledger stay separately classified", () => {
    const result = audit(
      [
        ...geminiReqs(),
        req("prod-luna", "2026-10-08 12:00:00", {
          billedMicroUsd: 1_500,
          apiKeyName: "HAV-PRODUCTION",
        }),
      ],
      ["prod-luna"],
      T0,
      evidence
    );
    assert.equal(result.approvedExperimentCount, 13);
    assert.equal(result.matchedLedgerCount, 1);
    assert.equal(result.unmatchedLedgerCount, 0);
    assert.ok(result.cases.includes("approved_experiment"));
    assert.ok(result.cases.includes("matched_luna"));
  });

  it("3. a new unknown request after experiments raises unmatched WARNING", () => {
    const result = audit(
      [
        ...geminiReqs(),
        req("new-unknown", "2026-10-09 01:00:00", {
          model: "gemini-3.8-flash",
          billedMicroUsd: 9_000,
          apiKeyName: "HAV-PRODUCTION",
        }),
      ],
      [],
      T0,
      evidence
    );
    assert.equal(result.approvedExperimentCount, 13);
    assert.equal(result.unmatchedLedgerCount, 1);
    assert.equal(result.unmatchedSettledMicroUsd, 9_000);
    const report = radar(result);
    assert.equal(report.status, "WARNING");
    assert.equal(
      report.anomalies.some((row) => row.code === "FORWARD_UNMATCHED_REMOTE_SPEND"),
      true
    );
    assert.match(report.anomalies[0]?.summary ?? "", /13 confirmed approved-experiment/);
  });

  it("4+5. same request ids keep one fingerprint after reorder; a new id changes it", () => {
    const first = audit(
      [
        ...geminiReqs(),
        req("new-unknown", "2026-10-09 01:00:00", {
          model: "gemini-3.8-flash",
          billedMicroUsd: 9_000,
        }),
      ],
      [],
      T0,
      evidence
    );
    const reordered = audit(
      [
        req("new-unknown", "2026-10-09 01:00:00", {
          model: "gemini-3.8-flash",
          billedMicroUsd: 9_000,
        }),
        ...geminiReqs().reverse(),
      ],
      [],
      T0,
      evidence
    );
    assert.equal(first.unknownRequestFingerprint, reordered.unknownRequestFingerprint);
    assert.equal(first.unmatchedLedgerCount, reordered.unmatchedLedgerCount);
    assert.equal(first.approvedExperimentCount, reordered.approvedExperimentCount);
    const firstRef = radar(first).anomalies[0]?.sourceRef;
    const againRef = radar(reordered).anomalies[0]?.sourceRef;
    assert.equal(firstRef, againRef);
    assert.equal(radar(first).anomalies[0]?.id, radar(reordered).anomalies[0]?.id);

    const withNew = audit(
      [
        ...geminiReqs(),
        req("new-unknown", "2026-10-09 01:00:00", {
          model: "gemini-3.8-flash",
          billedMicroUsd: 9_000,
        }),
        req("newer-unknown", "2026-10-09 02:00:00", {
          model: "gemini-3.8-flash",
          billedMicroUsd: 1_000,
        }),
      ],
      [],
      T0,
      evidence
    );
    assert.notEqual(withNew.unknownRequestFingerprint, first.unknownRequestFingerprint);
    assert.notEqual(radar(withNew).anomalies[0]?.sourceRef, firstRef);
    assert.equal(radar(withNew).anomalies[0]?.id, radar(first).anomalies[0]?.id);
  });

  it("6. same model on a production ledger key vs an experiment key stay distinct", () => {
    const result = audit(
      [
        req("luna-prod", "2026-10-08 07:00:00", {
          apiKeyName: "HAV-PRODUCTION",
          billedMicroUsd: 1_241,
        }),
        req("luna-exp", "2026-10-08 07:12:14", {
          apiKeyName: "operator-agent",
          billedMicroUsd: 1_252,
        }),
      ],
      ["luna-prod"],
      T0,
      {
        confirmedRequestIdHashes: new Set([hashProviderRequestId("luna-exp")]),
        exclusiveKeyNamePrefixes: ["HAV-1354-"],
      }
    );
    assert.equal(result.matchedLedgerCount, 1);
    assert.equal(result.approvedExperimentCount, 1);
    assert.equal(result.unmatchedLedgerCount, 0);
  });

  it("7. missing API key identity cannot confirm an unlisted request", () => {
    const result = audit(
      [
        req("no-key-unknown", "2026-10-08 07:00:00", {
          apiKeyId: null,
          apiKeyName: null,
          billedMicroUsd: 800,
        }),
      ],
      [],
      T0,
      evidence
    );
    assert.equal(result.approvedExperimentCount, 0);
    assert.equal(result.unmatchedLedgerCount, 1);
    assert.equal(radar(result).status, "WARNING");
  });

  it("8. fetch failure / incomplete pages cannot be classified as healthy unmatched-zero", () => {
    const failed = buildForwardReconAudit({
      requests: geminiReqs(),
      ledgerIds: new Set(),
      observedSince: T0,
      observationSource: "stored_watermark",
      fetchStatus: "incomplete",
      experimentEvidence: evidence,
    });
    assert.equal(failed.verificationStatus, "fetch_failed");
    assert.deepEqual(failed.cases, ["fetch_failure"]);
    assert.equal(failed.approvedExperimentCount, 0);
    assert.equal(failed.unmatchedSettledMicroUsd, 0);
    const report = radar(failed);
    assert.notEqual(report.status, "HEALTHY");
    assert.equal(
      report.anomalies.some((row) => row.code === "FORWARD_UNMATCHED_REMOTE_SPEND"),
      false
    );
    assert.equal(
      report.anomalies.some((row) => row.code === "FORWARD_RECON_FETCH_FAILURE"),
      true
    );
  });

  it("9. an unused experiment catalog does not invent spend", () => {
    const result = audit([], [], T0, evidence);
    assert.equal(result.approvedExperimentCount, 0);
    assert.equal(result.approvedExperimentMicroUsd, 0);
    assert.equal(result.settledMicroUsd, 0);
    assert.equal(result.unmatchedLedgerCount, 0);
    assert.deepEqual(result.cases, ["zero_new_calls"]);
  });
});
