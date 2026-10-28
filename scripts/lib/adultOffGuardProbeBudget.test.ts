import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conservativeProbeCallEstimateUsd,
  parseProbeMaxKrw,
  probeBudgetCostUsdFromUsage,
  probeBudgetKrwFromUsd,
  shouldSkipProbeSampleForBudget,
} from "./adultOffGuardProbeBudget";

describe("adult-off classifier probe budget", () => {
  it("rejects invalid PROBE_MAX_KRW values", () => {
    for (const bad of ["0", "-1", "NaN", "Infinity", ""]) {
      assert.throws(() => parseProbeMaxKrw(bad, 40), RangeError);
    }
    assert.equal(parseProbeMaxKrw("40", 40), 40);
    assert.equal(parseProbeMaxKrw(undefined, 40), 40);
  });

  it("accumulates budget from token usage without treating missing billed cost as zero", () => {
    const budgetUsd = probeBudgetCostUsdFromUsage({ inputTokens: 1500, outputTokens: 29 });
    assert.ok(budgetUsd != null && budgetUsd > 0);
    const krw = probeBudgetKrwFromUsd(budgetUsd, 1400);
    assert.ok(krw > 0);
  });

  it("keeps actual billed cost absent while budget estimate uses tokens", () => {
    assert.equal(probeBudgetCostUsdFromUsage({ inputTokens: null, outputTokens: 29 }), null);
  });

  it("blocks the next call when the conservative upper bound exceeds remaining budget", () => {
    const upperUsd = conservativeProbeCallEstimateUsd({
      systemPromptChars: 1800,
      sampleTextChars: 6000,
    });
    const upperKrw = probeBudgetKrwFromUsd(upperUsd, 1400);
    assert.ok(upperKrw > 0);
    const tightMaxKrw = upperKrw * 0.5;
    assert.equal(
      shouldSkipProbeSampleForBudget({
        spentBudgetKrw: 0,
        maxKrw: tightMaxKrw,
        nextUpperBoundKrw: upperKrw,
      }),
      true
    );
    assert.equal(
      shouldSkipProbeSampleForBudget({
        spentBudgetKrw: 0,
        maxKrw: upperKrw * 2,
        nextUpperBoundKrw: upperKrw,
      }),
      false
    );
  });
});
