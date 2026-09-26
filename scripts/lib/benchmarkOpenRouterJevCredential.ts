/** Benchmark-only credential for the live JEV↔Gemini comment moderation probe. */
export const OPENROUTER_JEV_BENCHMARK_ENV = "OPENROUTER_JEV_BENCHMARK_API_KEY";

/** Probe-specific opt-in flag for the live comment-moderation JEV benchmark. */
export const REAL_JEV_MODERATION_PROBE_ENV = "REAL_JEV_MODERATION_PROBE";

/**
 * Triple opt-in: REGULAR_TEST_REAL_PROVIDER_CALLS=1 + REAL_JEV_MODERATION_PROBE=1
 * + OPENROUTER_JEV_BENCHMARK_API_KEY. Production OPENROUTER_API_KEY is
 * intentionally never consulted.
 */
export function resolveOptInJevModerationBenchmarkApiKey(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1") return null;
  if (env[REAL_JEV_MODERATION_PROBE_ENV] !== "1") return null;
  const key = env[OPENROUTER_JEV_BENCHMARK_ENV]?.trim();
  return key || null;
}

/** Sanitize log/error text that may echo credential assignments. */
export function sanitizeJevModerationBenchmarkCredentialText(text: string): string {
  return text
    .replace(/OPENROUTER_JEV_BENCHMARK_API_KEY=\S+/gi, "OPENROUTER_JEV_BENCHMARK_API_KEY=[REDACTED]")
    .replace(/OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY=\S+/gi, "OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY=[REDACTED]")
    .replace(/OPENROUTER_API_KEY=\S+/gi, "OPENROUTER_API_KEY=[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
