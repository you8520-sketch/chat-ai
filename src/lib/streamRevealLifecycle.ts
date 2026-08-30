import type { StreamRevealController } from "@/lib/streamReveal";

/** Request/stream terminal vs visual reveal queue idle — separate lifecycles. */
export type StreamRevealTerminationPlan =
  | { action: "end_sync"; flush: boolean }
  | { action: "end_deferred" };

export function planStreamRevealTermination(input: {
  instantReveal: boolean;
  isIdle: boolean;
  hadError: boolean;
  trafficOverload: boolean;
}): StreamRevealTerminationPlan {
  if (input.hadError || input.trafficOverload) {
    return { action: "end_sync", flush: true };
  }
  if (input.instantReveal || input.isIdle) {
    return { action: "end_sync", flush: input.instantReveal };
  }
  return { action: "end_deferred" };
}

export type StreamRevealSessionEnd = {
  removeVisibilityListener: () => void;
  reveal: StreamRevealController;
  flush?: boolean;
};

/** Visual reveal lifetime — runs sync or after queue drains. */
export function runStreamRevealTermination(
  plan: StreamRevealTerminationPlan,
  session: StreamRevealSessionEnd,
  onComplete?: () => void
): void {
  const finish = () => {
    session.removeVisibilityListener();
    if (session.flush) session.reveal.flush();
    session.reveal.setBackgroundMode(false);
    onComplete?.();
  };

  if (plan.action === "end_sync") {
    finish();
    return;
  }

  void session.reveal.waitUntilIdle().then(finish);
}
