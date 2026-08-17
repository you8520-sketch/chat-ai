/** Client-side fake typing — not provider network streaming. */

export const TRPG_REVEAL_TICK_MS = 16;
export const TRPG_REVEAL_BOT_MIN_MS = 800;
export const TRPG_REVEAL_BOT_MAX_MS = 1800;
export const TRPG_REVEAL_LONG_MIN_MS = 1500;
export const TRPG_REVEAL_LONG_MAX_MS = 3000;
export const TRPG_REVEAL_BOT_MAX_CHARS = 800;
export const TRPG_REVEAL_LONG_MAX_CHARS = 5000;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Target window for already-received text. Caps long GM bodies well below the old ~20s 4/16ms crawl. */
export function trpgRevealTargetMs(charCount: number): number {
  if (charCount <= 0) return 0;
  if (charCount <= TRPG_REVEAL_BOT_MAX_CHARS) {
    const t = clamp01((charCount - 300) / 500);
    return Math.round(TRPG_REVEAL_BOT_MIN_MS + t * (TRPG_REVEAL_BOT_MAX_MS - TRPG_REVEAL_BOT_MIN_MS));
  }
  const t = clamp01(
    (charCount - TRPG_REVEAL_BOT_MAX_CHARS) / (TRPG_REVEAL_LONG_MAX_CHARS - TRPG_REVEAL_BOT_MAX_CHARS)
  );
  return Math.round(TRPG_REVEAL_LONG_MIN_MS + t * (TRPG_REVEAL_LONG_MAX_MS - TRPG_REVEAL_LONG_MIN_MS));
}

export function trpgRevealChunkSize(charCount: number): number {
  if (charCount <= 0) return 1;
  const ticks = Math.max(1, Math.round(trpgRevealTargetMs(charCount) / TRPG_REVEAL_TICK_MS));
  return Math.max(1, Math.ceil(charCount / ticks));
}

export function trpgRevealDurationMs(charCount: number): number {
  if (charCount <= 0) return 0;
  const chunk = trpgRevealChunkSize(charCount);
  return Math.ceil(charCount / chunk) * TRPG_REVEAL_TICK_MS;
}

export function trpgRevealImmediate(opts: {
  active: boolean;
  reducedMotion: boolean;
  charCount: number;
}): boolean {
  return !opts.active || opts.charCount === 0 || opts.reducedMotion;
}
