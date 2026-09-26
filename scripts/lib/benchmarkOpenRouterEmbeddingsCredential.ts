/** Benchmark-only credential for the live episodic embedding benchmark — never production. */
export const OPENROUTER_EMBEDDINGS_BENCHMARK_ENV = "OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY";

/** Probe-specific opt-in flag for the live episodic embedding benchmark. */
export const REAL_EPISODIC_EMBEDDING_PROBE_ENV = "REAL_EPISODIC_EMBEDDING_PROBE";

/**
 * Triple opt-in: REGULAR_TEST_REAL_PROVIDER_CALLS=1 + REAL_EPISODIC_EMBEDDING_PROBE=1
 * + OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY. Production OPENROUTER_API_KEY is
 * intentionally never consulted.
 */
export function resolveOptInEpisodicEmbeddingBenchmarkApiKey(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1") return null;
  if (env[REAL_EPISODIC_EMBEDDING_PROBE_ENV] !== "1") return null;
  const key = env[OPENROUTER_EMBEDDINGS_BENCHMARK_ENV]?.trim();
  return key || null;
}

/** Sanitize log/error text that may echo embedding credential assignments. */
export function sanitizeEmbeddingBenchmarkCredentialText(text: string): string {
  return text
    .replace(/OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY=\S+/gi, "OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY=[REDACTED]")
    .replace(/OPENROUTER_API_KEY=\S+/gi, "OPENROUTER_API_KEY=[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
