export type PanelAnchorRect = {
  right: number;
  bottom: number;
};

export type PanelPositionInput = {
  anchor: PanelAnchorRect;
  viewportWidth: number;
  viewportHeight: number;
  safeMargin?: number;
  maxWidth?: number;
  gap?: number;
};

export type PanelPosition = {
  top: number;
  left: number;
  width: number;
};

/** Keep the notification panel inside the viewport on narrow and wide screens. */
export function computeNotificationPanelPosition(input: PanelPositionInput): PanelPosition {
  const safeMargin = input.safeMargin ?? 12;
  const maxWidth = input.maxWidth ?? 400;
  const gap = input.gap ?? 8;
  const availableWidth = Math.max(0, input.viewportWidth - safeMargin * 2);
  const width = Math.min(maxWidth, availableWidth);
  const maxLeft = Math.max(safeMargin, input.viewportWidth - width - safeMargin);
  const preferredLeft = input.anchor.right - width;
  const left = Math.min(Math.max(safeMargin, preferredLeft), maxLeft);
  const top = Math.min(input.anchor.bottom + gap, Math.max(safeMargin, input.viewportHeight - safeMargin));
  return { top, left, width };
}

export function panelFitsHorizontally(
  position: PanelPosition,
  viewportWidth: number,
  safeMargin = 12
): boolean {
  return position.left >= safeMargin && position.left + position.width <= viewportWidth - safeMargin;
}
