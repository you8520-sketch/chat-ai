import {
  normalizeStreamIntervalMs,
  streamCharsPerTickForInterval,
} from "@/lib/chatDisplayPrefs";

/** Client-side fake typing — not provider network streaming. */

export const TRPG_REVEAL_TICK_MS = 16;
export const TRPG_REVEAL_BOT_MIN_MS = 800;
export const TRPG_REVEAL_BOT_MAX_MS = 1800;
export const TRPG_REVEAL_LONG_MIN_MS = 1500;
export const TRPG_REVEAL_LONG_MAX_MS = 3000;
export const TRPG_REVEAL_BOT_MAX_CHARS = 800;
export const TRPG_REVEAL_LONG_MAX_CHARS = 5000;
export const TRPG_REVEAL_GM_CAP_MS = 10_000;

export type TrpgRevealKind = "bot" | "gm";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerpMs(min: number, max: number, t: number): number {
  return Math.round(min + (max - min) * clamp01(t));
}

/** Length-adaptive reading window for long GM narration. Caps at 10s. */
function gmNarrationTargetMs(charCount: number): number {
  if (charCount <= 0) return 0;
  if (charCount <= 500) return lerpMs(1_000, 1_250, charCount / 500);
  if (charCount <= 1_000) return lerpMs(1_250, 2_500, (charCount - 500) / 500);
  if (charCount <= 2_000) return lerpMs(2_500, 4_500, (charCount - 1_000) / 1_000);
  if (charCount <= 3_000) return lerpMs(4_500, 6_500, (charCount - 2_000) / 1_000);
  if (charCount <= 4_000) return lerpMs(6_500, 8_000, (charCount - 3_000) / 1_000);
  if (charCount <= 5_000) return lerpMs(8_000, TRPG_REVEAL_GM_CAP_MS, (charCount - 4_000) / 1_000);
  return TRPG_REVEAL_GM_CAP_MS;
}

/** Target window for already-received text. Bot stays short; GM is slower and length-adaptive. */
export function trpgRevealTargetMs(charCount: number, kind: TrpgRevealKind = "bot"): number {
  switch (kind) {
    case "bot":
      if (charCount <= 0) return 0;
      if (charCount <= TRPG_REVEAL_BOT_MAX_CHARS) {
        const t = clamp01((charCount - 300) / 500);
        return Math.round(TRPG_REVEAL_BOT_MIN_MS + t * (TRPG_REVEAL_BOT_MAX_MS - TRPG_REVEAL_BOT_MIN_MS));
      }
      return TRPG_REVEAL_BOT_MAX_MS;
    case "gm":
      return gmNarrationTargetMs(charCount);
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function trpgRevealChunkSize(charCount: number, kind: TrpgRevealKind = "bot"): number {
  if (charCount <= 0) return 1;
  const ticks = Math.max(1, Math.round(trpgRevealTargetMs(charCount, kind) / TRPG_REVEAL_TICK_MS));
  return Math.max(1, Math.ceil(charCount / ticks));
}

export function trpgRevealDurationMs(
  charCount: number,
  kind: TrpgRevealKind = "bot",
  streamIntervalMs?: number
): number {
  if (charCount <= 0) return 0;
  if (kind === "gm" && streamIntervalMs != null) {
    const tick = trpgGmRevealTick(streamIntervalMs);
    if (tick.intervalMs <= 0) return 0;
    return Math.ceil(charCount / tick.charsPerTick) * tick.intervalMs;
  }
  const chunk = trpgRevealChunkSize(charCount, kind);
  return Math.ceil(charCount / chunk) * TRPG_REVEAL_TICK_MS;
}

/** Same visible rate as regular chat: intervalMs + charsPerTick from CHAT_STREAM_SPEED_PRESETS. */
export function trpgGmRevealTick(streamIntervalMs: number): {
  intervalMs: number;
  charsPerTick: number;
} {
  const intervalMs = normalizeStreamIntervalMs(streamIntervalMs);
  return {
    intervalMs,
    charsPerTick: streamCharsPerTickForInterval(intervalMs),
  };
}

export function trpgRevealImmediate(opts: {
  active: boolean;
  reducedMotion: boolean;
  charCount: number;
  streamIntervalMs?: number;
}): boolean {
  if (!opts.active || opts.charCount === 0 || opts.reducedMotion) return true;
  if (opts.streamIntervalMs != null && normalizeStreamIntervalMs(opts.streamIntervalMs) <= 0) {
    return true;
  }
  return false;
}
