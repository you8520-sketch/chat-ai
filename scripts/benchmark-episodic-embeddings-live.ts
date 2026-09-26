/**
 * Live episodic embedding benchmark entry point (manual, approval-gated).
 *
 *   REGULAR_TEST_REAL_PROVIDER_CALLS=1 REAL_EPISODIC_EMBEDDING_PROBE=1 \
 *   OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY=... \
 *   node --conditions=react-server --import tsx scripts/benchmark-episodic-embeddings-live.ts
 *
 * Without all three it prints NOT_RUN and performs 0 provider calls.
 */
import { runEpisodicEmbeddingLiveBenchmark } from "./lib/episodicEmbeddingLiveBenchmark";

void runEpisodicEmbeddingLiveBenchmark().then((result) => {
  if (result.status === "RAN") {
    console.log(JSON.stringify({ baseline: result.baseline }));
  }
});
