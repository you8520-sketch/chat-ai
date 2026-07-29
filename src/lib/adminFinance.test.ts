import assert from "node:assert/strict";
import test from "node:test";
import {
  currentKstMonthKey,
  estimateApiCostUsd,
} from "./adminFinance";

test("DeepSeek V4 Flash uses the configured input/output/cache rates", () => {
  const usd = estimateApiCostUsd({
    model: "deepseek-v4-flash",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 200_000,
  });
  const expected = 0.8 * 0.098 + 0.2 * 0.0196 + 0.196;
  assert.ok(Math.abs(usd - expected) < 1e-12);
});

test("KST month key crosses UTC month boundaries correctly", () => {
  assert.equal(
    currentKstMonthKey(Date.parse("2026-07-31T16:00:00.000Z")),
    "2026-08"
  );
});
