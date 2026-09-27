/**
 * Benchmark-only OpenRouter credential adapter for Authorial Habit JEV live probes.
 *
 * Never reads production OPENROUTER_API_KEY as a credential source. The canonical
 * JEV transport still reads OPENROUTER_API_KEY, so this isolated benchmark process
 * temporarily shadows that env with the dedicated benchmark key for one call and
 * restores the previous value immediately.
 */
export const OPENROUTER_JEV_BENCHMARK_ENV = "OPENROUTER_JEV_BENCHMARK_API_KEY";
export const REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV = "REAL_JEV_AUTHORIAL_HABIT_PROBE";

export function resolveOptInJevAuthorialHabitBenchmarkApiKey(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1") return null;
  if (env[REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV] !== "1") return null;
  const key = env[OPENROUTER_JEV_BENCHMARK_ENV]?.trim();
  return key || null;
}

export async function withIsolatedAuthorialHabitBenchmarkOpenRouterKey<T>(
  benchmarkKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = benchmarkKey;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
}

export function sanitizeAuthorialHabitBenchmarkCredentialText(text: string): string {
  return text
    .replace(
      /OPENROUTER_JEV_BENCHMARK_API_KEY=\S+/gi,
      "OPENROUTER_JEV_BENCHMARK_API_KEY=[REDACTED]"
    )
    .replace(/OPENROUTER_API_KEY=\S+/gi, "OPENROUTER_API_KEY=[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
