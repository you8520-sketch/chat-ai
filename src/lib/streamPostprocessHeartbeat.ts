/**
 * Lightweight SSE keepalive during post-stream / post-process work.
 * Uses a dedicated event type so clients do not render heartbeat text in UI.
 */

export type StreamHeartbeatPhase = "postprocess" | "status_widget" | "finalizing";

/** 12s — within the recommended 10–15s idle window for proxies/mobile. */
export const STREAM_POSTPROCESS_HEARTBEAT_INTERVAL_MS = 12_000;

export function createStreamPostprocessHeartbeat(
  send: (obj: object) => void,
  opts?: { intervalMs?: number }
): {
  start: (phase?: StreamHeartbeatPhase) => void;
  setPhase: (phase: StreamHeartbeatPhase) => void;
  stop: () => void;
  isActive: () => boolean;
  activeTimerCount: () => number;
} {
  const intervalMs = opts?.intervalMs ?? STREAM_POSTPROCESS_HEARTBEAT_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let phase: StreamHeartbeatPhase = "postprocess";

  const tick = () => {
    send({ type: "stream_heartbeat", phase });
  };

  return {
    start(nextPhase: StreamHeartbeatPhase = "postprocess") {
      phase = nextPhase;
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    setPhase(nextPhase: StreamHeartbeatPhase) {
      phase = nextPhase;
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    isActive() {
      return timer != null;
    },
    activeTimerCount() {
      return timer ? 1 : 0;
    },
  };
}
