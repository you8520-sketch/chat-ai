import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import Database from "better-sqlite3";
import {
  applyFinalUserChargeToUsage,
  buildUsageBillingContractAdmin,
  evaluateFinalChargeConsistency,
  persistAssistantMessageFinalCharge,
  sumDeductionSliceAmounts,
} from "@/lib/chatBillingFinalCharge";
import {
  AUDIT_FX_SNAPSHOT,
  buildBillingLiveOwnerReadinessFixtures,
  computeLiveChargeFromFixture,
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
} from "@/lib/billingLiveOwnerReadinessAudit";
import { resolveChatBillingContract } from "@/lib/chatBillingContractDispatch";
import { buildAdminBillingReceiptV2 } from "@/lib/adminBillingReceiptV2";
import {
  auditAdminFinanceCostScope,
  adminFinanceRealizedMarginReady,
} from "@/lib/adminFinanceCostScopeAudit";
import { omitInternalTopLevelUsageFields } from "@/lib/publicUsageEconomicsBoundary";
import type { Usage } from "@/lib/chatUsage";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      usage TEXT,
      deduction_slices TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_refunded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE chat_billing_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      charge_kind TEXT NOT NULL,
      assistant_message_id INTEGER,
      requested_points INTEGER NOT NULL,
      settled_points INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      deduction_slices_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(user_id, chat_id, request_id, charge_kind)
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      paid_points REAL NOT NULL DEFAULT 1000,
      free_points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare("INSERT INTO users (id, paid_points) VALUES (1, 1000)").run();
  return db;
}

