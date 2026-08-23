"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "@/lib/chatDisplayPrefs";
import {
  trpgGmRevealTick,
  trpgRevealChunkSize,
  trpgRevealImmediate,
  TRPG_REVEAL_TICK_MS,
  type TrpgRevealKind,
} from "@/lib/trpg/revealTiming";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useRevealedText(
  text: string,
  active: boolean,
  kind: TrpgRevealKind = "bot",
  streamIntervalMs?: number
): string {
  const chars = Array.from(text);
  const [count, setCount] = useState(() =>
    trpgRevealImmediate({
      active,
      reducedMotion: prefersReducedMotion(),
      charCount: chars.length,
      streamIntervalMs: kind === "gm" ? streamIntervalMs : undefined,
    })
      ? chars.length
      : 0
  );

  useEffect(() => {
    const total = Array.from(text).length;
    if (
      trpgRevealImmediate({
        active,
        reducedMotion: prefersReducedMotion(),
        charCount: total,
        streamIntervalMs: kind === "gm" ? streamIntervalMs : undefined,
      })
    ) {
      setCount(total);
      return;
    }
    setCount(0);
    if (kind === "gm") {
      const tick = trpgGmRevealTick(streamIntervalMs ?? DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs);
      let n = 0;
      const id = window.setInterval(() => {
        n = Math.min(total, n + tick.charsPerTick);
        setCount(n);
        if (n >= total) window.clearInterval(id);
      }, tick.intervalMs);
      return () => window.clearInterval(id);
    }
    const chunk = trpgRevealChunkSize(total, kind);
    let n = 0;
    const id = window.setInterval(() => {
      n = Math.min(total, n + chunk);
      setCount(n);
      if (n >= total) window.clearInterval(id);
    }, TRPG_REVEAL_TICK_MS);
    return () => window.clearInterval(id);
  }, [text, active, kind, streamIntervalMs]);

  return chars.slice(0, count).join("");
}

export function trpgLogRevealKeys(log: Array<{
  roundNumber: number;
  narration: string | null;
  actions: Array<{ participantId: number; revealed: boolean; body: string }>;
}>): string[] {
  const keys: string[] = [];
  for (const row of log) {
    for (const action of row.actions) {
      if (action.revealed && action.body.trim()) {
        keys.push(`a:${row.roundNumber}:${action.participantId}`);
      }
    }
    if (row.narration?.trim()) keys.push(`n:${row.roundNumber}`);
  }
  return keys;
}
