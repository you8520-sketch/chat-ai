/** Shared constants — no circular imports with calibration evidence. */

export const GEMINI37_MODEL_ID = "gemini-3.7-flash";

/** Google Standard direct-provider stress diagnostic only — NOT providerList canonical. */
export const GOOGLE_STANDARD_STRESS_RATES = {
  inputUsdPerMillion: 0.75,
  outputUsdPerMillion: 3.75,
} as const;

/** Google introductory Standard pricing validity window for stress diagnostic. */
export const GOOGLE_STANDARD_INTRO_VALID_THROUGH = "2026-12-31";

/**
 * Official Google Standard schedule for Gemini 3.7/3.8 Flash.
 * This is upstream Standard evidence only. It is NOT a prediction of the
 * site's current OpenRouter Flex procurement price.
 */
export const GOOGLE_FLASH_STANDARD_POST_INTRO_EFFECTIVE_AT =
  "2027-01-01T00:00:00.000Z";
export const GOOGLE_FLASH_STANDARD_SCHEDULE_MODEL_IDS = [
  "gemini-3.7-flash",
  "gemini-3.8-flash",
] as const;
export const GOOGLE_FLASH_STANDARD_INTRO_RATES = {
  inputUsdPerMillion: GOOGLE_STANDARD_STRESS_RATES.inputUsdPerMillion,
  outputUsdPerMillion: GOOGLE_STANDARD_STRESS_RATES.outputUsdPerMillion,
  cacheReadUsdPerMillion: 0.075,
} as const;
export const GOOGLE_FLASH_STANDARD_POST_INTRO_RATES = {
  inputUsdPerMillion: 1.5,
  outputUsdPerMillion: 7.5,
  cacheReadUsdPerMillion: 0.15,
} as const;

export const GEMINI37_MARGIN_CANDIDATES = [
  0.5, 0.525, 0.55, 0.56, 0.565, 0.57, 0.575, 0.58, 0.6,
] as const;

export const FX_SENSITIVITY_BASES = [1400, 1450, 1500, 1530, 1550, 1600] as const;

export const FX_FIXTURE_BASE_1530 = 1530;
export const FX_FIXTURE_BASE_1600 = 1600;
export const FX_FIXTURE_CARD_FEE = 0.02;
