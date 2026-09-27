/**
 * Live Main RP completion-integrity lexical→JEV semantic shadow benchmark.
 *
 *   REGULAR_TEST_REAL_PROVIDER_CALLS=1 REAL_JEV_COMPLETION_INTEGRITY_PROBE=1 \
 *   OPENROUTER_JEV_BENCHMARK_API_KEY=... \
 *   env -u OPENROUTER_API_KEY \
 *   node --conditions=react-server --import tsx scripts/benchmark-completion-integrity-jev-live.ts
 *
 * Without full opt-in it prints NOT_RUN and performs 0 provider calls.
 * Never reads production OPENROUTER_API_KEY.
 */
import { runCompletionIntegrityJevBenchmark } from "./lib/completionIntegrityJevBenchmark";

void runCompletionIntegrityJevBenchmark().then((result) => {
  if (result.status === "RAN") {
    console.log(
      JSON.stringify({
        status: result.status,
        corpusSize: result.corpusSize,
        totalProviderCalls: result.totalProviderCalls,
        productionMutationEnabled: result.productionMutationEnabled,
        lexical: {
          totalFixtures: result.lexical.totalFixtures,
          candidateCount: result.lexical.candidateCount,
          abruptCandidateRecall: result.lexical.abruptCandidateRecall,
          abruptScannerMissCount: result.lexical.abruptScannerMissCount,
          completeCandidateCount: result.lexical.completeCandidateCount,
          uncertainCandidateCount: result.lexical.uncertainCandidateCount,
          candidateReasonDistribution: result.lexical.candidateReasonDistribution,
        },
        jev: {
          model: result.jev.model,
          provider: result.jev.provider,
          providerCalls: result.jev.providerCalls,
          physicalAttempts: result.jev.physicalAttempts,
          retries: result.jev.retries,
          abruptCutCount: result.jev.abruptCutCount,
          completeCount: result.jev.completeCount,
          uncertainCount: result.jev.uncertainCount,
          malformedCount: result.jev.malformedCount,
          failureCount: result.jev.failureCount,
          humanLabelAgreementCount: result.jev.humanLabelAgreementCount,
          falseAbruptCutCount: result.jev.falseAbruptCutCount,
          missedAbruptCutAmongCalled: result.jev.missedAbruptCutAmongCalled,
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
