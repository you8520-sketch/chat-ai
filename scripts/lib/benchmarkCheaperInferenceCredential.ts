/** Env var for manual benchmark/smoke CheaperInference calls only — never production. */
export const BENCHMARK_CHEAPER_INFERENCE_ENV = "CHEAPER_INFERENCE_BENCHMARK_API_KEY";

/** Returns trimmed benchmark key or null when absent. Never reads production key. */
export function resolveBenchmarkCheaperInferenceApiKey(): string | null {
  const key = process.env[BENCHMARK_CHEAPER_INFERENCE_ENV]?.trim();
  return key || null;
}

/** Exit 0 with NOT_RUN when benchmark key is absent; never reads production key. */
export function exitIfBenchmarkCheaperInferenceApiKeyMissing(
  statusLabel = "NOT_RUN"
): string {
  const key = resolveBenchmarkCheaperInferenceApiKey();
  if (!key) {
    console.log(`${statusLabel} — missing CHEAPER_INFERENCE_BENCHMARK_API_KEY`);
    console.log("provider calls=0");
    process.exit(0);
  }
  return key;
}

/** Sanitize log/error text that may echo benchmark env assignments. */
export function sanitizeBenchmarkCredentialText(text: string): string {
  return text
    .replace(/CHEAPER_INFERENCE_BENCHMARK_API_KEY=\S+/gi, "CHEAPER_INFERENCE_BENCHMARK_API_KEY=[REDACTED]")
    .replace(/CHEAPER_INFERENCE_API_KEY=\S+/gi, "CHEAPER_INFERENCE_API_KEY=[REDACTED]");
}
