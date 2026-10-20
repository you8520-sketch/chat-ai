import assert from "node:assert/strict";
import test from "node:test";
import {
  PANEL_SHEET_COMPACT_PX,
  computePanelPlacement,
  type PanelPlacement,
  type PanelViewport,
} from "./chatShortcutPanelPlacement";

const viewport = (height: number, over: Partial<PanelViewport> = {}): PanelViewport => ({
  top: 0,
  left: 0,
  width: 667,
  height,
  ...over,
});

function panelBox(placement: PanelPlacement, composerTop: number, dockTop: number) {
  if (placement.mode === "sheet") {
    return { top: dockTop + placement.top, bottom: dockTop + placement.top + placement.maxHeight };
  }
  const bottom = composerTop - 4;
  return { top: bottom - placement.maxHeight, bottom };
}

test("tall screens keep the panel anchored above the composer", () => {
  const placement = computePanelPlacement({ composerTop: 700, dockTop: 760, dockLeft: 12, viewport: viewport(844, { width: 390 }) });
  assert.equal(placement.mode, "anchored");
  assert.equal(placement.mode === "anchored" && placement.maxHeight, 480);
  assert.equal(placement.mode === "anchored" && placement.lift, 64);
});

test("anchored height follows the space above the composer without a floor", () => {
  const placement = computePanelPlacement({ composerTop: 400, dockTop: 440, dockLeft: 12, viewport: viewport(568, { width: 320 }) });
  assert.equal(placement.mode, "anchored");
  assert.equal(placement.mode === "anchored" && placement.maxHeight, 328);
});

test("composer top 180 switches to a sheet instead of a negative panel top", () => {
  const placement = computePanelPlacement({ composerTop: 180, dockTop: 220, dockLeft: 12, viewport: viewport(375) });
  assert.equal(placement.mode, "sheet");
  const box = panelBox(placement, 180, 220);
  assert.ok(box.top >= 0);
  assert.ok(box.bottom <= 375);
});

test("every composer position leaves the panel inside the visible viewport", () => {
  for (const height of [170, 200, 250, 375, 568, 844]) {
    for (const viewTop of [0, 60, 120]) {
      for (let composerTop = viewTop - 40; composerTop <= viewTop + height + 40; composerTop += 10) {
        const view = viewport(height, { top: viewTop });
        const placement = computePanelPlacement({ composerTop, dockTop: composerTop + 40, dockLeft: 12, viewport: view });
        const box = panelBox(placement, composerTop, composerTop + 40);
        assert.ok(box.top >= viewTop, `top ${box.top} < ${viewTop} (h=${height}, composer=${composerTop})`);
        assert.ok(box.bottom <= viewTop + height, `bottom ${box.bottom} (h=${height}, composer=${composerTop})`);
      }
    }
  }
});

test("a composer hidden below the visible viewport uses the sheet", () => {
  const placement = computePanelPlacement({ composerTop: 500, dockTop: 540, dockLeft: 12, viewport: viewport(300) });
  assert.equal(placement.mode, "sheet");
});

test("sheet follows visualViewport offset and clamps the width", () => {
  const placement = computePanelPlacement({
    composerTop: 100,
    dockTop: 140,
    dockLeft: 20,
    viewport: { top: 60, left: 4, width: 320, height: 200 },
  });
  assert.deepEqual(placement, { mode: "sheet", top: -72, left: 0, width: 296, maxHeight: 184 });
});

test("sheet keeps the dock left edge and stays inside the right edge", () => {
  const wide = computePanelPlacement({
    composerTop: 100,
    dockTop: 140,
    dockLeft: 84,
    viewport: viewport(375),
  });
  assert.deepEqual(wide, { mode: "sheet", top: -132, left: 0, width: 448, maxHeight: 359 });
  const narrow = computePanelPlacement({
    composerTop: 100,
    dockTop: 140,
    dockLeft: 12,
    viewport: viewport(375, { width: 320 }),
  });
  assert.equal(narrow.mode === "sheet" && 12 + narrow.left + narrow.width, 312);
});

test("compact threshold is below the 667x375 sheet height", () => {
  const placement = computePanelPlacement({ composerTop: 268, dockTop: 308, dockLeft: 12, viewport: viewport(375) });
  assert.equal(placement.mode, "sheet");
  assert.ok(placement.mode === "sheet" && placement.maxHeight > PANEL_SHEET_COMPACT_PX);
});
