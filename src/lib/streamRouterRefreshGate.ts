export const ASSISTANT_POST_TURN_REFRESH_OWNER = "streamRouterRefreshGate.ts";

export function shouldDeferResumePostTurnPoll(input: {
  visualRevealPendingCount: number;
}): boolean {
  return input.visualRevealPendingCount > 0;
}

export function shouldDeferAssistantPostTurnRefresh(input: {
  visualRevealPendingCount: number;
}): boolean {
  return input.visualRevealPendingCount > 0;
}

export type GlobalAssistantPostTurnRefreshCoordinator = {
  schedule: () => void;
  onVisualRevealPendingCountChanged: (count: number) => void;
  hasPendingRefresh: () => boolean;
  refreshCount: () => number;
};

/** Chat-global visual reveal gate — checks pending count at refresh execution time. */
export function createGlobalAssistantPostTurnRefreshCoordinator(input: {
  refresh: () => void;
  getVisualRevealPendingCount: () => number;
}): GlobalAssistantPostTurnRefreshCoordinator {
  let pendingRefresh = false;
  let refreshCalls = 0;

  const tryFlush = () => {
    if (shouldDeferAssistantPostTurnRefresh({ visualRevealPendingCount: input.getVisualRevealPendingCount() })) {
      return;
    }
    if (!pendingRefresh) return;
    pendingRefresh = false;
    refreshCalls += 1;
    input.refresh();
  };

  const schedule = () => {
    if (shouldDeferAssistantPostTurnRefresh({ visualRevealPendingCount: input.getVisualRevealPendingCount() })) {
      pendingRefresh = true;
      return;
    }
    pendingRefresh = false;
    refreshCalls += 1;
    input.refresh();
  };

  const onVisualRevealPendingCountChanged = (count: number) => {
    if (count === 0) tryFlush();
  };

  return {
    schedule,
    onVisualRevealPendingCountChanged,
    hasPendingRefresh: () => pendingRefresh,
    refreshCount: () => refreshCalls,
  };
}
