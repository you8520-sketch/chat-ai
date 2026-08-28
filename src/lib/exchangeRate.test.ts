import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  getKstDateKey,
  resolveBillingExchangeRateSnapshot,
  EXCHANGE_RATE_FALLBACK_KRW,
  _clearExchangeRateCacheForTest,
  _setExchangeRateForTest,
  _setPrefetchedCandidateForTest,
  _setPreviousDailySnapshotForTest,
  _simulateBackgroundFetchSuccessForTest,
  _setKstNowForTest,
} from "./exchangeRate";

const ORIGINAL_MODE = process.env.EXCHANGE_RATE_MODE;

describe("getKstDateKey boundaries", () => {
  it("UTC 14:59:59 maps to prior KST date", () => {
    const priorUtc = Date.parse("2026-08-27T14:59:59.000Z");
    assert.equal(getKstDateKey(priorUtc), "2026-08-27");
  });

  it("UTC 15:00:00 maps to next KST date", () => {
    const nextUtc = Date.parse("2026-08-27T15:00:00.000Z");
    assert.equal(getKstDateKey(nextUtc), "2026-08-28");
  });
});

describe("daily KST billing snapshot immutability", () => {
  beforeEach(() => {
    _clearExchangeRateCacheForTest();
    process.env.EXCHANGE_RATE_MODE = "daily_kst";
  });

  afterEach(() => {
    _clearExchangeRateCacheForTest();
    if (ORIGINAL_MODE === undefined) delete process.env.EXCHANGE_RATE_MODE;
    else process.env.EXCHANGE_RATE_MODE = ORIGINAL_MODE;
  });

  it("previous snapshot 1500 locks as previous_daily_snapshot on new date and stays after background 1530", () => {
    _setKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    _setPreviousDailySnapshotForTest({ dateKey: "2026-08-27", usdToKrw: 1500 });

    const first = resolveBillingExchangeRateSnapshot();
    assert.equal(first.usdToKrw, 1500);
    assert.equal(first.source, "previous_daily_snapshot");

    _simulateBackgroundFetchSuccessForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });

    const second = resolveBillingExchangeRateSnapshot();
    assert.equal(second.usdToKrw, 1500);
    assert.equal(second.source, "previous_daily_snapshot");
  });

  it("prefetched fresh candidate locks api_daily on first resolution", () => {
    _setKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    _setPrefetchedCandidateForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });

    const snap = resolveBillingExchangeRateSnapshot();
    assert.equal(snap.usdToKrw, 1530);
    assert.equal(snap.source, "api_daily");
  });

  it("no previous/no fresh locks emergency_fallback and stays immutable same day", () => {
    _setKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));

    const first = resolveBillingExchangeRateSnapshot();
    assert.equal(first.usdToKrw, EXCHANGE_RATE_FALLBACK_KRW);
    assert.equal(first.source, "emergency_fallback");

    _simulateBackgroundFetchSuccessForTest({ dateKey: "2026-08-28", usdToKrw: 1530 });

    const second = resolveBillingExchangeRateSnapshot();
    assert.equal(second.usdToKrw, EXCHANGE_RATE_FALLBACK_KRW);
    assert.equal(second.source, "emergency_fallback");
  });

  it("already-locked snapshot is returned on subsequent sync resolutions", () => {
    _setKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    _setExchangeRateForTest({ dateKey: "2026-08-28", usdToKrw: 1510, source: "api_daily" });

    const first = resolveBillingExchangeRateSnapshot();
    _simulateBackgroundFetchSuccessForTest({ dateKey: "2026-08-28", usdToKrw: 1600 });
    const second = resolveBillingExchangeRateSnapshot();

    assert.equal(first.usdToKrw, 1510);
    assert.equal(second.usdToKrw, 1510);
    assert.equal(second.source, "api_daily");
  });
});
