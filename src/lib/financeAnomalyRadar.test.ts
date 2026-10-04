import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AdminFinanceSummary, ModelDirectCostAttribution } from "@/lib/adminFinance";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { buildFinanceAnomalyReport } from "@/lib/financeAnomalyRadar";
import type { MainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";
import { getPublishedPricing } from "@/lib/publishedModelPricing";

const ACTIVE = MAIN_RP_MODEL_IDS[0]!;

function summary(overrides: Record<string, unknown> = {}): AdminFinanceSummary {
  return {
    monthKey: "2026-10",
    providerReconciliation: null,
    ...overrides,
  } as unknown as AdminFinanceSummary;
}

function pricing(input?: {
  modelId?: string;
  paidRevenueKrw?: number;
  freePointSpend?: number;
  apiCostKrw?: number;
  actualMargin?: number | null;
  actualExact?: boolean;
  representativeStatus?: "healthy" | "below_floor" | "blocked" | "unavailable";
  freshness?: "FRESH" | "STALE" | "ABSENT";
  floor?: number;
  attribution?: ModelDirectCostAttribution;
}): MainRpPricingObservabilityProjection {
  return {
    generatedAt: "2026-10-01T00:00:00.000Z",
    models: [
      {
        modelId: input?.modelId ?? ACTIVE,
        actual: {
          usageState: "HAS_ACTIVITY",
          paidRevenueKrw: input?.paidRevenueKrw ?? 1000,
          freePointSpend: input?.freePointSpend ?? 0,
          apiCostKrw: input?.apiCostKrw ?? 300,
          marginRate: input?.actualMargin ?? 0.7,
          realizedMarginExact: input?.actualExact ?? true,
          monthKey: "2026-10",
          ...(input?.attribution ? { directCostAttribution: input.attribution } : {}),
        },
        representative: {
          minimumMarginFloor: input?.floor ?? 0.5,
          status: input?.representativeStatus ?? "healthy",
          procurementCostFreshness: input?.freshness ?? "FRESH",
          representativeWorkloadLabel: "10k prompt / 2k output",
        },
      },
    ],
  } as unknown as MainRpPricingObservabilityProjection;
}

describe("finance anomaly radar", () => {
  it("stays healthy for matched reconciliation and healthy exact margin", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary({
        providerReconciliation: {
          status: "matched",
          unreconciledProviderMicroUsd: 0,
        },
      }),
      pricing: pricing(),
      now: new Date("2026-10-01T00:00:00.000Z"),
    });
    assert.equal(report.status, "HEALTHY");
    assert.deepEqual(report.anomalies, []);
  });

  it("does not re-raise historical month mismatch after a forward observation baseline", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary({
        providerReconciliation: {
          status: "mismatch",
          windowStart: "2026-10-01 00:00:00",
          windowEnd: "2026-11-01 00:00:00",
          dailyDeltaMicroUsd: 3_071_719,
          unreconciledProviderMicroUsd: 3_071_719,
          forwardAudit: {
            observedSince: "2026-10-03T12:00:00.000Z",
            observationSource: "first_successful_query",
            observationNote: "Key-rotation UTC is unproven.",
            fetchStatus: "ok",
            verificationStatus: "verified",
            requestCount: 0,
            settledCount: 0,
            pendingCount: 0,
            matchedLedgerCount: 0,
            unmatchedLedgerCount: 0,
            settledMicroUsd: 0,
            matchedSettledMicroUsd: 0,
            unmatchedSettledMicroUsd: 0,
            unverifiableTimestampCount: 0,
            unverifiableSettledCount: 0,
            byModel: {},
            distinctApiKeyIds: 0,
            otherApiKeyCandidate: false,
            havExclusiveCostConfirmed: false,
            productionKeyMapping: "unavailable",
            cases: ["zero_new_calls"],
          },
        },
      }),
      pricing: pricing(),
    });
    assert.equal(report.status, "HEALTHY");
    assert.equal(
      report.anomalies.some((row) => row.code === "PROVIDER_RECONCILIATION_MISMATCH"),
      false
    );
    assert.equal(
      report.anomalies.some((row) => row.code === "UNRECONCILED_PROVIDER_SPEND"),
      false
    );
  });

  it("warns only on new unmatched spend in the forward window", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary({
        providerReconciliation: {
          status: "mismatch",
          windowStart: "2026-10-01 00:00:00",
          windowEnd: "2026-11-01 00:00:00",
          dailyDeltaMicroUsd: 3_079_719,
          unreconciledProviderMicroUsd: 3_079_719,
          forwardAudit: {
            observedSince: "2026-10-03T12:00:00.000Z",
            observationSource: "first_successful_query",
            observationNote: "Key-rotation UTC is unproven.",
            fetchStatus: "ok",
            verificationStatus: "verified",
            requestCount: 1,
            settledCount: 1,
            pendingCount: 0,
            matchedLedgerCount: 0,
            unmatchedLedgerCount: 1,
            settledMicroUsd: 8_000,
            matchedSettledMicroUsd: 0,
            unmatchedSettledMicroUsd: 8_000,
            unverifiableTimestampCount: 0,
            unverifiableSettledCount: 0,
            byModel: {
              "gpt-6-luna": {
                settledCount: 1,
                unmatchedCount: 1,
                settledMicroUsd: 8_000,
                unmatchedMicroUsd: 8_000,
              },
            },
            distinctApiKeyIds: 1,
            otherApiKeyCandidate: false,
            havExclusiveCostConfirmed: false,
            productionKeyMapping: "unavailable",
            cases: ["unmatched_luna"],
          },
        },
      }),
      pricing: pricing(),
    });
    assert.equal(report.status, "WARNING");
    assert.equal(report.criticalCount, 0);
    assert.equal(report.anomalies.length, 1);
    assert.equal(report.anomalies[0]?.code, "FORWARD_UNMATCHED_REMOTE_SPEND");
    assert.match(report.anomalies[0]?.summary ?? "", /gpt-6-luna/);
    assert.match(report.anomalies[0]?.summary ?? "", /0\.008000 USD/);
    assert.match(report.anomalies[0]?.summary ?? "", /havExclusiveCostConfirmed=false/);
    assert.doesNotMatch(report.anomalies[0]?.summary ?? "", /3\.071719/);
  });

  it("does not report HEALTHY when forward timestamps are unverifiable", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary({
        providerReconciliation: {
          status: "mismatch",
          windowStart: "2026-10-01 00:00:00",
          windowEnd: "2026-11-01 00:00:00",
          dailyDeltaMicroUsd: 3_071_719,
          unreconciledProviderMicroUsd: 3_071_719,
          forwardAudit: {
            observedSince: "2026-10-03T12:00:00.000Z",
            observationSource: "first_successful_query",
            observationNote: "Key-rotation UTC is unproven.",
            fetchStatus: "ok",
            verificationStatus: "unverified",
            requestCount: 0,
            settledCount: 0,
            pendingCount: 0,
            matchedLedgerCount: 0,
            unmatchedLedgerCount: 0,
            settledMicroUsd: 0,
            matchedSettledMicroUsd: 0,
            unmatchedSettledMicroUsd: 0,
            unverifiableTimestampCount: 1,
            unverifiableSettledCount: 1,
            byModel: {},
            distinctApiKeyIds: 0,
            otherApiKeyCandidate: false,
            havExclusiveCostConfirmed: false,
            productionKeyMapping: "unavailable",
            cases: ["unverifiable_timestamp"],
          },
        },
      }),
      pricing: null,
    });
    assert.notEqual(report.status, "HEALTHY");
    assert.equal(report.criticalCount, 0);
    assert.ok(report.anomalies.some((row) => row.code === "FORWARD_RECON_UNVERIFIED"));
    assert.equal(
      report.anomalies.some((row) => row.code === "UNRECONCILED_PROVIDER_SPEND"),
      false
    );
    assert.equal(
      report.anomalies.some((row) => row.code === "FORWARD_UNMATCHED_REMOTE_SPEND"),
      false
    );
  });

  it("does not substitute a window or clear month residue when the cutoff env is invalid", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary({
        providerReconciliation: {
          status: "mismatch",
          windowStart: "2026-10-01 00:00:00",
          windowEnd: "2026-11-01 00:00:00",
          dailyDeltaMicroUsd: 3_071_719,
          unreconciledProviderMicroUsd: 3_071_719,
          forwardAudit: {
            observedSince: null,
            observationSource: null,
            observationNote: "Forward window is unverified; no substitute baseline was chosen.",
            fetchStatus: "ok",
            verificationStatus: "config_invalid",
            requestCount: 0,
            settledCount: 0,
            pendingCount: 0,
            matchedLedgerCount: 0,
            unmatchedLedgerCount: 0,
            settledMicroUsd: 0,
            matchedSettledMicroUsd: 0,
            unmatchedSettledMicroUsd: 0,
            unverifiableTimestampCount: 0,
            unverifiableSettledCount: 0,
            byModel: {},
            distinctApiKeyIds: 0,
            otherApiKeyCandidate: false,
            havExclusiveCostConfirmed: false,
            productionKeyMapping: "unavailable",
            cases: ["invalid_observed_since_env"],
          },
        },
      }),
      pricing: null,
    });
    assert.notEqual(report.status, "HEALTHY");
    assert.ok(report.anomalies.some((row) => row.code === "FORWARD_RECON_CONFIG_INVALID"));
    const raw = JSON.stringify(report);
    assert.equal(raw.includes("2026-10-03 08:15:00"), false);
  });

  it("flags a forward fetch failure without treating stale unmatched as new", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary({
        providerReconciliation: {
          status: "provider_unavailable",
          unreconciledProviderMicroUsd: 3_071_719,
          forwardAudit: {
            observedSince: "2026-10-03T12:00:00.000Z",
            observationSource: "stored_watermark",
            observationNote: "stored",
            fetchStatus: "http",
            verificationStatus: "fetch_failed",
            requestCount: 1,
            settledCount: 1,
            pendingCount: 0,
            matchedLedgerCount: 0,
            unmatchedLedgerCount: 1,
            settledMicroUsd: 8_000,
            matchedSettledMicroUsd: 0,
            unmatchedSettledMicroUsd: 8_000,
            byModel: {},
            distinctApiKeyIds: 0,
            otherApiKeyCandidate: false,
            havExclusiveCostConfirmed: false,
            productionKeyMapping: "unavailable",
            cases: ["fetch_failure"],
          },
        },
      }),
      pricing: null,
    });
    assert.deepEqual(
      report.anomalies.map((row) => row.code),
      ["FORWARD_RECON_FETCH_FAILURE"]
    );
  });

  it("flags provider checksum mismatch and unreconciled settled spend as critical", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary({
        providerReconciliation: {
          status: "mismatch",
          windowStart: "2026-10-01 00:00:00",
          windowEnd: "2026-11-01 00:00:00",
          dailyDeltaMicroUsd: 45,
          unreconciledProviderMicroUsd: 125000,
        },
      }),
      pricing: pricing(),
    });
    assert.equal(report.status, "CRITICAL");
    assert.equal(report.criticalCount, 2);
    assert.ok(report.anomalies.some((row) => row.code === "PROVIDER_RECONCILIATION_MISMATCH"));
    assert.ok(report.anomalies.some((row) => row.code === "UNRECONCILED_PROVIDER_SPEND"));
  });

  it("detects direct provider cost with zero paid/free billing for an active Main RP model", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({ paidRevenueKrw: 0, freePointSpend: 0, apiCostKrw: 700 }),
    });
    const anomaly = report.anomalies.find(
      (row) => row.code === "DIRECT_COST_WITHOUT_USER_BILLING"
    );
    assert.ok(anomaly);
    assert.equal(anomaly?.severity, "critical");
    assert.match(anomaly?.summary ?? "", /0P-style invariant breach/);
  });

  it("keeps a sub-1 KRW unlinked user cost visible as a billing miss", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        paidRevenueKrw: 0,
        freePointSpend: 0,
        apiCostKrw: 0.4,
        attribution: {
          platformFundedKrw: 0,
          userFundedChargedKrw: 0,
          userFundedWaivedKrw: 0,
          userFundedRefundedKrw: 0,
          userFundedUnderRecoveredKrw: 0,
          userFundedUnlinkedKrw: 0.4,
          unknownKrw: 0,
        },
      }),
    });
    const anomaly = report.anomalies.find(
      (row) => row.code === "DIRECT_COST_WITHOUT_USER_BILLING"
    );
    assert.equal(anomaly?.severity, "critical");
    assert.match(anomaly?.summary ?? "", /0\.4 KRW/);
    assert.doesNotMatch(anomaly?.summary ?? "", / 0 KRW/);
  });

  it("raises a dedicated critical under-recovered charge without double-counting a billing miss", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        paidRevenueKrw: 0,
        freePointSpend: 0,
        apiCostKrw: 12,
        attribution: {
          platformFundedKrw: 0,
          userFundedChargedKrw: 0,
          userFundedWaivedKrw: 0,
          userFundedRefundedKrw: 0,
          userFundedUnderRecoveredKrw: 12,
          userFundedUnlinkedKrw: 0,
          unknownKrw: 0,
        },
      }),
    });
    const under = report.anomalies.filter((row) => row.code === "UNDER_RECOVERED_USER_CHARGE");
    assert.equal(under.length, 1);
    assert.equal(under[0]?.severity, "critical");
    assert.equal(report.status, "CRITICAL");
    assert.equal(
      report.anomalies.some((row) => row.code === "DIRECT_COST_WITHOUT_USER_BILLING"),
      false
    );
    assert.equal(
      report.anomalies.some((row) => row.code === "UNATTRIBUTED_DIRECT_COST"),
      false
    );
    assert.match(under[0]?.summary ?? "", /12 KRW/);
    assert.match(under[0]?.summary ?? "", /under-recovered/);
  });

  it("keeps unlinked and under-recovered as distinct signals without summing the same KRW twice", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        paidRevenueKrw: 0,
        freePointSpend: 0,
        apiCostKrw: 30,
        attribution: {
          platformFundedKrw: 0,
          userFundedChargedKrw: 0,
          userFundedWaivedKrw: 0,
          userFundedRefundedKrw: 0,
          userFundedUnderRecoveredKrw: 10,
          userFundedUnlinkedKrw: 20,
          unknownKrw: 0,
        },
      }),
    });
    const under = report.anomalies.find((row) => row.code === "UNDER_RECOVERED_USER_CHARGE");
    const miss = report.anomalies.find((row) => row.code === "DIRECT_COST_WITHOUT_USER_BILLING");
    assert.equal(under?.severity, "critical");
    assert.equal(miss?.severity, "critical");
    assert.match(under?.summary ?? "", /10 KRW/);
    assert.match(miss?.summary ?? "", /20 KRW/);
    assert.doesNotMatch(under?.summary ?? "", /30 KRW/);
    assert.doesNotMatch(miss?.summary ?? "", /30 KRW/);
    assert.equal(
      report.anomalies.filter((row) =>
        row.code === "UNDER_RECOVERED_USER_CHARGE" ||
        row.code === "DIRECT_COST_WITHOUT_USER_BILLING"
      ).length,
      2
    );
  });

  it("does not call platform, waived, refunded, or under-recovered cost a billing miss", () => {
    const base = {
      platformFundedKrw: 1,
      userFundedChargedKrw: 0,
      userFundedWaivedKrw: 0,
      userFundedRefundedKrw: 0,
      userFundedUnderRecoveredKrw: 0,
      userFundedUnlinkedKrw: 0,
      unknownKrw: 0,
    };
    for (const attribution of [
      base,
      { ...base, platformFundedKrw: 0, userFundedWaivedKrw: 12 },
      { ...base, platformFundedKrw: 0, userFundedRefundedKrw: 12 },
      { ...base, platformFundedKrw: 0, userFundedUnderRecoveredKrw: 12 },
    ]) {
      const report = buildFinanceAnomalyReport({
        summary: summary(),
        pricing: pricing({
          paidRevenueKrw: 0,
          freePointSpend: 0,
          apiCostKrw: 12,
          attribution,
        }),
      });
      assert.equal(
        report.anomalies.some((row) => row.code === "DIRECT_COST_WITHOUT_USER_BILLING"),
        false
      );
      assert.equal(
        report.anomalies.some((row) => row.code === "UNDER_RECOVERED_USER_CHARGE"),
        attribution.userFundedUnderRecoveredKrw > 0
      );
    }
  });

  it("warns when cost linkage is unknown and does not hide an unlinked miss behind it", () => {
    const unknown = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        paidRevenueKrw: 0,
        freePointSpend: 0,
        apiCostKrw: 3,
        attribution: {
          platformFundedKrw: 1,
          userFundedChargedKrw: 0,
          userFundedWaivedKrw: 0,
          userFundedRefundedKrw: 0,
          userFundedUnderRecoveredKrw: 0,
          userFundedUnlinkedKrw: 0,
          unknownKrw: 2,
        },
      }),
    });
    assert.equal(unknown.status, "WARNING");
    assert.equal(
      unknown.anomalies.some((row) => row.code === "UNATTRIBUTED_DIRECT_COST"),
      true
    );
    assert.equal(
      unknown.anomalies.some((row) => row.code === "DIRECT_COST_WITHOUT_USER_BILLING"),
      false
    );

    const mixed = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        paidRevenueKrw: 0,
        freePointSpend: 0,
        apiCostKrw: 11,
        attribution: {
          platformFundedKrw: 1,
          userFundedChargedKrw: 0,
          userFundedWaivedKrw: 0,
          userFundedRefundedKrw: 0,
          userFundedUnderRecoveredKrw: 0,
          userFundedUnlinkedKrw: 10,
          unknownKrw: 0,
        },
      }),
    });
    assert.equal(mixed.status, "CRITICAL");
    assert.equal(
      mixed.anomalies.some((row) => row.code === "DIRECT_COST_WITHOUT_USER_BILLING"),
      true
    );
  });

  it("flags Opus actual margin below the published 30% floor on the canonical radar path", () => {
    const floor = getPublishedPricing(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL).minimumMarginFloor;
    assert.equal(floor, 0.3);
    const report = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        actualMargin: 0.25,
        actualExact: true,
        floor,
        paidRevenueKrw: 1000,
        apiCostKrw: 750,
      }),
    });
    const anomaly = report.anomalies.find((row) => row.code === "ACTUAL_MARGIN_BELOW_FLOOR");
    assert.ok(anomaly);
    assert.equal(anomaly?.modelId, CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    assert.match(anomaly?.summary ?? "", /30\.0%/);
  });

  it("treats exact actual margin-floor breach as critical and suppresses the weaker representative warning", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        actualMargin: 0.42,
        actualExact: true,
        floor: 0.5,
        representativeStatus: "below_floor",
        freshness: "FRESH",
      }),
    });
    assert.equal(report.criticalCount, 1);
    assert.ok(report.anomalies.some((row) => row.code === "ACTUAL_MARGIN_BELOW_FLOOR"));
    assert.equal(
      report.anomalies.some((row) => row.code === "REPRESENTATIVE_MARGIN_BELOW_FLOOR"),
      false
    );
  });

  it("uses fresh representative below-floor evidence as warning when exact production margin is unavailable", () => {
    const report = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        actualMargin: null,
        actualExact: false,
        representativeStatus: "below_floor",
        freshness: "FRESH",
      }),
    });
    assert.equal(report.status, "WARNING");
    assert.ok(
      report.anomalies.some((row) => row.code === "REPRESENTATIVE_MARGIN_BELOW_FLOOR")
    );
  });

  it("ignores retired/non-active model rows and stale representative procurement evidence", () => {
    const retired = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        modelId: "retired-model-fixture",
        paidRevenueKrw: 0,
        freePointSpend: 0,
        apiCostKrw: 999,
        representativeStatus: "below_floor",
      }),
    });
    assert.deepEqual(retired.anomalies, []);

    const stale = buildFinanceAnomalyReport({
      summary: summary(),
      pricing: pricing({
        actualMargin: null,
        actualExact: false,
        representativeStatus: "below_floor",
        freshness: "STALE",
      }),
    });
    assert.equal(
      stale.anomalies.some((row) => row.code === "REPRESENTATIVE_MARGIN_BELOW_FLOOR"),
      false
    );
  });
});
