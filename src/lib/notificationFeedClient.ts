import type { NoticeFeedRow, UserNotificationRow } from "./userNotificationPresentation";

export const NOTIFICATION_FEED_REFRESH_MS = 30_000;

export type NotificationFeedPayload = {
  recentNotices: NoticeFeedRow[];
  activities: UserNotificationRow[];
  unreadCount: number;
};

export async function fetchNotificationFeed(): Promise<NotificationFeedPayload | null> {
  const res = await fetch("/api/notifications", { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as NotificationFeedPayload;
}

/** Single polling owner — Bell uses this; Panel must not start its own interval. */
export function shouldPanelOwnNotificationPolling(): boolean {
  return false;
}
