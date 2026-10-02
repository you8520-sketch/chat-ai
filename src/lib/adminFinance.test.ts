import assert from "node:assert/strict";
import test from "node:test";
import {
  currentKstMonthKey,
  estimateApiCostUsd,
  monthRangeSql,
} from "./adminFinance";

test("DeepSeek V4 Flash uses the configured input/output/cache rates", () => {
  const expected = 0.8 * 0.098 + 0.2 * 0.0196 + 0.196;
  for (const model of ["deepseek-v4-flash", "deepseek-v4-flash-0731"] as const) {
    const usd = estimateApiCostUsd({
      model,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 200_000,
    });
    assert.ok(Math.abs(usd - expected) < 1e-12, model);
  }
});

test("KST month key crosses UTC month boundaries correctly", () => {
  assert.equal(
    currentKstMonthKey(Date.parse("2026-07-31T16:00:00.000Z")),
    "2026-08"
  );
});

test("monthRangeSql is a naive calendar month, not a KST instant range", () => {
  assert.deepEqual(monthRangeSql("2026-10"), {
    start: "2026-10-01 00:00:00",
    end: "2026-11-01 00:00:00",
  });
  assert.equal(
    currentKstMonthKey(Date.parse("2026-09-30T15:00:00.000Z")),
    "2026-10"
  );
  assert.ok(monthRangeSql("2026-10").start > "2026-09-30 15:00:00");
});
