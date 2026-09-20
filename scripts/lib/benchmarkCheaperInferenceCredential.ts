/** Env var for manual benchmark/smoke CheaperInference calls only — never production. */
export const BENCHMARK_CHEAPER_INFERENCE_ENV = "CHEAPER_INFERENCE_BENCHMARK_API_KEY";

/** Returns trimmed benchmark key or null when absent. Never reads production key. */
export function resolveBenchmarkCheaperInferenceApiKey(): string | null {
  const key = process.env[BENCHMARK_CHEAPER_INFERENCE_ENV]?.trim();
  return key || null;
}

/** Sanitize log/error text that may echo benchmark env assignments. */
export function sanitizeBenchmarkCredentialText(text: string): string {
  return text
    .replace(/CHEAPER_INFERENCE_BENCHMARK_API_KEY=\S+/gi, "CHEAPER_INFERENCE_BENCHMARK_API_KEY=[REDACTED]")
    .replace(/CHEAPER_INFERENCE_API_KEY=\S+/gi, "CHEAPER_INFERENCE_API_KEY=[REDACTED]");
}