describe("chatBillingFinalCharge — canonical final charge invariants", () => {
  it("evaluateFinalChargeConsistency requires settlement=usage=slices", () => {
    const snapshot = evaluateFinalChargeConsistency({
      finalUserChargePoints: 115,
      settledDeductionPoints: 115,
      usageCostPoints: 115,
      deductionSlices: [{ pointType: "PAID", amount: 115 }],
    });
    assert.equal(snapshot.consistent, true);
    assert.equal(snapshot.violations.length, 0);
  });

  it("applyFinalUserChargeToUsage sets cost to settled points without overwriting baseCost", () => {
    const usage: Usage = {
      input: 100,
      output: 50,
      model: "claude-opus-5",
      route: "safe",
      cost: 999,
      baseCost: 80,
      breakdown: [],
    };
    const patched = applyFinalUserChargeToUsage(usage, 115, {
      billingContract: "legacy",
      billingContractReason: "phase1_billing_disabled",
      deliveredModelId: "claude-opus-5",
      publishedCandidateStatus: "not_attempted",
      publishedBlockReason: null,
      pricingVersion: null,
      publishedFinalPoints: null,
      legacyFinalPoints: 115,
      settledDeductedPoints: 115,
    });
    assert.equal(patched.cost, 115);
    assert.equal(patched.baseCost, 80);
    assert.equal(patched.billingContractDispatch?.settledDeductedPoints, 115);
  });

  it("persistAssistantMessageFinalCharge aligns usage.cost with settlement slices", () => {
    const db = openTestDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, request_id, usage, deduction_slices)
       VALUES (1, 10, 'assistant', 'req-1', ?, ?)`
    ).run(
      JSON.stringify({
        input: 1,
        output: 1,
        model: "gemini-3.7-flash",
        route: "safe",
        cost: 50,
        breakdown: [],
      }),
      JSON.stringify([{ pointType: "PAID", amount: 115 }])
    );
    const consistency = persistAssistantMessageFinalCharge(db, {
      assistantMessageId: 1,
      chatId: 10,
      requestId: "req-1",
      settledPoints: 115,
      slices: [{ pointType: "PAID", amount: 115 }],
      billingContractDispatch: {
        billingContract: "published_phase1",
        billingContractReason: "phase1_live_grade",
        deliveredModelId: "gemini-3.7-flash",
        publishedCandidateStatus: "resolved",
        publishedBlockReason: null,
        pricingVersion: 2,
        publishedFinalPoints: 115,
        legacyFinalPoints: 100,
        settledDeductedPoints: 115,
      },
    });
    assert.equal(consistency.consistent, true);
    const row = db
      .prepare("SELECT usage, deduction_slices FROM messages WHERE id=1")
      .get() as { usage: string; deduction_slices: string };
    const usage = JSON.parse(row.usage) as Usage;
    assert.equal(usage.cost, 115);
    assert.equal(sumDeductionSliceAmounts(JSON.parse(row.deduction_slices)), 115);
    assert.equal(usage.billingContractDispatch?.billingContract, "published_phase1");
  });

  it("Admin Receipt deductedPoints uses usage.cost (settled), not published standard charge", () => {
    const usage: Usage = {
      input: 9000,
      output: 500,
      model: "claude-opus-5",
      route: "safe",
      cost: 98,
      breakdown: [],
      shadowPricing: {
        pricingVersion: 2,
        billingReferenceInputUsdPerMillion: 5,
        billingReferenceOutputUsdPerMillion: 25,
        billingReferenceCostKrw: 100,
        billingReferenceCostUsd: 0.1,
        fxSnapshot: {
          dateKey: "2026-08-28",
          source: "api_daily",
          baseUsdKrw: 1530,
          overseasFeeRate: 0.02,
          effectiveKrwPerUsd: 1560.6,
        },
        providerListCostStatus: "available",
        reserveStatus: "none",
        actualProviderCostKrw: 80,
        actualCostSource: "provider_reported",
        providerListCostKrw: 80,
        inputCostKrw: 40,
        outputCostKrw: 40,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.08,
        minimumMarginFloor: 0.05,
        standardUserChargeKrw: 200,
        promoPercent: 0,
        finalShadowChargeKrw: 200,
        finalShadowPoints: 200,
        providerSavingsKrw: null,
        providerOverrunKrw: null,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: null,
        actualGrossProfitKrw: 18,
        actualRealizedMargin: 0.2,
        worstCasePromoMargin: null,
        marginFloorViolated: null,
      },
      billingContractDispatch: {
        billingContract: "published_phase1",
        billingContractReason: "phase1_live_grade",
        deliveredModelId: "claude-opus-5",
        publishedCandidateStatus: "resolved",
        publishedBlockReason: null,
        pricingVersion: 2,
        publishedFinalPoints: 98,
        legacyFinalPoints: 115,
        settledDeductedPoints: 98,
      },
    };
    const receipt = buildAdminBillingReceiptV2(usage);
    assert.equal(receipt.userCharge.deductedPoints, 98);
    assert.equal(receipt.userCharge.billingContract, "published_phase1");
    assert.equal(receipt.userCharge.publishedFinalPoints, 98);
    assert.notEqual(receipt.mainRp.publishedPricing?.standardUserChargeKrw, receipt.userCharge.deductedPoints);
  });

  it("public receipt strips billingContractDispatch admin metadata", () => {
    const usage: Usage = {
      input: 1,
      output: 1,
      model: "x",
      route: "safe",
      cost: 10,
      breakdown: [],
      billingContractDispatch: {
        billingContract: "legacy",
        billingContractReason: "non_phase1_model",
        deliveredModelId: "deepseek-v4-pro-0813",
        publishedCandidateStatus: "not_attempted",
        publishedBlockReason: null,
        pricingVersion: null,
        publishedFinalPoints: null,
        legacyFinalPoints: 10,
        settledDeductedPoints: 10,
      },
    };
    const pub = omitInternalTopLevelUsageFields(usage);
    assert.equal(pub.billingContractDispatch, undefined);
    assert.equal(pub.cost, 10);
  });
});

describe("chatBillingFinalCharge — published vs legacy fixture receipt parity", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  for (const fixtureId of ["B2-cache-valid-zero", "B3-cache-valid-positive", "B1-cache-unreported"] as const) {
    it(`${fixtureId} dispatcher points drive settled usage.cost`, () => {
      const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === fixtureId)!;
      const legacyPoints = computeLiveChargeFromFixture(fixture).totalPoints;
      const decision = resolveChatBillingContract({
        deliveredModelId: fixture.deliveredModelId,
        stages: fixture.stages,
        legacyFinalPoints: legacyPoints,
        billingWaiverReason: null,
        legacyWaiverMinimum: 0,
        fxSnapshot: AUDIT_FX_SNAPSHOT,
        phase1PublishedBillingEnabled: true,
      });
      const settledPoints = decision.points;
      const admin = buildUsageBillingContractAdmin(decision, settledPoints, legacyPoints);
      const usage = applyFinalUserChargeToUsage(
        {
          input: 1,
          output: 1,
          model: fixture.deliveredModelId,
          route: "safe",
          cost: settledPoints,
          breakdown: [],
        },
        settledPoints,
        admin
      );
      const receipt = buildAdminBillingReceiptV2(usage);
      assert.equal(receipt.userCharge.deductedPoints, settledPoints);
    });
  }
});

describe("adminFinanceCostScopeAudit", () => {
  it("Finance revenue owner is deduction_slices not recomputed price", () => {
    const audit = auditAdminFinanceCostScope();
    assert.equal(audit.ADMIN_FINANCE_RECOMPUTES_USER_PRICE, false);
    assert.equal(audit.TARGET_MARGIN_USED_AS_REALIZED_MARGIN, false);
    assert.match(audit.ADMIN_FINANCE_REVENUE_OWNER, /deduction_slices/);
    assert.equal(audit.ADMIN_FINANCE_MISSING_COST_FAMILIES.length, 0);
    assert.equal(audit.ADMIN_FINANCE_DOUBLE_COUNTED_COST_FAMILIES.length, 0);
    assert.equal(audit.STATUS_WIDGET_EXTRACT_DOUBLE_COUNT, false);
    assert.equal(adminFinanceRealizedMarginReady(audit), "YES");
  });

  it("published_phase2 admin sets publishedFinalPoints", () => {
    const decision = resolveChatBillingContract({
      deliveredModelId: "deepseek-v4-pro-0813",
      stages: [
        {
          stage: "primary",
          model: "deepseek-v4-pro-0813",
          input: 33247,
          output: 3461,
          apiOutputTokens: 3461,
          apiReportedInputTokens: 33247,
          cacheReadTokens: 0,
          estimated: false,
          usageReportingEvidence: {
            cacheRead: "reported_valid",
            cacheWrite: "unreported",
            reasoning: "reported_valid",
          },
        },
      ],
      legacyFinalPoints: 65,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: AUDIT_FX_SNAPSHOT,
      phase1PublishedBillingEnabled: false,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "published_phase2");
    const admin = buildUsageBillingContractAdmin(decision, decision.points, 65);
    assert.equal(admin.publishedFinalPoints, decision.points);
    assert.equal(admin.billingContract, "published_phase2");
  });

  it("paid revenue aggregates deduction slice amounts (Finance owner contract)", () => {
    const slices = [
      { pointType: "PAID" as const, amount: 80 },
      { pointType: "FREE" as const, amount: 20 },
    ];
    const totals = sumDeductionSliceAmounts(slices);
    assert.equal(totals, 100);
    assert.equal(
      slices
        .filter((s) => s.pointType === "PAID")
        .reduce((sum, s) => sum + (s.amount ?? 0), 0),
      80
    );
  });
});
