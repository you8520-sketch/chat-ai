"use client";

import { useEffect, useState } from "react";
import {
  trpgRevealChunkSize,
  trpgRevealImmediate,
  TRPG_REVEAL_TICK_MS,
} from "@/lib/trpg/revealTiming";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useRevealedText(text: string, active: boolean): string {
  const chars = Array.from(text);
  const [count, setCount] = useState(() =>
    trpgRevealImmediate({ active, reducedMotion: prefersReducedMotion(), charCount: chars.length })
      ? chars.length
      : 0
  );

  useEffect(() => {
    const total = Array.from(text).length;
    if (trpgRevealImmediate({ active, reducedMotion: prefersReducedMotion(), charCount: total })) {
      setCount(total);
      return;
    }
    setCount(0);
    const chunk = trpgRevealChunkSize(total);
    let n = 0;
    const id = window.setInterval(() => {
      n = Math.min(total, n + chunk);
      setCount(n);
      if (n >= total) window.clearInterval(id);
    }, TRPG_REVEAL_TICK_MS);
    return () => window.clearInterval(id);
  }, [text, active]);

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
