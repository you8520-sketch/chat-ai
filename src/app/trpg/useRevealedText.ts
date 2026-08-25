"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "@/lib/chatDisplayPrefs";
import {
  trpgRevealCountForElapsed,
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

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
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
  const intervalRef = useRef<number | null>(null);
  const revealStartedAtRef = useRef<number | null>(null);
  const hiddenRef = useRef(isDocumentHidden());
  const [visibleEpoch, setVisibleEpoch] = useState(0);
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

  const clearRevealInterval = useCallback(() => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const catchUpCount = useCallback(
    (total: number, startedAt: number | null): number => {
      if (startedAt == null || total <= 0) return countRef.current;
      const elapsedMs = Date.now() - startedAt;
      const target = trpgRevealCountForElapsed({
        elapsedMs,
        charCount: total,
        kind,
        streamIntervalMs,
      });
      return Math.max(countRef.current, Math.min(total, target));
    },
    [kind, streamIntervalMs]
  );

  const finish = useCallback(() => {
    const total = Array.from(text).length;
    if (total <= 0) return;
    finishRequestedRef.current = true;
    clearRevealInterval();
    setCount(total);
  }, [clearRevealInterval, text]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const hidden = isDocumentHidden();
      hiddenRef.current = hidden;
      const session = sessionRef.current;
      const total = Array.from(session.text).length;
      if (
        !session.active ||
        total <= 0 ||
        trpgRevealImmediate({
          active: session.active,
          reducedMotion: prefersReducedMotion(),
          charCount: total,
          streamIntervalMs,
        })
      ) {
        return;
      }
      if (finishRequestedRef.current) return;
      if (hidden) {
        clearRevealInterval();
        const caught = catchUpCount(total, revealStartedAtRef.current);
        if (caught !== countRef.current) setCount(caught);
        return;
      }
      const caught = catchUpCount(total, revealStartedAtRef.current);
      if (caught !== countRef.current) setCount(caught);
      if (!hidden) setVisibleEpoch((epoch) => epoch + 1);
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
      hiddenRef.current = isDocumentHidden();
    }
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [catchUpCount, clearRevealInterval, streamIntervalMs]);

  useEffect(() => {
    clearRevealInterval();
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
      revealStartedAtRef.current = null;
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
    if (revealStartedAtRef.current == null || (sessionChanged && !textExtended)) {
      revealStartedAtRef.current = Date.now();
    }
    if (hiddenRef.current) {
      n = catchUpCount(total, revealStartedAtRef.current);
    }
    if (n !== countRef.current) setCount(n);
    if (n >= total || finishRequestedRef.current) return;

    if (hiddenRef.current) {
      return () => clearRevealInterval();
    }

    if (streamIntervalMs != null || kind === "gm") {
      const tick = trpgRevealTick(streamIntervalMs ?? DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs);
      intervalRef.current = window.setInterval(() => {
        if (finishRequestedRef.current) {
          clearRevealInterval();
          return;
        }
        const currentTotal = Array.from(sessionRef.current.text).length;
        n = Math.max(countRef.current, Math.min(currentTotal, n + tick.charsPerTick));
        setCount(n);
        if (n >= currentTotal) clearRevealInterval();
      }, tick.intervalMs);
      return () => clearRevealInterval();
    }
    const chunk = trpgRevealChunkSize(total, kind);
    intervalRef.current = window.setInterval(() => {
      if (finishRequestedRef.current) {
        clearRevealInterval();
        return;
      }
      const currentTotal = Array.from(sessionRef.current.text).length;
      n = Math.max(countRef.current, Math.min(currentTotal, n + chunk));
      setCount(n);
      if (n >= currentTotal) clearRevealInterval();
    }, TRPG_REVEAL_TICK_MS);
    return () => clearRevealInterval();
  }, [catchUpCount, clearRevealInterval, text, active, kind, streamIntervalMs, visibleEpoch]);

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
