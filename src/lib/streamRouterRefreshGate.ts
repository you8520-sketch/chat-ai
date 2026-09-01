export const STREAM_ROUTER_REFRESH_GATE_OWNER = "streamRouterRefreshGate.ts";

export function shouldDeferAssistantRouterRefresh(input: {
  streamIntervalMs: number;
  revealIdle: boolean;
}): boolean {
  return input.streamIntervalMs > 0 && !input.revealIdle;
}

export type DeferredRouterRefreshGate = {
  schedule: () => void;
  hasPendingDeferredRefresh: () => boolean;
  refreshCount: () => number;
};

export function createDeferredRouterRefreshGate(input: {
  refresh: () => void;
  isRevealIdle: () => boolean;
  streamIntervalMs: () => number;
  waitUntilRevealIdle: () => Promise<void>;
}): DeferredRouterRefreshGate {
  let deferredFlushPending = false;
  let waitingForIdle = false;
  let refreshCalls = 0;

  const schedule = () => {
    if (
      shouldDeferAssistantRouterRefresh({
        streamIntervalMs: input.streamIntervalMs(),
        revealIdle: input.isRevealIdle(),
      })
    ) {
      deferredFlushPending = true;
      if (waitingForIdle) return;
      waitingForIdle = true;
      void input.waitUntilRevealIdle().then(() => {
        waitingForIdle = false;
        if (!deferredFlushPending) return;
        deferredFlushPending = false;
        refreshCalls += 1;
        input.refresh();
      });
      return;
    }
    deferredFlushPending = false;
    refreshCalls += 1;
    input.refresh();
  };

  return {
    schedule,
    hasPendingDeferredRefresh: () => deferredFlushPending || waitingForIdle,
    refreshCount: () => refreshCalls,
  };
}
