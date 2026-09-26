/**
 * Live scene-boundary lexical→JEV semantic shadow benchmark entry point.
 *
 *   REGULAR_TEST_REAL_PROVIDER_CALLS=1 REAL_JEV_SCENE_BOUNDARY_PROBE=1 \
 *   OPENROUTER_JEV_BENCHMARK_API_KEY=... \
 *   env -u OPENROUTER_API_KEY \
 *   node --conditions=react-server --import tsx scripts/benchmark-scene-boundary-jev-live.ts
 *
 * Without full opt-in it prints NOT_RUN and performs 0 provider calls.
 * Never reads production OPENROUTER_API_KEY.
 */
import { runSceneBoundaryJevBenchmark } from "./lib/sceneBoundaryJevBenchmark";

void runSceneBoundaryJevBenchmark().then((result) => {
  if (result.status === "RAN") {
    console.log(
      JSON.stringify({
        status: result.status,
        corpusSize: result.corpusSize,
        totalProviderCalls: result.totalProviderCalls,
        productionEnforcementEnabled: result.productionEnforcementEnabled,
        lexical: {
          candidateHitCount: result.lexical.candidateHitCount,
          missedTrueViolations: result.lexical.missedTrueViolations,
          benignCompliantCandidateCount: result.lexical.benignCompliantCandidateCount,
          perSignalCandidateCounts: result.lexical.perSignalCandidateCounts,
        },
        jev: {
          model: result.jev.model,
          provider: result.jev.provider,
          providerCalls: result.jev.providerCalls,
          violationCount: result.jev.violationCount,
          compliantCount: result.jev.compliantCount,
          insufficientContextCount: result.jev.insufficientContextCount,
          malformedCount: result.jev.malformedCount,
          failureCount: result.jev.failureCount,
          humanLabelAgreementCount: result.jev.humanLabelAgreementCount,
          falseViolationCount: result.jev.falseViolationCount,
          missedViolationAmongCalled: result.jev.missedViolationAmongCalled,
          inputTokens: result.jev.inputTokens,
          outputTokens: result.jev.outputTokens,
          actualProviderCostUsd: result.jev.actualProviderCostUsd,
          latencyMs: result.jev.latencyMs,
        },
        combined: result.combined,
      })
    );
  }
});
