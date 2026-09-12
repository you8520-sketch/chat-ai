"use client";

import { useSyncExternalStore } from "react";

import { CHAT_DESKTOP_MEDIA_QUERY } from "@/lib/chatDisplayPrefs";

/**
 * Single reactive owner for the chat desktop/mobile breakpoint.
 * Re-renders on breakpoint crossing via MediaQueryList change events
 * (no innerWidth polling, no per-call matchMedia comparisons in components).
 *
 * `getServerSnapshot` returns desktop so SSR renders the stored layout; React
 * re-renders with the real viewport value after hydration (no hydration warning).
 */
function mediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(CHAT_DESKTOP_MEDIA_QUERY);
}

function subscribe(onStoreChange: () => void): () => void {
  const mql = mediaQueryList();
  if (!mql) return () => {};
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  return mediaQueryList()?.matches ?? true;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useChatDesktopViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
