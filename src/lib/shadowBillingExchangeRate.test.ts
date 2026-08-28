import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  getKstDateKey,
  EXCHANGE_RATE_FALLBACK_KRW,
} from "./exchangeRate";
import {
  countShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
  readShadowBillingFxDailySnapshot,
} from "./shadowBillingFxPersistence";
import {
  resolveShadowBillingExchangeRateSnapshot,
  warmShadowBillingFxPrefetch,
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxPrefetchedCandidateForTest,
  _setShadowBillingFxTestDb,
  _simulateShadowBillingFxBackgroundFetchForTest,
} from "./shadowBillingExchangeRate";

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
    process.env.EXCHANGE_RATE_MODE = "daily_kst";
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
    });

    const first = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(first.usdToKrw, 1500);
    assert.equal(first.source, "previous_daily_snapshot");

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
    assert.equal(readShadowBillingFxDailySnapshot(db, "2026-08-28")?.base_usd_krw, 1530);
  });

  it("no previous/no fresh locks emergency_fallback and stays immutable same day", () => {
    const first = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(first.usdToKrw, EXCHANGE_RATE_FALLBACK_KRW);
    assert.equal(first.source, "emergency_fallback");

    _simulateShadowBillingFxBackgroundFetchForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });

    const second = resolveShadowBillingExchangeRateSnapshot();
    assert.equal(second.usdToKrw, EXCHANGE_RATE_FALLBACK_KRW);
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
});
