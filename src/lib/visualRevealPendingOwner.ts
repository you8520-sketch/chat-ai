export const VISUAL_REVEAL_PENDING_OWNER = "visualRevealPendingOwner.ts";

export type VisualRevealPendingIdStore = {
  ids: Set<string>;
};

/** Returns new count, or null when duplicate. */
export function addVisualRevealPendingId(
  store: VisualRevealPendingIdStore,
  requestId: string
): number | null {
  if (store.ids.has(requestId)) return null;
  store.ids.add(requestId);
  return store.ids.size;
}

/** Returns new count, or null when id was not pending. */
export function removeVisualRevealPendingId(
  store: VisualRevealPendingIdStore,
  requestId: string
): number | null {
  if (!store.ids.delete(requestId)) return null;
  return store.ids.size;
}

export function clearVisualRevealPendingIds(store: VisualRevealPendingIdStore): 0 {
  store.ids.clear();
  return 0;
}
