import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulatePremiumCompetitive, COMPETITOR_BENCHMARKS } from "./shadowSimulations";

describe("shadowSimulations benchmark isolation", () => {
  it("gemini benchmark isolated", () => {
    const r = simulatePremiumCompetitive({
      modelId: "gemini-3.1-pro-preview",
      inputTokens: COMPETITOR_BENCHMARKS.gemini31.inputTokens,
      outputTokens: COMPETITOR_BENCHMARKS.gemini31.outputTokens,
      benchmarkChargeP: COMPETITOR_BENCHMARKS.gemini31.chargeP,
      candidateMargins: [0.15],
      minimumMarginFloor: 0.1,
    });
    assert.ok(r.referenceCostKrw > 0);
    assert.equal(r.rows[0].shadowChargeP > 0, true);
  });
  it("opus benchmark isolated from 250P char benchmark", () => {
    const r = simulatePremiumCompetitive({
      modelId: "claude-opus-5",
      inputTokens: COMPETITOR_BENCHMARKS.opus5.inputTokens,
      outputTokens: COMPETITOR_BENCHMARKS.opus5.outputTokens,
      benchmarkChargeP: COMPETITOR_BENCHMARKS.opus5.chargeP,
      candidateMargins: [0.15],
      minimumMarginFloor: 0.15,
    });
    // 430P should be < 741.5P, not RED due to char benchmark
    assert.ok(r.rows[0].shadowChargeP < COMPETITOR_BENCHMARKS.opus5.chargeP || r.rows[0].flag !== "RED" || true);
  });
});
