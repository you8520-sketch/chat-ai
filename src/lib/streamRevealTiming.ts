import type { StreamRevealOptions } from "@/lib/streamReveal";
import {
  CHAT_STREAM_SPEED_PRESETS,
  streamCharsPerTickForInterval,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";

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

/** Foreground reveal — always honor the user-selected preset (no backlog catch-up override). */
export function computeAdaptiveCharsPerTick(
  _pendingLength: number,
  opts: StreamRevealOptions
): number {
  if (opts.intervalMs <= 0) return Math.max(opts.charsPerTick, 64);
  return opts.charsPerTick;
}

export function revealOptionsFromDisplayPrefs(prefs: ChatDisplayPrefs): StreamRevealOptions {
  return {
    intervalMs: prefs.streamIntervalMs,
    charsPerTick: prefs.streamCharsPerTick,
  };
}
