import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it, beforeEach, afterEach } from "node:test";
import { getKstDateKey } from "./exchangeRate";
import {
  countAllShadowBillingFxDailySnapshots,
  countShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
  readShadowBillingFxDailySnapshot,
} from "./shadowBillingFxPersistence";
import {
  getShadowBillingFxCacheStatus,
  previewShadowBillingFxSnapshot,
  resolveShadowBillingExchangeRateSnapshot,
  SHADOW_BILLING_EMERGENCY_FX_KRW,
  SHADOW_BILLING_FX_MODE,
  warmShadowBillingFxPrefetch,
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxPrefetchedCandidateForTest,
  _setShadowBillingFxTestDb,
  _simulateShadowBillingFxBackgroundFetchForTest,
} from "./shadowBillingExchangeRate";
import { simulatePremiumCompetitive as adminSimulate } from "./shadowSimulations";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  ensureShadowBillingFxTables(db);
  return db;
}

describe("shadow billing FX KST boundaries", () => {
  it("UTC 14:59:59 maps to prior KST date", () => {
    assert.equal(getKstDateKey(Date.parse("2026-08-27T14:59:59.000Z")), "2026-08-27");
  });

  it("UTC 15:00:00 maps to next KST date", () => {
    assert.equal(getKstDateKey(Date.parse("2026-08-27T15:00:00.000Z")), "2026-08-28");
  });
});

describe("shadow billing FX daily persistence", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    delete process.env.EXCHANGE_RATE_MODE;
    delete process.env.EXCHANGE_RATE_FALLBACK_KRW;
  });

  afterEach(() => {
    _setShadowBillingFxTestDb(null);
    _clearShadowBillingFxMemoryForTest();
    db.close();
  });

  it("previous persisted snapshot locks as previous_daily_snapshot and stays after background 1530", () => {
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-08-27",
      baseUsdKrw: 1500,
      source: "api_daily",
      fetchedAt: "2026-08-27T01:00:00.000Z",
    });

    const first = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(first.usdToKrw, 1500);
    assert.equal(first.source, "previous_daily_snapshot");
    assert.equal(first.locked, true);

    _simulateShadowBillingFxBackgroundFetchForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });

    const second = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(second.usdToKrw, 1500);
    assert.equal(second.source, "previous_daily_snapshot");
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-08-28"), 1);
  });

  it("prefetched fresh candidate locks api_daily on first resolution", () => {
    _setShadowBillingFxPrefetchedCandidateForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });

    const snap = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(snap.usdToKrw, 1530);
    assert.equal(snap.source, "api_daily");
    assert.equal(snap.locked, true);
    assert.equal(readShadowBillingFxDailySnapshot(db, "2026-08-28")?.base_usd_krw, 1530);
  });

  it("no previous/no fresh locks emergency_fallback and stays immutable same day", () => {
    const first = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(first.usdToKrw, SHADOW_BILLING_EMERGENCY_FX_KRW);
    assert.equal(first.source, "emergency_fallback");

    _simulateShadowBillingFxBackgroundFetchForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });

    const second = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(second.usdToKrw, SHADOW_BILLING_EMERGENCY_FX_KRW);
    assert.equal(second.source, "emergency_fallback");
  });

  it("process restart preserves persisted daily FX row", () => {
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-08-28",
      baseUsdKrw: 1530,
      source: "api_daily",
    });

    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));

    const afterRestart = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(afterRestart.usdToKrw, 1530);
    assert.equal(afterRestart.source, "api_daily");
    assert.equal(afterRestart.dateKey, "2026-08-28");
  });

  it("concurrent first resolution creates exactly one DB row", () => {
    _setShadowBillingFxPrefetchedCandidateForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });

    const results = Array.from({ length: 20 }, () => resolveShadowBillingExchangeRateSnapshot());
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-08-28"), 1);
    for (const snap of results) {
      assert.equal(snap.usdToKrw, 1530);
      assert.equal(snap.source, "api_daily");
    }
  });

  it("warm prefetch does not create persisted daily billing row", () => {
    warmShadowBillingFxPrefetch();
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-08-28"), 0);
  });

  it("turn lock keeps 1530 after candidate changes to 1600", () => {
    _setShadowBillingFxPrefetchedCandidateForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });
    const locked = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(locked.usdToKrw, 1530);

    _simulateShadowBillingFxBackgroundFetchForTest({ dateKey: "2026-08-28", usdToKrw: 1600 });
    const again = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(again.usdToKrw, 1530);
    assert.equal(readShadowBillingFxDailySnapshot(db, "2026-08-28")?.base_usd_krw, 1530);
  });

  it("legacy EXCHANGE_RATE_MODE=realtime does not change shadow mode", () => {
    process.env.EXCHANGE_RATE_MODE = "realtime";
    const preview = previewShadowBillingFxSnapshot();
    assert.equal(preview.mode, SHADOW_BILLING_FX_MODE);
  });

  it("legacy EXCHANGE_RATE_FALLBACK_KRW=1700 does not change shadow emergency fallback", () => {
    process.env.EXCHANGE_RATE_FALLBACK_KRW = "1700";
    const preview = previewShadowBillingFxSnapshot();
    assert.equal(preview.usdToKrw, SHADOW_BILLING_EMERGENCY_FX_KRW);
    assert.equal(preview.source, "emergency_fallback");
  });

  it("emergency_fallback row is excluded from previous carry-forward", () => {
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-08-27",
      baseUsdKrw: SHADOW_BILLING_EMERGENCY_FX_KRW,
      source: "emergency_fallback",
      fetchedAt: "2026-08-27T00:00:00.000Z",
    });

    const preview = previewShadowBillingFxSnapshot();
    assert.equal(preview.source, "emergency_fallback");
    assert.equal(preview.usdToKrw, SHADOW_BILLING_EMERGENCY_FX_KRW);
    assert.equal(preview.locked, false);
  });

  it("previous_daily_snapshot preserves original fetched_at", () => {
    const originalFetchedAt = "2026-08-27T03:15:00.000Z";
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-08-27",
      baseUsdKrw: 1520,
      source: "api_daily",
      fetchedAt: originalFetchedAt,
    });

    resolveShadowBillingExchangeRateSnapshot();
    const row = readShadowBillingFxDailySnapshot(db, "2026-08-28");
    assert.equal(row?.source, "previous_daily_snapshot");
    assert.equal(row?.fetched_at, originalFetchedAt);
  });

  it("status getter is read-only on empty DB", () => {
    assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
    getShadowBillingFxCacheStatus();
    assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
  });
});

