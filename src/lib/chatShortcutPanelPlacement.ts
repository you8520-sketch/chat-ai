export type PanelViewport = { top: number; left: number; width: number; height: number };

export type PanelPlacement =
  | { mode: "anchored"; lift: number; maxHeight: number }
  | { mode: "sheet"; top: number; left: number; width: number; maxHeight: number }; // offsets from the dock origin

export const PANEL_MAX_PX = 480;
export const PANEL_TOP_RESERVE_PX = 72;
export const PANEL_ANCHOR_GAP_PX = 4;
export const PANEL_ANCHORED_MIN_PX = 320;
export const PANEL_SHEET_INSET_PX = 8;
export const PANEL_SHEET_MAX_WIDTH_PX = 448;
export const PANEL_SHEET_COMPACT_PX = 300;

/**
 * Anchored: the panel sits above the composer, as long as the space between the
 * visible top edge and the composer can hold a usable panel.
 * Sheet: otherwise (short screens, on-screen keyboard) the panel is pinned inside
 * the visible viewport instead of being pushed above its top edge. Offsets are
 * relative to the dock origin because the panel stays `absolute` inside the dock
 * (a `fixed` panel would be trapped by the dock's blur/stacking context). It keeps
 * the dock's left edge, which sits inside the chat column's horizontal clip. The
 * chat input dock lifts its own z-index via `has-[[data-placement=sheet]]` so the
 * sheet is not hidden behind the site header and rails.
 */
export function computePanelPlacement(input: {
  composerTop: number;
  dockTop: number;
  dockLeft: number;
  viewport: PanelViewport;
}): PanelPlacement {
  const { composerTop, dockTop, dockLeft, viewport } = input;
  const available = Math.round(composerTop - viewport.top - PANEL_TOP_RESERVE_PX);
  const composerVisible = composerTop - PANEL_ANCHOR_GAP_PX <= viewport.top + viewport.height;

  if (composerVisible && available >= PANEL_ANCHORED_MIN_PX) {
    return {
      mode: "anchored",
      lift: Math.max(0, Math.round(dockTop - composerTop)) + PANEL_ANCHOR_GAP_PX,
      maxHeight: Math.min(PANEL_MAX_PX, available),
    };
  }

  const left = Math.max(viewport.left + PANEL_SHEET_INSET_PX, dockLeft);
  const right = viewport.left + viewport.width - PANEL_SHEET_INSET_PX;
  return {
    mode: "sheet",
    top: Math.round(viewport.top + PANEL_SHEET_INSET_PX - dockTop),
    left: Math.round(left - dockLeft),
    width: Math.max(0, Math.min(PANEL_SHEET_MAX_WIDTH_PX, Math.round(right - left))),
    maxHeight: Math.max(0, Math.round(viewport.height - PANEL_SHEET_INSET_PX * 2)),
  };
}
