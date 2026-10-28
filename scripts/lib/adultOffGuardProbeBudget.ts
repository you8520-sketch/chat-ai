import { estimateApiCostUsd } from "@/lib/adminFinance";
import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import { estimateTokensFromCharCount } from "@/lib/tokenEstimate";

/** Probe budget only — not provider-billed cost. Official OpenAI direct (Standard) for gpt-6-luna. */
export const PROBE_CLASSIFIER_MAX_OUTPUT_TOKENS = 200;

/** Official OpenAI Standard list for direct Chat Completions (probe cap only). */
export const OFFICIAL_OPENAI_GPT_6_LUNA_STANDARD_USD_PER_M = {
  input: 0.1,
  output: 0.5,
  cacheRead: 0.01,
  cacheWrite: 0.125,
} as const;

/** Probe budget only — not provider-billed cost. */
export function estimateOfficialOpenAiGpt6LunaProbeCostUsd(input: {
  inputTokens: number;
  outputTokens: number;
  /** System-prompt tokens priced at cache-write when set (pre-call conservative path). */
  cacheWriteInputTokens?: number;
}): number {
  const inputTokens = Math.max(0, Math.trunc(input.inputTokens));
  const outputTokens = Math.max(0, Math.trunc(input.outputTokens));
  const cacheWriteInput = Math.min(
    inputTokens,
    Math.max(0, Math.trunc(input.cacheWriteInputTokens ?? 0))
  );
  const standardInput = Math.max(0, inputTokens - cacheWriteInput);
  const rates = OFFICIAL_OPENAI_GPT_6_LUNA_STANDARD_USD_PER_M;
  return (
    (standardInput * rates.input +
      cacheWriteInput * rates.cacheWrite +
      outputTokens * rates.output) /
    1_000_000
  );
}

export function parseProbeMaxKrw(raw: string | undefined, fallback = 40): number {
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new RangeError("PROBE_MAX_KRW must be a finite positive number");
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError("PROBE_MAX_KRW must be a finite positive number");
  }
  return parsed;
}

/**
 * Conservative upper bound before a call: no cache-read discount; system prompt at cache-write rate.
 */
export function conservativeProbeCallEstimateUsd(input: {
  systemPromptChars: number;
  sampleTextChars: number;
  maxOutputTokens?: number;
}): number {
  const systemTokens = estimateTokensFromCharCount(input.systemPromptChars);
  const userTokens = estimateTokensFromCharCount(input.sampleTextChars + 96);
  const outputTokens = input.maxOutputTokens ?? PROBE_CLASSIFIER_MAX_OUTPUT_TOKENS;
  const usd = estimateOfficialOpenAiGpt6LunaProbeCostUsd({
    inputTokens: systemTokens + userTokens,
    outputTokens,
    cacheWriteInputTokens: systemTokens,
  });
  if (!Number.isFinite(usd) || usd < 0) {
    throw new RangeError("probe pre-call cost estimate unavailable");
  }
  return usd;
}

/** Budget accumulation after a call when token counts are known (no cache-read discount). */
export function probeBudgetCostUsdFromUsage(usage: {
  inputTokens: number | null;
  outputTokens: number | null;
}): number | null {
  if (usage.inputTokens == null || usage.outputTokens == null) return null;
  const usd = estimateOfficialOpenAiGpt6LunaProbeCostUsd({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  if (!Number.isFinite(usd) || usd < 0) return null;
  return usd;
}

/** CheaperInference catalog path — tests only, to prove probe uses official rates. */
export function cheaperInferenceProbeCostUsdFromUsage(usage: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return estimateApiCostUsd({
    model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/**
 * One attempted call: at least the pre-call reservation; with usage, at least max(reservation, usage estimate).
 */
export function resolveProbeBudgetChargeUsd(input: {
  reservationUsd: number;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
}): number {
  if (!Number.isFinite(input.reservationUsd) || input.reservationUsd < 0) {
    throw new RangeError("probe reservation must be a finite non-negative number");
  }
  if (!input.usage) return input.reservationUsd;
  const usageUsd = probeBudgetCostUsdFromUsage(input.usage);
  if (usageUsd == null) return input.reservationUsd;
  return Math.max(input.reservationUsd, usageUsd);
}

export function probeBudgetKrwFromUsd(usd: number, effectiveKrwPerUsd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new RangeError("probe budget USD must be a finite non-negative number");
  }
  if (!Number.isFinite(effectiveKrwPerUsd) || effectiveKrwPerUsd <= 0) {
    throw new RangeError("probe budget FX must be a finite positive number");
  }
  return usd * effectiveKrwPerUsd;
}

export function probeRemainingBudgetKrw(spentBudgetKrw: number, maxKrw: number): number {
  if (!Number.isFinite(spentBudgetKrw) || spentBudgetKrw < 0) {
    throw new RangeError("spent probe budget must be a finite non-negative number");
  }
  if (!Number.isFinite(maxKrw) || maxKrw <= 0) {
    throw new RangeError("max probe budget must be a finite positive number");
  }
  return Math.max(0, maxKrw - spentBudgetKrw);
}

export function shouldSkipProbeSampleForBudget(input: {
  spentBudgetKrw: number;
  maxKrw: number;
  nextUpperBoundKrw: number;
}): boolean {
  const remaining = probeRemainingBudgetKrw(input.spentBudgetKrw, input.maxKrw);
  if (remaining <= 0) return true;
  if (!Number.isFinite(input.nextUpperBoundKrw) || input.nextUpperBoundKrw < 0) {
    throw new RangeError("nextUpperBoundKrw must be a finite non-negative number");
  }
  return input.nextUpperBoundKrw > remaining;
}
