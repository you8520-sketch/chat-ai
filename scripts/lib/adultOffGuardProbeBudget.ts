import { estimateApiCostUsd } from "@/lib/adminFinance";
import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import { estimateTokensFromCharCount } from "@/lib/tokenEstimate";

/** Probe budget only — not provider-billed cost. */
export const PROBE_CLASSIFIER_MAX_OUTPUT_TOKENS = 200;

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

/** Conservative upper bound before a call: no cache-read/write discounts. */
export function conservativeProbeCallEstimateUsd(input: {
  systemPromptChars: number;
  sampleTextChars: number;
  maxOutputTokens?: number;
}): number {
  const inputTokens =
    estimateTokensFromCharCount(input.systemPromptChars) +
    estimateTokensFromCharCount(input.sampleTextChars + 96);
  const outputTokens = input.maxOutputTokens ?? PROBE_CLASSIFIER_MAX_OUTPUT_TOKENS;
  return estimateApiCostUsd({
    model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/** Budget accumulation after a call when token counts are known (still no cache discount). */
export function probeBudgetCostUsdFromUsage(usage: {
  inputTokens: number | null;
  outputTokens: number | null;
}): number | null {
  if (usage.inputTokens == null || usage.outputTokens == null) return null;
  return estimateApiCostUsd({
    model: CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
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
