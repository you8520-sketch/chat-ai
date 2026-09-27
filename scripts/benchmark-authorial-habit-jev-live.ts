/**
 * Manual live Authorial Habit lexical→JEV benchmark.
 *
 * Triple opt-in only:
 *   REGULAR_TEST_REAL_PROVIDER_CALLS=1
 *   REAL_JEV_AUTHORIAL_HABIT_PROBE=1
 *   OPENROUTER_JEV_BENCHMARK_API_KEY=...
 *
 * Without all three, exits normally with provider calls=0.
 * Production OPENROUTER_API_KEY is never used as the credential source.
 */
import { runAuthorialHabitJevBenchmark } from "./lib/authorialHabitJevBenchmark";

void runAuthorialHabitJevBenchmark().then((result) => {
  if (result.status !== "RAN") return;
  console.log(
    JSON.stringify(
      {
        status: result.status,
        corpusSize: result.corpusSize,
        totalProviderCalls: result.totalProviderCalls,
        productionMutationEnabled: result.productionMutationEnabled,
        runtimeHookEnabled: result.runtimeHookEnabled,
        lexical: {
          candidateCount: result.lexical.candidateCount,
          scannerMissCount: result.lexical.scannerMissCount,
          candidateLabelCounts: result.lexical.candidateLabelCounts,
        },
        jev: {
          model: result.jev.model,
          provider: result.jev.provider,
          evaluatedFixtures: result.jev.evaluatedFixtures,
          providerCalls: result.jev.providerCalls,
          preflightFailureCount: result.jev.preflightFailureCount,
          habitPresentCount: result.jev.habitPresentCount,
          contextuallyJustifiedCount: result.jev.contextuallyJustifiedCount,
          uncertainCount: result.jev.uncertainCount,
          malformedCount: result.jev.malformedCount,
          failureCount: result.jev.failureCount,
          humanLabelAgreementCount: result.jev.humanLabelAgreementCount,
          clearHabitMissCount: result.jev.clearHabitMissCount,
          justifiedFalseHighPriorityCount:
            result.jev.justifiedFalseHighPriorityCount,
          inputTokens: result.jev.inputTokens,
          outputTokens: result.jev.outputTokens,
          actualProviderCostUsd: result.jev.actualProviderCostUsd,
          reportedProviderCostUsd: result.jev.reportedProviderCostUsd,
          actualProviderCostReportedCalls: result.jev.actualProviderCostReportedCalls,
          actualProviderCostCoverage: result.jev.actualProviderCostCoverage,
          latencyMs: result.jev.latencyMs,
        },
        combined: result.combined,
      },
      null,
      2
    )
  );
});
