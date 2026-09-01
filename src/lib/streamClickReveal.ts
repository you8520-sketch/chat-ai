import type { PendingRevealSession } from "@/lib/streamRevealIdentity";
import { shouldSkipRevealFinishClick } from "@/lib/trpg/followLatest";

export const STREAM_CLICK_REVEAL_OWNER = "streamClickReveal.ts";

/** Catch up visible buffer to already-received server text (not future chunks). */
export function catchUpStreamRevealToReceived(session: PendingRevealSession | undefined): boolean {
  if (!session?.catchUpToReceived) return false;
  session.catchUpToReceived();
  return true;
}

export function handleStreamRevealClick(
  event: { target: EventTarget | null },
  requestId: string | null | undefined,
  sessions: ReadonlyMap<string, PendingRevealSession>
): boolean {
  if (!requestId) return false;
  if (shouldSkipRevealFinishClick(event.target)) return false;
  return catchUpStreamRevealToReceived(sessions.get(requestId));
}
