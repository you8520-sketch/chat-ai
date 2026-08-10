/**
 * Bench-only A/B flags for model-adapter experiments.
 *
 * Production defaults: all flags OFF (identical to current production).
 * Enabled only when the corresponding env var is exactly "1".
 * Do not use these flags for permanent product behavior.
 */

function envFlagOn(name: string): boolean {
  return process.env[name]?.trim() === "1";
}

/** Opus B: drop Arm E terminal only → fall through to USER_TAIL / generic Gemini tail. */
export function benchAbOpusDropArmE(): boolean {
  return envFlagOn("BENCH_AB_OPUS_DROP_ARM_E");
}

/** Terra B: drop Terra terminal completion contract only → generic USER_TAIL path. */
export function benchAbTerraDropContract(): boolean {
  return envFlagOn("BENCH_AB_TERRA_DROP_CONTRACT");
}

/**
 * DeepSeek B: drop compact future-instruction boundary only when clearly
 * redundant with #307 collaborative owner. Style-only reminder + length stay.
 */
export function benchAbDeepSeekDropFutureBoundary(): boolean {
  return envFlagOn("BENCH_AB_DEEPSEEK_DROP_FUTURE_BOUNDARY");
}

/** Capture summary source messages / outputs under bench/ for RAW regression evidence. */
export function benchSummarySourceCaptureEnabled(): boolean {
  return envFlagOn("BENCH_SUMMARY_SOURCE_CAPTURE");
}
