"use client";

import { useEffect, useState } from "react";

export function useRevealedText(text: string, active: boolean): string {
  const chars = Array.from(text);
  const [count, setCount] = useState(() => (active ? 0 : chars.length));

  useEffect(() => {
    const total = Array.from(text).length;
    if (!active || total === 0) {
      setCount(total);
      return;
    }
    setCount(0);
    let n = 0;
    const id = window.setInterval(() => {
      n = Math.min(total, n + 4);
      setCount(n);
      if (n >= total) window.clearInterval(id);
    }, 16);
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
