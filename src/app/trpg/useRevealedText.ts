"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "@/lib/chatDisplayPrefs";
import {
  trpgRevealTick,
  trpgRevealChunkSize,
  trpgRevealImmediate,
  trpgRevealSessionChanged,
  trpgRevealTextExtended,
  resolveTrpgRevealVisibleCount,
  TRPG_REVEAL_TICK_MS,
  type TrpgRevealKind,
} from "@/lib/trpg/revealTiming";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type TrpgRevealController = {
  shownText: string;
  complete: boolean;
  finish: () => void;
};

export function useRevealedText(
  text: string,
  active: boolean,
  kind: TrpgRevealKind = "bot",
  streamIntervalMs?: number
): TrpgRevealController {
  const chars = Array.from(text);
  const [count, setCount] = useState(() =>
    trpgRevealImmediate({
      active,
      reducedMotion: prefersReducedMotion(),
      charCount: chars.length,
      streamIntervalMs,
    })
      ? chars.length
      : 0
  );
  const countRef = useRef(count);
  countRef.current = count;
  const sessionRef = useRef({ text, active, kind });
  const finishRequestedRef = useRef(false);
  const reducedMotion = prefersReducedMotion();
  const previousSession = sessionRef.current;
  const nextSession = { text, active, kind };
  const visibleCount = resolveTrpgRevealVisibleCount({
    previousSession,
    nextSession,
    storedCount: count,
    finishOwned: finishRequestedRef.current,
    reducedMotion,
    streamIntervalMs,
  });

  const finish = useCallback(() => {
    const total = Array.from(text).length;
    if (total <= 0) return;
    finishRequestedRef.current = true;
    setCount(total);
  }, [text]);

  useEffect(() => {
    const total = Array.from(text).length;
    const previous = sessionRef.current;
    const sessionChanged = trpgRevealSessionChanged(previous, { text, active, kind });
    const textExtended =
      sessionChanged &&
      previous.active === active &&
      previous.kind === kind &&
      trpgRevealTextExtended(previous.text, text);
    sessionRef.current = { text, active, kind };
    if (
      trpgRevealImmediate({
        active,
        reducedMotion: prefersReducedMotion(),
        charCount: total,
        streamIntervalMs,
      })
    ) {
      setCount(total);
      return;
    }
    let n = resolveTrpgRevealVisibleCount({
      previousSession: previous,
      nextSession: { text, active, kind },
      storedCount: countRef.current,
      finishOwned: finishRequestedRef.current,
      reducedMotion: prefersReducedMotion(),
      streamIntervalMs,
    });
    if (sessionChanged && !textExtended) {
      finishRequestedRef.current = false;
    }
    if (n !== countRef.current) setCount(n);
    if (streamIntervalMs != null || kind === "gm") {
      const tick = trpgRevealTick(streamIntervalMs ?? DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs);
      const id = window.setInterval(() => {
        n = Math.min(total, n + tick.charsPerTick);
        setCount(n);
        if (n >= total) window.clearInterval(id);
      }, tick.intervalMs);
      return () => window.clearInterval(id);
    }
    const chunk = trpgRevealChunkSize(total, kind);
    const id = window.setInterval(() => {
      n = Math.min(total, n + chunk);
      setCount(n);
      if (n >= total) window.clearInterval(id);
    }, TRPG_REVEAL_TICK_MS);
    return () => window.clearInterval(id);
  }, [text, active, kind, streamIntervalMs]);

  const shownText = chars.slice(0, visibleCount).join("");
  const complete = chars.length === 0 || visibleCount >= chars.length;

  return { shownText, complete, finish };
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
