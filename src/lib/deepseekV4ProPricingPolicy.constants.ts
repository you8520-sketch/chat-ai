/** Shared DeepSeek V4 Pro 0813 Published billing constants. */

export const DEEPSEEK_V4_PRO_MODEL_ID = "deepseek-v4-pro-0813";

/** Market competitor validation fixture — tokens, not character-fixed billing. */
export const DEEPSEEK_V4_PRO_COMPETITOR_FIXTURE = {
  inputTokens: 33_247,
  outputTokens: 3_461,
  reasoningTokens: 0,
} as const;

/** Production-real prefix cache read shape (openRouterUsage.test.ts turn-2 hit). */
export const DEEPSEEK_V4_PRO_PREFIX_CACHE_READ_FIXTURE = {
  promptTokens: 4_894,
  outputTokens: 318,
  cacheReadTokens: 3_072,
  cacheWriteTokens: 0,
  standardInputTokens: 1_822,
} as const;

export const FX_FIXTURE_BASE_1530 = 1530;
export const FX_FIXTURE_CARD_FEE = 0.02;