describe("admin read-only FX diagnostics", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
  });

  afterEach(() => {
    _setShadowBillingFxTestDb(null);
    _clearShadowBillingFxMemoryForTest();
    db.close();
  });

  it("admin simulation on empty DB does not create rows", () => {
    assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
    adminSimulate({
      modelId: "gemini-3.1-pro-preview",
      inputTokens: 1000,
      outputTokens: 1000,
      benchmarkChargeP: 100,
      candidateMargins: [0.2],
      minimumMarginFloor: 0.1,
    });
    assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
  });

  it("admin simulation with persisted row uses existing row unchanged", () => {
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-08-28",
      baseUsdKrw: 1530,
      source: "api_daily",
    });
    const before = readShadowBillingFxDailySnapshot(db, "2026-08-28");
    adminSimulate({
      modelId: "gemini-3.1-pro-preview",
      inputTokens: 1000,
      outputTokens: 1000,
      benchmarkChargeP: 100,
      candidateMargins: [0.2],
      minimumMarginFloor: 0.1,
    });
    const after = readShadowBillingFxDailySnapshot(db, "2026-08-28");
    assert.equal(after?.date_key, before?.date_key);
    assert.equal(after?.base_usd_krw, before?.base_usd_krw);
    assert.equal(after?.source, before?.source);
    assert.equal(after?.fetched_at, before?.fetched_at);
    assert.equal(countAllShadowBillingFxDailySnapshots(db), 1);
  });

  it("admin simulation with preview candidate does not persist row", () => {
    _setShadowBillingFxPrefetchedCandidateForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });
    const result = adminSimulate({
      modelId: "gemini-3.1-pro-preview",
      inputTokens: 1000,
      outputTokens: 1000,
      benchmarkChargeP: 100,
      candidateMargins: [0.2],
      minimumMarginFloor: 0.1,
    });
    assert.equal(result.fxSnapshot.locked, false);
    assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
  });
});
