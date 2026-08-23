import type { StreamRevealOptions } from "@/lib/streamReveal";
import {
  CHAT_STREAM_SPEED_PRESETS,
  streamCharsPerTickForInterval,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";

/** Hard cap on how far visual reveal may lag behind the server target (ms). */
export const STREAM_REVEAL_MAX_TARGET_LAG_MS = 5_000;

export function streamRevealOptionsFromInterval(intervalMs: number): StreamRevealOptions {
  return {
    intervalMs,
    charsPerTick: streamCharsPerTickForInterval(intervalMs),
  };
}

/** Fixed-speed theoretical duration — chars × interval (instant uses bulk ticks). */
export function estimateStreamRevealDurationMs(
  charCount: number,
  opts: StreamRevealOptions
): number {
  if (charCount <= 0) return 0;
  if (opts.intervalMs <= 0) return 0;
  return Math.ceil(charCount / Math.max(1, opts.charsPerTick)) * opts.intervalMs;
}

export function theoreticalRevealDurationsForCharCount(charCount: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const preset of CHAT_STREAM_SPEED_PRESETS) {
    const opts = streamRevealOptionsFromInterval(preset.intervalMs);
    out[preset.label] = estimateStreamRevealDurationMs(charCount, opts);
  }
  return out;
}

/**
 * Scale charsPerTick when pending backlog would take longer than MAX_TARGET_LAG to drain
 * at the user's chosen base speed.
 */
export function computeAdaptiveCharsPerTick(
  pendingLength: number,
  opts: StreamRevealOptions
): number {
  if (opts.intervalMs <= 0) return Math.max(opts.charsPerTick, 64);
  if (pendingLength <= 0) return opts.charsPerTick;

  const baseDrainMs =
    (pendingLength / Math.max(1, opts.charsPerTick)) * opts.intervalMs;
  if (baseDrainMs <= STREAM_REVEAL_MAX_TARGET_LAG_MS) {
    return opts.charsPerTick;
  }

  const ticksInBudget = Math.max(
    1,
    Math.ceil(STREAM_REVEAL_MAX_TARGET_LAG_MS / opts.intervalMs)
  );
  return Math.max(opts.charsPerTick, Math.ceil(pendingLength / ticksInBudget));
}

export function revealOptionsFromDisplayPrefs(prefs: ChatDisplayPrefs): StreamRevealOptions {
  return {
    intervalMs: prefs.streamIntervalMs,
    charsPerTick: prefs.streamCharsPerTick,
  };
}
