/**
 * Gemini 3.7 Flash user price — Cheaper Inference `gemini-3.7-flash` only.
 *
 * USER PRICE = base + input surcharge + output surcharge.
 * cacheRead / cacheWrite / standardInput / upstreamCostUsd / actualApiCostKrw
 * are never inputs to the user price.
 */

export const GEMINI37_FLASH_DEFAULT_BASE_POINTS = 35;
export const GEMINI37_FLASH_DEFAULT_INCLUDED_INPUT_TOKENS = 25_000;
export const GEMINI37_FLASH_DEFAULT_INPUT_STEP_TOKENS = 10_000;
export const GEMINI37_FLASH_DEFAULT_INPUT_STEP_POINTS = 1;

export const GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_2500 = 0;
export const GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_4000 = 25;
export const GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_5500 = 30;
export const GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_7000 = 40;
export const GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_9000 = 50;
export const GEMINI37_FLASH_DEFAULT_OUTPUT_OVER_9000_STEP_TOKENS = 1_500;
export const GEMINI37_FLASH_DEFAULT_OUTPUT_OVER_9000_STEP_POINTS = 10;

export type Gemini37FlashPricingConfig = {
  basePoints: number;
  includedInputTokens: number;
  inputStepTokens: number;
  inputStepPoints: number;
  outputTier2500: number;
  outputTier4000: number;
  outputTier5500: number;
  outputTier7000: number;
  outputTier9000: number;
  outputOver9000StepTokens: number;
  outputOver9000StepPoints: number;
};

export type Gemini37FlashPricingBreakdown = {
  basePoints: number;
  inputTokens: number;
  inputSurchargePoints: number;
  billedOutputTokens: number;
  outputSurchargePoints: number;
  totalPoints: number;
};

function envNonNegativeNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveGemini37FlashPricingConfig(): Gemini37FlashPricingConfig {
  return {
    basePoints: envNonNegativeNumber(
      "GEMINI37_BASE_POINTS",
      GEMINI37_FLASH_DEFAULT_BASE_POINTS
    ),
    includedInputTokens: envPositiveNumber(
      "GEMINI37_INCLUDED_INPUT_TOKENS",
      GEMINI37_FLASH_DEFAULT_INCLUDED_INPUT_TOKENS
    ),
    inputStepTokens: envPositiveNumber(
      "GEMINI37_INPUT_STEP_TOKENS",
      GEMINI37_FLASH_DEFAULT_INPUT_STEP_TOKENS
    ),
    inputStepPoints: envNonNegativeNumber(
      "GEMINI37_INPUT_STEP_POINTS",
      GEMINI37_FLASH_DEFAULT_INPUT_STEP_POINTS
    ),
    outputTier2500: envNonNegativeNumber(
      "GEMINI37_OUTPUT_TIER_2500",
      GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_2500
    ),
    outputTier4000: envNonNegativeNumber(
      "GEMINI37_OUTPUT_TIER_4000",
      GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_4000
    ),
    outputTier5500: envNonNegativeNumber(
      "GEMINI37_OUTPUT_TIER_5500",
      GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_5500
    ),
    outputTier7000: envNonNegativeNumber(
      "GEMINI37_OUTPUT_TIER_7000",
      GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_7000
    ),
    outputTier9000: envNonNegativeNumber(
      "GEMINI37_OUTPUT_TIER_9000",
      GEMINI37_FLASH_DEFAULT_OUTPUT_TIER_9000
    ),
    outputOver9000StepTokens: envPositiveNumber(
      "GEMINI37_OUTPUT_OVER_9000_STEP_TOKENS",
      GEMINI37_FLASH_DEFAULT_OUTPUT_OVER_9000_STEP_TOKENS
    ),
    outputOver9000StepPoints: envNonNegativeNumber(
      "GEMINI37_OUTPUT_OVER_9000_STEP_POINTS",
      GEMINI37_FLASH_DEFAULT_OUTPUT_OVER_9000_STEP_POINTS
    ),
  };
}

/**
 * Provider billed output:
 * - If reasoning is unreported or already inside completion_tokens, use completion.
 * - If reasoning is separate and billed extra, use content + reasoning without
 *   double-counting (max(completion, content + reasoning)).
 */
export function resolveGemini37FlashBilledOutputTokens(opts: {
  completionTokens: number;
  reasoningTokens?: number;
  contentTokens?: number;
}): number {
  const completion = Math.max(0, Math.round(opts.completionTokens) || 0);
  const reasoning = Math.max(0, Math.round(opts.reasoningTokens ?? 0) || 0);
  const content =
    opts.contentTokens != null
      ? Math.max(0, Math.round(opts.contentTokens) || 0)
      : reasoning > 0 && reasoning <= completion
        ? Math.max(0, completion - reasoning)
        : completion;
  return Math.max(completion, content + reasoning);
}

