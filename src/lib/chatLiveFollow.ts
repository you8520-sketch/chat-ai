/**
 * General chat live-follow owner map (production path):
 * - CHAT_STREAM_TEXT_OWNER: createStreamReveal onAppend → messages[aiIndex].content
 * - CHAT_STREAM_END_SENTINEL_OWNER: data-chat-assistant-stream-end on active assistant row
 * - CHAT_AUTO_FOLLOW_OWNER: followStreamRef + userScrollLockRef + createLiveReadingFollowController
 * - CHAT_MANUAL_DETACH_OWNER: userScrollLockRef (wheel/touch/key up during stream)
 * - CHAT_JUMP_TO_LATEST_OWNER: scrollToBottom / discrete reattach on explicit user action
 */

import { LIVE_READING_TARGET_RATIO } from "./liveReadingFollow";

export const CHAT_ASSISTANT_STREAM_END_SELECTOR = "[data-chat-assistant-stream-end]";
export const CHAT_LIVE_FOLLOW_TARGET_RATIO = LIVE_READING_TARGET_RATIO;

/** Single owner for whether chat live-reading follow should be active. */
export function isChatLiveReadingActive(opts: {
  networkInFlight: boolean;
  visualRevealPendingCount: number;
}): boolean {
  return opts.networkInFlight || opts.visualRevealPendingCount > 0;
}

export function resolveActiveAssistantStreamEnd(opts: {
  endRef: { current: HTMLElement | null };
  activeRequestId?: string | null;
  root?: ParentNode | null;
}): Element | null {
  if (opts.endRef.current) return opts.endRef.current;
  if (!opts.activeRequestId || !opts.root) return null;
  return (
    opts.root.querySelector(
      `${CHAT_ASSISTANT_STREAM_END_SELECTOR}[data-chat-assistant-stream-request-id="${opts.activeRequestId}"]`
    ) ?? null
  );
}

export function shouldStartChatStreamFollow(opts: {
  followLatest: boolean;
  manualDetached: boolean;
}): boolean {
  return opts.followLatest && !opts.manualDetached;
}

export function resolveFollowBeforeStream(opts: {
  nearLatest: boolean;
  manualDetached: boolean;
}): { followLatest: boolean; manualDetached: boolean } {
  if (opts.nearLatest && !opts.manualDetached) {
    return { followLatest: true, manualDetached: false };
  }
  return { followLatest: false, manualDetached: true };
}

export function shouldDetachChatLiveFollowOnWheel(deltaY: number): boolean {
  return deltaY < 0;
}

export function shouldDetachChatLiveFollowOnTouchDelta(deltaY: number): boolean {
  return deltaY < 0;
}

export function shouldDetachChatLiveFollowOnKey(key: string): boolean {
  return key === "PageUp" || key === "Home" || key === "ArrowUp";
}

export function shouldSkipChatLiveFollowKeydown(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/** Layout growth during active stream — notify shared animator, never one-shot scroll. */
export function handleChatStreamLayoutGrowth(opts: {
  following: boolean;
  manualDetached: boolean;
  onTargetUpdate?: () => void;
}): void {
  if (!opts.following || opts.manualDetached) return;
  opts.onTargetUpdate?.();
}
