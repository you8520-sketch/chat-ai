import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  assessGemini31Above200kReachability,
  assessGemini31CacheReachability,
  assessGemini37CacheReachability,
  assessOpusCacheReachability,
  auditBillingOwnersFromSource,
  auditIdempotencyFromSource,
  buildCurrentProductReadinessMatrix,
  buildLiveBillingCutoverAuditReport,
  classifyModelCutoverReadiness,
  computeMigrationDeltaRows,
  computeSafestFirstCutoverModel,
  countPublicReceiptInternalLeakPaths,
  evaluateLiveBillingCutoverReadiness,
  EXPECTED_MODEL_CUTOVER_CLASS,
  GEMINI31_MODEL_ID,
  OPUS5_MODEL_ID,
  verifyFxReadOnlyPreviewPath,
  verifyKstMidnightBoundary,
  verifyModelAliasResolvesToSinglePublishedPolicy,
  verifyReasoningNotDoubleCounted,
} from "./liveBillingCutoverReadiness";
import { deductPointsOnDb } from "./points";
import { findTurnByRequestId } from "./streamingPersistence";
import { evaluatePremiumPricingGates } from "./premiumPricingCalibration";
import {
  clearCheaperInferenceCatalogPricingForTest,
  resolveCheaperInferenceCatalogPricing,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "./cheaperInferenceCatalogPricing";
import {
  _clearShadowBillingFxMemoryForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
  peekShadowBillingFxDailySnapshot,
  previewShadowBillingFxSnapshot,
} from "./shadowBillingExchangeRate";
import {
  countAllShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
} from "./shadowBillingFxPersistence";
import { computeShadowPricing } from "./shadowPricing";
import { GEMINI31_BASE_TIER_PROMPT_THRESHOLD } from "./premiumModelIds";
import { parseCatalogPricing } from "./cheaperInferenceCatalogPricing.server";
import { GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE } from "./fixtures/cheaperInferenceGemini31TierCatalog.fixture";
import { _insertShadowBillingFxDailyRowForTest } from "./shadowBillingExchangeRate";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function createConcurrentIdempotencyDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      message_id INTEGER,
      chat_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      deduction_slices TEXT,
      generation_status TEXT,
      user_message_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_messages_chat_request_id ON messages(chat_id, request_id);
    INSERT INTO users (id, points) VALUES (1, 10000);
    INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
      VALUES (1, 'PAID', 10000, '2030-01-01');
  `);
  return db;
}

describe("liveBillingCutoverReadiness — production boundary", () => {
  it("readiness module has no deductPoints, ForTest, or computeShadowPricing imports", () => {
    const src = readFileSync(join(REPO_ROOT, "src/lib/liveBillingCutoverReadiness.ts"), "utf8");
    const importLines = src.split("\n").filter((line) => line.trimStart().startsWith("import "));
    assert.ok(importLines.every((line) => !line.includes("deductPoints")));
    assert.ok(importLines.every((line) => !line.includes("ForTest")));
    assert.ok(importLines.every((line) => !line.includes("computeShadowPricing")));
    assert.ok(importLines.every((line) => !line.includes("resolveShadowBillingExchangeRateSnapshot")));
    const withoutOwnerAudit = src.replace(/export const LIVE_BILLING_OWNER_AUDIT[\s\S]*?} as const;/, "");
    assert.ok(!/\bdeductPoints\s*\(/.test(withoutOwnerAudit));
  });

  it("owner audit is source-backed, not self-assertion only", () => {
    const audit = auditBillingOwnersFromSource();
    assert.equal(audit.ownerAuditSelfAssertionOnly, false);
    assert.equal(audit.chatRouteComputeTurnBillingImport, "@/lib/points");
    assert.equal(audit.chatRouteDeductPointsImport, "@/lib/points");
    assert.equal(audit.canonicalComputeTurnBillingDefinition, "src/lib/points.ts");
    assert.ok(audit.chatRouteComputeTurnBillingOwner.includes("pointsReasoningMargins.ts"));
    assert.ok(audit.otherComputeTurnBillingDefinitions.includes("src/lib/pointsReasoningMargins.ts"));
    assert.ok(audit.otherComputeTurnBillingDefinitions.includes("src/lib/pointsMuse60.ts"));
    assert.equal(audit.otherDefinitionReachableFromChatRoute, true);
    assert.equal(audit.chatRouteDeductionCallCount, 1);
    assert.equal(audit.publishedPricingLiveDeductionCalls, 0);
    assert.equal(audit.currentDeductionOwnerCount, 1);
  });

  it("idempotency audit documents missing DB uniqueness guard", () => {
    const audit = auditIdempotencyFromSource();
    assert.equal(audit.dbEnforcedRequestIdempotency, "documented");
    assert.equal(audit.dbUniquenessGuardPresent, false);
    assert.equal(audit.ledgerIdempotencyUniqueKey, "none");
    assert.equal(audit.duplicateRequestDoubleChargePossible, "reproduced_risk");
    assert.equal(audit.scenarios.multiWorkerConcurrentDuplicate, "reproduced_risk");
    assert.equal(audit.scenarios.singleProcessSequentialDuplicate, "documented");
  });
});

describe("liveBillingCutoverReadiness — reachability", () => {
  it("Gemini31 >200k reachability is UNKNOWN without hard provider cap", () => {
    const a = assessGemini31Above200kReachability();
    assert.equal(a.productReachability, "unknown");
    assert.equal(a.effectiveCurrentProductBlocker, "unknown");
    assert.equal(a.pricingCoverage, "unsupported");
    assert.equal(a.readinessCell, "UNKNOWN");
  });

  it("Gemini31/G37 cache reachability is UNKNOWN without production-path proof", () => {
    const g31 = assessGemini31CacheReachability();
    const g37 = assessGemini37CacheReachability();
    assert.equal(g31.productReachability, "unknown");
    assert.equal(g31.readinessCell, "UNKNOWN");
    assert.equal(g37.productReachability, "unknown");
    assert.equal(g37.readinessCell, "UNKNOWN");
  });

  it("Opus5 cache reachability is REACHABLE with end-to-end evidence chain", () => {
    const opus = assessOpusCacheReachability();
    assert.equal(opus.productReachability, "reachable");
    assert.equal(opus.readinessCell, "READY");
    assert.ok(opus.evidenceChain.some((line) => line.includes("cache_control")));
  });

  it("Gemini31 tier boundary shadow invariants retained", () => {
    const db = new Database(":memory:");
    ensureShadowBillingFxTables(db);
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    _insertShadowBillingFxDailyRowForTest({ dateKey: "2026-08-28", baseUsdKrw: 1530, source: "api_daily" });
    try {
      const at200k = computeShadowPricing({
        modelId: GEMINI31_MODEL_ID,
        promptTokens: GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
        outputTokens: 100,
      });
      const above = computeShadowPricing({
        modelId: GEMINI31_MODEL_ID,
        promptTokens: GEMINI31_BASE_TIER_PROMPT_THRESHOLD + 1,
        outputTokens: 100,
      });
      assert.equal(at200k.billingReferenceCostStatus, "complete");
      assert.equal(above.billingReferenceCostStatus, "unsupported_pricing_tier");
    } finally {
      _setShadowBillingFxTestDb(null);
      _clearShadowBillingFxMemoryForTest();
      _setShadowBillingFxKstNowForTest(null);
      db.close();
    }
  });
});

describe("liveBillingCutoverReadiness — migration delta @1530", () => {
  it("golden planned and legacy Published fixtures", () => {
    const rows = computeMigrationDeltaRows();
    const g37a = rows.find((r) => r.benchmarkId === "gemini37_competitor_a")!;
    const g37b = rows.find((r) => r.benchmarkId === "gemini37_competitor_b")!;
    const g31 = rows.find((r) => r.benchmarkId === "gemini31_competitor_a")!;
    const opus = rows.find((r) => r.benchmarkId === "opus5_competitor_a")!;

    assert.equal(g37a.plannedPublishedFinalPoints, 48);
    assert.equal(g37b.plannedPublishedFinalPoints, 80);
    assert.equal(g31.plannedPublishedFinalPoints, 229);
    assert.equal(opus.plannedPublishedFinalPoints, 695);
    assert.equal(g37a.legacyFinalPoints, 35);
    assert.equal(g37b.legacyFinalPoints, 62);
    assert.equal(g31.legacyFinalPoints, 286);
    assert.equal(opus.legacyFinalPoints, 798);
  });
});

describe("liveBillingCutoverReadiness — idempotency concurrency", () => {
  it("concurrent duplicate charge can commit twice without DB uniqueness guard", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-audit-"));
    const dbPath = join(dir, "test.db");
    try {
      const db1 = createConcurrentIdempotencyDb(dbPath);
      const db2 = new Database(dbPath);
      db2.pragma("journal_mode = WAL");

      db1
        .prepare(
          `INSERT INTO messages (chat_id, role, content, request_id, deduction_slices, generation_status)
           VALUES (?, 'assistant', ?, ?, NULL, 'complete')`
        )
        .run(1, "answer", "req_concurrent_1");

      const read1 = findTurnByRequestId(db1, 1, "req_concurrent_1");
      const read2 = findTurnByRequestId(db2, 1, "req_concurrent_1");
      assert.equal(read1.alreadyBilled, false);
      assert.equal(read2.alreadyBilled, false);

      deductPointsOnDb(db1, 1, 100, "worker A charge", { messageId: read1.assistantMessageId!, chatId: 1 });
      deductPointsOnDb(db2, 1, 100, "worker B charge", { messageId: read2.assistantMessageId!, chatId: 1 });

      const logCount = (
        db1.prepare(`SELECT COUNT(*) AS c FROM point_logs WHERE user_id=1 AND delta<0`).get() as { c: number }
      ).c;
      assert.equal(logCount, 2);

      db1.close();
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("liveBillingCutoverReadiness — usage / receipt / FX", () => {
  it("reasoning is not double-counted in billable output", () => {
    assert.equal(verifyReasoningNotDoubleCounted(), true);
  });

  it("model alias resolves to single Published policy", () => {
    assert.equal(verifyModelAliasResolvesToSinglePublishedPolicy(), true);
  });

  it("public receipt sanitize removes internal economics", () => {
    assert.equal(countPublicReceiptInternalLeakPaths(), 0);
  });

  it("KST midnight boundary", () => {
    assert.equal(verifyKstMidnightBoundary(), true);
  });

  it("readiness diagnostics use read-only FX preview only", () => {
    const db = new Database(":memory:");
    ensureShadowBillingFxTables(db);
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    try {
      assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
      verifyFxReadOnlyPreviewPath();
      evaluateLiveBillingCutoverReadiness("test-sha");
      evaluatePremiumPricingGates();
      peekShadowBillingFxDailySnapshot();
      previewShadowBillingFxSnapshot();
      assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
    } finally {
      _setShadowBillingFxTestDb(null);
      _clearShadowBillingFxMemoryForTest();
      _setShadowBillingFxKstNowForTest(null);
      db.close();
    }
  });

  it("readiness diagnostics do not mutate CI catalog cache", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const sentinel: CheaperInferenceCatalogPricing = {
      modelId: "sentinel-readiness-catalog",
      inputUsdPerMillion: 3.141592,
      outputUsdPerMillion: 2.718281,
      cacheReadUsdPerMillion: 0.314159,
      cacheWriteUsdPerMillion: 3.141592,
      fetchedAt: 1_700_000_000_000,
    };
    const parsed = parseCatalogPricing(GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE, Date.now());
    if (parsed) updateCheaperInferenceCatalogPricing(parsed);
    updateCheaperInferenceCatalogPricing(sentinel);
    const before = JSON.stringify([
      resolveCheaperInferenceCatalogPricing(GEMINI31_MODEL_ID),
      resolveCheaperInferenceCatalogPricing(sentinel.modelId),
    ]);
    evaluateLiveBillingCutoverReadiness("test-sha");
    const after = JSON.stringify([
      resolveCheaperInferenceCatalogPricing(GEMINI31_MODEL_ID),
      resolveCheaperInferenceCatalogPricing(sentinel.modelId),
    ]);
    assert.equal(before, after);
    clearCheaperInferenceCatalogPricingForTest();
  });

  it("FX audit separates shadow contract from future Published live contract", () => {
    const report = buildLiveBillingCutoverAuditReport("test-sha");
    assert.equal(report.fx.shadowOneTurnOneFxSnapshot, "verified");
    assert.equal(report.fx.shadowAdminReadCanLockFx, "verified");
    assert.equal(report.fx.futurePublishedOneTurnOneFxSnapshot, "not_implemented");
  });
});

describe("liveBillingCutoverReadiness — matrix and classification", () => {
  it("readiness matrix cache cells match evidence", () => {
    const matrix = buildCurrentProductReadinessMatrix();
    assert.equal(matrix["gemini-3.7-flash"]!["Cache read"], "UNKNOWN");
    assert.equal(matrix["gemini-3.7-flash"]!["Cache write"], "UNKNOWN");
    assert.equal(matrix["gemini-3.7-flash"]!["Above pricing threshold"], "NOT_APPLICABLE");
    assert.equal(matrix[GEMINI31_MODEL_ID]!["Cache read"], "UNKNOWN");
    assert.equal(matrix[GEMINI31_MODEL_ID]!["Above pricing threshold"], "UNKNOWN");
    assert.equal(matrix[OPUS5_MODEL_ID]!["Cache read"], "READY");
    assert.equal(matrix[OPUS5_MODEL_ID]!["Above pricing threshold"], "NOT_APPLICABLE");
  });

  it("exact model classifications match runtime and expected constants", () => {
    assert.equal(classifyModelCutoverReadiness("gemini-3.7-flash"), EXPECTED_MODEL_CUTOVER_CLASS["gemini-3.7-flash"]);
    assert.equal(classifyModelCutoverReadiness(GEMINI31_MODEL_ID), EXPECTED_MODEL_CUTOVER_CLASS[GEMINI31_MODEL_ID]);
    assert.equal(classifyModelCutoverReadiness(OPUS5_MODEL_ID), EXPECTED_MODEL_CUTOVER_CLASS[OPUS5_MODEL_ID]);
    assert.equal(EXPECTED_MODEL_CUTOVER_CLASS["gemini-3.7-flash"], "D");
    assert.equal(EXPECTED_MODEL_CUTOVER_CLASS[GEMINI31_MODEL_ID], "D");
    assert.equal(EXPECTED_MODEL_CUTOVER_CLASS[OPUS5_MODEL_ID], "B");
  });

  it("report classification matches runtime classification", () => {
    const report = buildLiveBillingCutoverAuditReport("test-sha");
    assert.equal(report.classification["gemini-3.7-flash"], classifyModelCutoverReadiness("gemini-3.7-flash"));
    assert.equal(report.classification[GEMINI31_MODEL_ID], classifyModelCutoverReadiness(GEMINI31_MODEL_ID));
    assert.equal(report.classification[OPUS5_MODEL_ID], classifyModelCutoverReadiness(OPUS5_MODEL_ID));
  });

  it("safest-first is recomputed from classification, not hardcoded G37", () => {
    const report = buildLiveBillingCutoverAuditReport("test-sha");
    const safest = computeSafestFirstCutoverModel(report.classification);
    assert.equal(report.safestFirstCutoverModel, safest.model);
    assert.equal(safest.model, OPUS5_MODEL_ID);
    assert.equal(safest.undecided, false);
  });

  it("audit report enumerates cutover blockers with origin", () => {
    const report = buildLiveBillingCutoverAuditReport("test-sha");
    assert.ok(report.cutoverBlockers.length >= 3);
    assert.ok(report.cutoverBlockers.some((b) => b.origin === "existing_production"));
    assert.ok(report.cutoverBlockers.some((b) => b.origin === "cutover_required"));
    assert.equal(report.receipt.publicReceiptInternalLeakPaths, 0);
    assert.equal(report.idempotency.dbUniquenessGuardPresent, false);
    assert.equal(report.pureLiveChargeEngineExtractionRequired, true);
    assert.equal(report.billingOwnerAudit.canonicalComputeTurnBillingDefinition, "src/lib/points.ts");
  });
});
