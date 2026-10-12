/** A visual viewport shorter than the layout viewport by less than this is browser chrome (URL bar), not a keyboard. */
export const KEYBOARD_OPEN_THRESHOLD_PX = 120;

export type ViewportMetrics = {
  layoutHeight: number;
  viewportHeight: number;
  viewportOffsetTop: number;
  scale: number;
};

/** Height covered by the on-screen keyboard; 0 while pinch-zoomed or when only browser chrome moved. */
export function computeKeyboardInset(metrics: ViewportMetrics): number {
  if (metrics.scale > 1.01) return 0;
  const inset = metrics.layoutHeight - metrics.viewportHeight - metrics.viewportOffsetTop;
  return inset >= KEYBOARD_OPEN_THRESHOLD_PX ? Math.round(inset) : 0;
}
