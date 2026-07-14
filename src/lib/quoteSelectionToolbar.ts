export type QuoteToolbarPoint = { x: number; y: number };

export function clampQuoteToolbarPosition(
  point: QuoteToolbarPoint,
  viewport: { width: number; height: number },
  opts: { offset?: number; toolbarWidth?: number; toolbarHeight?: number; margin?: number } = {}
): QuoteToolbarPoint {
  const offset = opts.offset ?? 14;
  const toolbarWidth = opts.toolbarWidth ?? 112;
  const toolbarHeight = opts.toolbarHeight ?? 40;
  const margin = opts.margin ?? 8;
  const maxX = Math.max(margin, viewport.width - toolbarWidth - margin);
  const maxY = Math.max(margin, viewport.height - toolbarHeight - margin);
  return {
    x: Math.min(maxX, Math.max(margin, point.x + offset)),
    y: Math.min(maxY, Math.max(margin, point.y + offset)),
  };
}

export type CoalescedScheduler = {
  schedule: (fn: () => void, delayMs?: number) => void;
  cancel: () => void;
};

export function createCoalescedSelectionScheduler(timers: {
  requestAnimationFrame: (cb: () => void) => number;
  cancelAnimationFrame: (id: number) => void;
  setTimeout: (cb: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}): CoalescedScheduler {
  let rafId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (rafId != null) {
      timers.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (timeoutId != null) {
      timers.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return {
    schedule(fn, delayMs = 35) {
      cancel();
      rafId = timers.requestAnimationFrame(() => {
        rafId = null;
        timeoutId = timers.setTimeout(() => {
          timeoutId = null;
          fn();
        }, delayMs);
      });
    },
    cancel,
  };
}
