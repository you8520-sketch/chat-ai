/**
 * Usage/reporting-only CheaperInference credential owner for external audits.
 * Never reads production CHEAPER_INFERENCE_API_KEY (inference).
 */
import {
  BENCHMARK_CHEAPER_INFERENCE_ENV,
  sanitizeBenchmarkCredentialText,
} from "./benchmarkCheaperInferenceCredential";

/** Preferred reporting/usage-read credential (no inference required). */
export const USAGE_REPORTING_CHEAPER_INFERENCE_ENV =
  "CHEAPER_INFERENCE_USAGE_API_KEY";

export type UsageReportingCredentialSource =
  | typeof USAGE_REPORTING_CHEAPER_INFERENCE_ENV
  | typeof BENCHMARK_CHEAPER_INFERENCE_ENV;

export type UsageReportingCredentialResolution =
  | {
      ok: true;
      apiKey: string;
      source: UsageReportingCredentialSource;
    }
  | {
      ok: false;
      reason: "missing_usage_reporting_credential";
      status: "NOT_RUN";
      providerGenerationCalls: 0;
    };

/**
 * Resolve a usage/reporting credential only.
 * Prefer CHEAPER_INFERENCE_USAGE_API_KEY, then benchmark key for ops compatibility.
 * Production CHEAPER_INFERENCE_API_KEY is never consulted (no inference fallback).
 */
export function resolveUsageReportingCheaperInferenceApiKey(
  env: NodeJS.ProcessEnv = process.env
): UsageReportingCredentialResolution {
  const usageKey = env[USAGE_REPORTING_CHEAPER_INFERENCE_ENV]?.trim();
  if (usageKey) {
    return {
      ok: true,
      apiKey: usageKey,
      source: USAGE_REPORTING_CHEAPER_INFERENCE_ENV,
    };
  }
  const benchmarkKey = env[BENCHMARK_CHEAPER_INFERENCE_ENV]?.trim();
  if (benchmarkKey) {
    return {
      ok: true,
      apiKey: benchmarkKey,
      source: BENCHMARK_CHEAPER_INFERENCE_ENV,
    };
  }
  return {
    ok: false,
    reason: "missing_usage_reporting_credential",
    status: "NOT_RUN",
    providerGenerationCalls: 0,
  };
}

/** Redact usage + benchmark + production env assignment text in logs. */
export function sanitizeUsageReportingCredentialText(text: string): string {
  return sanitizeBenchmarkCredentialText(text).replace(
    /CHEAPER_INFERENCE_USAGE_API_KEY=\S+/gi,
    "CHEAPER_INFERENCE_USAGE_API_KEY=[REDACTED]"
  );
}
