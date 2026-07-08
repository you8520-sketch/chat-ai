/**
 * Unit tests for paired-comparison-stats (no API).
 * Usage: npx tsx --test scripts/lib/paired-comparison-stats.test.ts
 */
import assert from "node:assert/strict";
import {
  mean,
  median,
  stddevSample,
  describe,
  binomialOneSidedPValue,
  buildPairedMetricReport,
} from "./paired-comparison-stats";

assert.equal(mean([1, 2, 3, 4, 5]), 3);
assert.equal(median([1, 2, 3, 4, 5]), 3);
assert.equal(median([1, 2, 3, 4]), 2.5);

const sd = stddevSample([2, 4, 4, 4, 5, 5, 7, 9]);
assert.ok(sd > 2 && sd < 2.5);

const d = describe([1, 2, 3]);
assert.equal(d.n, 3);
assert.equal(d.mean, 2);

assert.ok(binomialOneSidedPValue(9, 10) < 0.05);
assert.ok(binomialOneSidedPValue(5, 10) > 0.05);

const improved = buildPairedMetricReport({
  metricKey: "gestureRepeatScore",
  label: "몸짓 반복",
  higherIsBetter: false,
  beforeValues: [10, 12, 11, 9, 10, 11, 12, 10, 11, 9],
  afterValues: [6, 7, 5, 8, 6, 7, 5, 6, 7, 8],
  improvements: [4, 5, 6, 1, 4, 4, 7, 4, 4, 1],
  wins: 10,
  ties: 0,
});
assert.equal(improved.wins, 10);
assert.equal(improved.winRate, 1);
assert.equal(improved.significantAt95, true);
assert.equal(improved.verdict, "improved");

console.log("paired-comparison-stats.test.ts: all passed");
