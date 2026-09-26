/**
 * Live DeepSeek ↔ JEV TRPG mechanics referee shadow benchmark entry point.
 *
 *   REGULAR_TEST_REAL_PROVIDER_CALLS=1 REAL_JEV_TRPG_MECHANICS_PROBE=1 \
 *   CHEAPER_INFERENCE_BENCHMARK_API_KEY=... OPENROUTER_JEV_BENCHMARK_API_KEY=... \
 *   node --conditions=react-server --import tsx scripts/benchmark-trpg-mechanics-jev-live.ts
 *
 * Without full opt-in it prints NOT_RUN and performs 0 provider calls.
 * Never reads production CHEAPER_INFERENCE_API_KEY / OPENROUTER_API_KEY.
 */
import { runTrpgMechanicsJevBenchmark } from "./lib/trpgMechanicsJevBenchmark";

void runTrpgMechanicsJevBenchmark().then((result) => {
  if (result.status === "RAN") {
    console.log(
      JSON.stringify({
        status: result.status,
        totalFixtures: result.totalFixtures,
        agreementCount: result.agreementCount,
        agreementRate: result.agreementRate,
        totalProviderCalls: result.totalProviderCalls,
        totalActualProviderCostUsd: result.totalActualProviderCostUsd,
        productionRefereeEnabled: result.productionRefereeEnabled,
        deepseek: {
          model: result.deepseek.model,
          provider: result.deepseek.provider,
          providerCalls: result.deepseek.providerCalls,
          retries: result.deepseek.retries,
          inputTokens: result.deepseek.inputTokens,
          outputTokens: result.deepseek.outputTokens,
          actualProviderCostUsd: result.deepseek.actualProviderCostUsd,
          latencyMs: result.deepseek.latencyMs,
          malformedCount: result.deepseek.malformedCount,
          timeoutCount: result.deepseek.timeoutCount,
          failureCount: result.deepseek.failureCount,
          raw: result.deepseek.raw,
          accepted: result.deepseek.accepted,
        },
        jev: {
          model: result.jev.model,
          provider: result.jev.provider,
          providerCalls: result.jev.providerCalls,
          retries: result.jev.retries,
          inputTokens: result.jev.inputTokens,
          outputTokens: result.jev.outputTokens,
          actualProviderCostUsd: result.jev.actualProviderCostUsd,
          latencyMs: result.jev.latencyMs,
          malformedCount: result.jev.malformedCount,
          timeoutCount: result.jev.timeoutCount,
          failureCount: result.jev.failureCount,
          raw: result.jev.raw,
          accepted: result.jev.accepted,
        },
        disagreements: result.disagreements,
      })
    );
  }
});