export function computeGemini37FlashInputSurchargePoints(
  inputTokens: number,
  config: Pick<
    Gemini37FlashPricingConfig,
    "includedInputTokens" | "inputStepTokens" | "inputStepPoints"
  > = resolveGemini37FlashPricingConfig()
): number {
  const tokens = Math.max(0, Math.round(inputTokens) || 0);
  if (tokens <= config.includedInputTokens) return 0;
  const extra = tokens - config.includedInputTokens;
  return Math.ceil(extra / config.inputStepTokens) * config.inputStepPoints;
}

export function computeGemini37FlashOutputSurchargePoints(
  billedOutputTokens: number,
  config: Pick<
    Gemini37FlashPricingConfig,
    | "outputTier2500"
    | "outputTier4000"
    | "outputTier5500"
    | "outputTier7000"
    | "outputTier9000"
    | "outputOver9000StepTokens"
    | "outputOver9000StepPoints"
  > = resolveGemini37FlashPricingConfig()
): number {
  const tokens = Math.max(0, Math.round(billedOutputTokens) || 0);
  if (tokens <= 2_500) return config.outputTier2500;
  if (tokens <= 4_000) return config.outputTier4000;
  if (tokens <= 5_500) return config.outputTier5500;
  if (tokens <= 7_000) return config.outputTier7000;
  if (tokens <= 9_000) return config.outputTier9000;
  const extra = tokens - 9_000;
  const steps = Math.ceil(extra / config.outputOver9000StepTokens);
  return config.outputTier9000 + steps * config.outputOver9000StepPoints;
}

export function computeGemini37FlashUserChargeBreakdown(opts: {
  inputTokens: number;
  billedOutputTokens: number;
  config?: Gemini37FlashPricingConfig;
}): Gemini37FlashPricingBreakdown {
  const config = opts.config ?? resolveGemini37FlashPricingConfig();
  const inputTokens = Math.max(0, Math.round(opts.inputTokens) || 0);
  const billedOutputTokens = Math.max(0, Math.round(opts.billedOutputTokens) || 0);
  const inputSurchargePoints = computeGemini37FlashInputSurchargePoints(
    inputTokens,
    config
  );
  const outputSurchargePoints = computeGemini37FlashOutputSurchargePoints(
    billedOutputTokens,
    config
  );
  return {
    basePoints: config.basePoints,
    inputTokens,
    inputSurchargePoints,
    billedOutputTokens,
    outputSurchargePoints,
    totalPoints: config.basePoints + inputSurchargePoints + outputSurchargePoints,
  };
}

export function computeGemini37FlashUserChargePoints(opts: {
  inputTokens: number;
  billedOutputTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  contentTokens?: number;
  config?: Gemini37FlashPricingConfig;
}): number {
  const billedOutputTokens =
    opts.billedOutputTokens ??
    resolveGemini37FlashBilledOutputTokens({
      completionTokens: opts.completionTokens ?? 0,
      reasoningTokens: opts.reasoningTokens,
      contentTokens: opts.contentTokens,
    });
  return computeGemini37FlashUserChargeBreakdown({
    inputTokens: opts.inputTokens,
    billedOutputTokens,
    config: opts.config,
  }).totalPoints;
}

export function formatGemini37FlashAdminPricingLines(
  breakdown: Gemini37FlashPricingBreakdown
): string[] {
  return [
    "Gemini 3.7 pricing:",
    `- base: ${breakdown.basePoints}P`,
    `- api input: ${breakdown.inputTokens.toLocaleString()}`,
    `- input surcharge: ${breakdown.inputSurchargePoints}P`,
    `- billed output: ${breakdown.billedOutputTokens.toLocaleString()}`,
    `- output surcharge: ${breakdown.outputSurchargePoints}P`,
    `- main charge: ${breakdown.totalPoints}P`,
  ];
}

/** Admin telemetry only. Never feeds user price or auto-adjustment. */
export function formatGemini37FlashAdminMarginLines(opts: {
  userPoints: number;
  actualApiRawCostKrw?: number | null;
  catalogApiRawCostKrw?: number | null;
}): string[] {
  const lines: string[] = [];
  const userPoints = Math.max(0, opts.userPoints);
  if (userPoints <= 0) return lines;
  if (opts.actualApiRawCostKrw != null && Number.isFinite(opts.actualApiRawCostKrw)) {
    const pct = Math.round((1 - opts.actualApiRawCostKrw / userPoints) * 1000) / 10;
    lines.push(`- actual realized margin: ${pct}%`);
  }
  if (opts.catalogApiRawCostKrw != null && Number.isFinite(opts.catalogApiRawCostKrw)) {
    const pct = Math.round((1 - opts.catalogApiRawCostKrw / userPoints) * 1000) / 10;
    lines.push(`- catalog-stress margin: ${pct}%`);
  }
  return lines;
}
