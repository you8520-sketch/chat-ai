/** Dedicated paid benchmark credential for monthly Main-RP supply qualification. */
export const OPENROUTER_SUPPLY_BENCHMARK_ENV =
  "OPENROUTER_SUPPLY_BENCHMARK_API_KEY";
export const MAIN_RP_SUPPLY_LIVE_QUALIFICATION_ENV =
  "MAIN_RP_SUPPLY_LIVE_QUALIFICATION";

export type SupplyLiveCredentialResolution =
  | {
      ok: true;
      apiKey: string;
      source: typeof OPENROUTER_SUPPLY_BENCHMARK_ENV;
    }
  | {
      ok: false;
      status: "NOT_RUN";
      reason:
        | "global_real_provider_opt_in_missing"
        | "supply_live_opt_in_missing"
        | "benchmark_credential_missing";
      providerGenerationCalls: 0;
    };

/**
 * Triple opt-in:
 * - REGULAR_TEST_REAL_PROVIDER_CALLS=1
 * - MAIN_RP_SUPPLY_LIVE_QUALIFICATION=1
 * - OPENROUTER_SUPPLY_BENCHMARK_API_KEY
 *
 * Production OPENROUTER_API_KEY is intentionally never consulted.
 */
export function resolveOptInOpenRouterSupplyBenchmarkApiKey(
  env: NodeJS.ProcessEnv = process.env
): SupplyLiveCredentialResolution {
  if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1") {
    return {
      ok: false,
      status: "NOT_RUN",
      reason: "global_real_provider_opt_in_missing",
      providerGenerationCalls: 0,
    };
  }
  if (env[MAIN_RP_SUPPLY_LIVE_QUALIFICATION_ENV] !== "1") {
    return {
      ok: false,
      status: "NOT_RUN",
      reason: "supply_live_opt_in_missing",
      providerGenerationCalls: 0,
    };
  }
  const apiKey = env[OPENROUTER_SUPPLY_BENCHMARK_ENV]?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: "NOT_RUN",
      reason: "benchmark_credential_missing",
      providerGenerationCalls: 0,
    };
  }
  return { ok: true, apiKey, source: OPENROUTER_SUPPLY_BENCHMARK_ENV };
}

export function sanitizeSupplyBenchmarkCredentialText(text: string): string {
  return text
    .replace(
      /OPENROUTER_SUPPLY_BENCHMARK_API_KEY=\S+/gi,
      "OPENROUTER_SUPPLY_BENCHMARK_API_KEY=[REDACTED]"
    )
    .replace(/OPENROUTER_API_KEY=\S+/gi, "OPENROUTER_API_KEY=[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
