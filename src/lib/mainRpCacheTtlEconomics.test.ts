import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeMainRpCacheTtlEconomics,
  previousCompletedKstMonthWindow,
  type MainRpCacheTtlRateSnapshot,
} from "@/lib/mainRpCacheTtlEconomics";

const RATES: MainRpCacheTtlRateSnapshot = {
  standardInputUsdPerMillion: 2.8,
  cacheReadUsdPerMillion: 0.14,
  fiveMinuteWriteUsdPerMillion: 3.5,
  oneHourWriteUsdPerMillionHypothetical: 5.6,
  source: "provider_catalog",
};

describe("Main RP cache TTL economics", () => {
  it("uses KST completed calendar month boundaries", () => {
    const window = previousCompletedKstMonthWindow(
      new Date("2026-09-28T10:00:00.000Z")
    );
    assert.deepEqual(window, {
      yearMonth: "2026-08",
      startSqlUtc: "2026-07-31 15:00:00",
      endSqlUtc: "2026-08-31 15:00:00",
    });
  });

  it("recommends one-hour only when observed 5-60m reuse offsets higher write cost", () => {
    const starts = [];
    const base = Date.parse("2026-08-01T00:00:00Z");
    for (let chatId = 1; chatId <= 10; chatId += 1) {
      for (let turn = 0; turn < 4; turn += 1) {
        starts.push({
          chatId,
          startedAt: new Date(base + chatId * 86_400_000 + turn * 20 * 60_000)
            .toISOString()
            .replace("T", " ")
            .replace("Z", ""),
        });
      }
    }
    const report = computeMainRpCacheTtlEconomics({
      yearMonth: "2026-08",
      starts,
      rates: RATES,
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    assert.equal(report.transitionCount, 30);
    assert.equal(report.gapBuckets.within5Minutes, 0);
    assert.equal(report.gapBuckets.over5Within60Minutes, 30);
    assert.equal(report.recommendation, "ONE_HOUR_WOULD_BE_CHEAPER_IF_SUPPORTED");
    assert.ok(
      report.normalizedCostUsdPerMillionPrefix.oneHourTtlHypothetical <
        report.normalizedCostUsdPerMillionPrefix.fiveMinuteTtl
    );
    assert.equal(report.providerOneHourSupport, "UNVERIFIED");
  });

  it("keeps five-minute when most next turns arrive within five minutes", () => {
    const starts = [];
    const base = Date.parse("2026-08-01T00:00:00Z");
    for (let chatId = 1; chatId <= 10; chatId += 1) {
      for (let turn = 0; turn < 4; turn += 1) {
        starts.push({
          chatId,
          startedAt: new Date(base + chatId * 86_400_000 + turn * 2 * 60_000)
            .toISOString()
            .replace("T", " ")
            .replace("Z", ""),
        });
      }
    }
    const report = computeMainRpCacheTtlEconomics({
      yearMonth: "2026-08",
      starts,
      rates: RATES,
    });
    assert.equal(report.transitionCount, 30);
    assert.equal(report.gapBuckets.within5Minutes, 30);
    assert.equal(report.recommendation, "KEEP_5M");
  });

  it("does not make a TTL recommendation on tiny samples", () => {
    const report = computeMainRpCacheTtlEconomics({
      yearMonth: "2026-08",
      starts: [
        { chatId: 1, startedAt: "2026-08-01 00:00:00" },
        { chatId: 1, startedAt: "2026-08-01 00:20:00" },
      ],
      rates: RATES,
    });
    assert.equal(report.transitionCount, 1);
    assert.equal(report.recommendation, "INSUFFICIENT_SAMPLE");
  });
});
