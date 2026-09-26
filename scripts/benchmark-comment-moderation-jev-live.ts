/**
 * Live Gemini ↔ JEV comment-moderation shadow benchmark entry point.
 *
 *   REGULAR_TEST_REAL_PROVIDER_CALLS=1 REAL_JEV_MODERATION_PROBE=1 \
 *   OPENROUTER_JEV_BENCHMARK_API_KEY=... \
 *   node --conditions=react-server --import tsx scripts/benchmark-comment-moderation-jev-live.ts
 *
 * Without all three it prints NOT_RUN and performs 0 provider calls.
 * Never reads production OPENROUTER_API_KEY.
 */
import { runCommentModerationJevBenchmark } from "./lib/commentModerationJevBenchmark";

void runCommentModerationJevBenchmark().then((result) => {
  if (result.status === "RAN") {
    console.log(
      JSON.stringify({
        status: result.status,
        totalFixtures: result.totalFixtures,
        agreementCount: result.agreementCount,
        agreementRate: result.agreementRate,
        totalProviderCalls: result.totalProviderCalls,
        totalActualProviderCostUsd: result.totalActualProviderCostUsd,
        gemini: {
          overallAccuracy: result.gemini.overallAccuracy,
          blockRecall: result.gemini.blockRecall,
          allowRecall: result.gemini.allowRecall,
          falseBlockCount: result.gemini.falseBlockCount,
          falseAllowCount: result.gemini.falseAllowCount,
          providerCalls: result.gemini.providerCalls,
          actualProviderCostUsd: result.gemini.actualProviderCostUsd,
          latencyMs: result.gemini.latencyMs,
        },
        jev: {
          overallAccuracy: result.jev.overallAccuracy,
          blockRecall: result.jev.blockRecall,
          allowRecall: result.jev.allowRecall,
          falseBlockCount: result.jev.falseBlockCount,
          falseAllowCount: result.jev.falseAllowCount,
          providerCalls: result.jev.providerCalls,
          actualProviderCostUsd: result.jev.actualProviderCostUsd,
          latencyMs: result.jev.latencyMs,
        },
        disagreements: result.disagreements,
      })
    );
  }
});
