import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AdminFinanceSummary } from "@/lib/adminFinance";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { buildFinanceAnomalyReport } from "@/lib/financeAnomalyRadar";
import type { MainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";

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
