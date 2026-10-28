import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateTokensFromCharCount } from "@/lib/tokenEstimate";
import {
  cheaperInferenceProbeCostUsdFromUsage,
  conservativeProbeCallEstimateUsd,
  estimateOfficialOpenAiGpt6LunaProbeCostUsd,
  parseProbeMaxKrw,
  probeBudgetCostUsdFromUsage,
  probeBudgetKrwFromUsd,
  probeRemainingBudgetKrw,
  resolveProbeBudgetChargeUsd,
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

  it("uses official OpenAI rates, not CheaperInference, for the same token usage", () => {
    const usage = { inputTokens: 1500, outputTokens: 29 };
    const official = probeBudgetCostUsdFromUsage(usage);
    const cheaper = cheaperInferenceProbeCostUsdFromUsage(usage);
    assert.ok(official != null && cheaper > 0);
    assert.notEqual(official, cheaper);
    assert.ok(official > cheaper, "official direct Standard is higher than CI list for this fixture");
    assert.equal(
      official,
      estimateOfficialOpenAiGpt6LunaProbeCostUsd({
        inputTokens: 1500,
        outputTokens: 29,
      })
    );
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

  it("charges the pre-call reservation when a call fails without usage", () => {
    const reservationUsd = conservativeProbeCallEstimateUsd({
      systemPromptChars: 1800,
      sampleTextChars: 6000,
    });
    const chargeUsd = resolveProbeBudgetChargeUsd({ reservationUsd, usage: null });
    assert.equal(chargeUsd, reservationUsd);
    const maxKrw = probeBudgetKrwFromUsd(reservationUsd, 1400) * 1.5;
    let spentBudgetKrw = 0;
    spentBudgetKrw += probeBudgetKrwFromUsd(chargeUsd, 1400);
    const remainingAfterFail = probeRemainingBudgetKrw(spentBudgetKrw, maxKrw);
    assert.ok(remainingAfterFail < maxKrw);
    const nextUpperKrw = probeBudgetKrwFromUsd(reservationUsd, 1400);
    assert.equal(
      shouldSkipProbeSampleForBudget({
        spentBudgetKrw,
        maxKrw: maxKrw,
        nextUpperBoundKrw: nextUpperKrw,
      }),
      nextUpperKrw > remainingAfterFail
    );
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

  it("uses max(reservation, usage estimate) when usage tokens are present", () => {
    const reservationUsd = 0.0001;
    const usageUsd = probeBudgetCostUsdFromUsage({ inputTokens: 5000, outputTokens: 200 });
    assert.ok(usageUsd != null && usageUsd > reservationUsd);
    assert.equal(
      resolveProbeBudgetChargeUsd({
        reservationUsd,
        usage: { inputTokens: 5000, outputTokens: 200 },
      }),
      usageUsd
    );
    assert.equal(
      resolveProbeBudgetChargeUsd({
        reservationUsd: usageUsd * 2,
        usage: { inputTokens: 5000, outputTokens: 200 },
      }),
      usageUsd * 2
    );
  });

  it("pre-call estimate prices system prompt at cache-write without cache-read discount", () => {
    const withSystem = conservativeProbeCallEstimateUsd({
      systemPromptChars: 4000,
      sampleTextChars: 100,
    });
    const noSystem = estimateOfficialOpenAiGpt6LunaProbeCostUsd({
      inputTokens: estimateTokensFromCharCount(100 + 96),
      outputTokens: 200,
    });
    const systemOnlyWrite = estimateOfficialOpenAiGpt6LunaProbeCostUsd({
      inputTokens: estimateTokensFromCharCount(4000),
      outputTokens: 200,
      cacheWriteInputTokens: estimateTokensFromCharCount(4000),
    });
    assert.ok(withSystem > noSystem);
    assert.ok(withSystem >= systemOnlyWrite);
  });
});
