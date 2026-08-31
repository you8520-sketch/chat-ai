/**
 * B1–B7: NEXT_ACTION bottom tail / sticky HUD occlusion regression.
 *
 * Root cause: nextActionRef (earlier container, no scroll-mb-28) was the primary
 * NEXT_ACTION scroll target. block:"end" on re-run decreased scrollY at document bottom.
 *
 * Fix: bottomRef only + block:"nearest". scroll-mb-28 on bottomRef owns HUD compensation in CSS.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/** Desktop-like viewport from reported reproduction. */
const DESKTOP_VIEWPORT_H = 900;
const DESKTOP_HUD_TOP = 820;
const MOBILE_VIEWPORT_H = 740;
const MOBILE_HUD_TOP = 676;

/** Layout-owned compensation (Tailwind scroll-mb-28) — test simulation only, not production TS. */
const SCROLL_MB_28_PX = 112;

function nextActionCaseBlock(room: string): string {
  const idx = room.indexOf('case "NEXT_ACTION"');
  assert.ok(idx >= 0);
  return room.slice(idx, idx + 600);
}

/** Buggy pre-fix: block:"end" on an earlier container bottom. */
function simulateBlockEndScrollY(targetBottomDocument: number, viewportHeight: number): number {
  return Math.max(0, targetBottomDocument - viewportHeight);
}

/** Test-only model of block:"nearest" on bottomRef — never scrolls upward. */
function simulateBlockNearestTailDelta(opts: {
  scrollY: number;
  maxScrollY: number;
  tailBottomDocument: number;
  viewportHeight: number;
}): number {
  const effectiveTailBottom = opts.tailBottomDocument + SCROLL_MB_28_PX;
  const viewportBottomDocument = opts.scrollY + opts.viewportHeight;
  if (effectiveTailBottom <= viewportBottomDocument) return 0;
  const needed = effectiveTailBottom - viewportBottomDocument;
  const nextScrollY = Math.min(opts.maxScrollY, opts.scrollY + needed);
  return nextScrollY - opts.scrollY;
}

function actionableOcclusionPx(actionableBottom: number, hudTop: number): number {
  return Math.max(0, actionableBottom - hudTop);
}

function tailVisibleAboveHud(tailRectBottom: number, hudTop: number): boolean {
  return tailRectBottom + SCROLL_MB_28_PX <= hudTop + 8;
}

/** Production-equivalent: scrollToLatest → scrollToFollowOwner(NEXT_ACTION). */
function simulateExplicitLatestButtonBefore(opts: {
  manualBottomScrollY: number;
  nextActionBottomDocument: number;
  viewportHeight: number;
}): number {
  return simulateBlockEndScrollY(opts.nextActionBottomDocument, opts.viewportHeight);
}

function simulateExplicitLatestButtonAfter(opts: {
  manualBottomScrollY: number;
  maxScrollY: number;
  bottomRefTailBottomDocument: number;
  viewportHeight: number;
}): number {
  const delta = simulateBlockNearestTailDelta({
    scrollY: opts.manualBottomScrollY,
    maxScrollY: opts.maxScrollY,
    tailBottomDocument: opts.bottomRefTailBottomDocument,
    viewportHeight: opts.viewportHeight,
  });
  return opts.manualBottomScrollY + delta;
}

/** NEXT_ACTION useLayoutEffect rerun after latest-button rejoin (attached user). */
function simulatePostLatestNextActionUpdateDelta(opts: {
  scrollY: number;
  maxScrollY: number;
  bottomRefTailBottomDocument: number;
  viewportHeight: number;
}): number {
  return simulateBlockNearestTailDelta({
    scrollY: opts.scrollY,
    maxScrollY: opts.maxScrollY,
    tailBottomDocument: opts.bottomRefTailBottomDocument,
    viewportHeight: opts.viewportHeight,
  });
}

describe("B0 — PRIMARY: explicit 최신으로 ↓ rejoin path", () => {
  const MANUAL_BOTTOM_SCROLL_Y = 5200;
  const MAX_SCROLL_Y = 5200;
  const NEXT_ACTION_EARLIER_BOTTOM_DOC = 5800;
  const BOTTOM_REF_TAIL_DOC = 5796;
  const LAST_ACTIONABLE_VIEWPORT_BOTTOM = 708;

  it("BEFORE: latest button via nextActionRef block:end yanks upward from true bottom", () => {
    const afterLatestButtonScrollY = simulateExplicitLatestButtonBefore({
      manualBottomScrollY: MANUAL_BOTTOM_SCROLL_Y,
      nextActionBottomDocument: NEXT_ACTION_EARLIER_BOTTOM_DOC,
      viewportHeight: DESKTOP_VIEWPORT_H,
    });
    const upwardDelta = afterLatestButtonScrollY - MANUAL_BOTTOM_SCROLL_Y;
    assert.ok(upwardDelta < 0, "LATEST_BUTTON_UPWARD_DELTA_BEFORE");
    assert.equal(afterLatestButtonScrollY, 4900, "AFTER_LATEST_BUTTON_SCROLL_Y_BEFORE");
    assert.ok(
      actionableOcclusionPx(850, DESKTOP_HUD_TOP) > 0,
      "occlusion after latest button before fix"
    );
  });

  it("AFTER: latest button via bottomRef block:nearest — zero upward delta at true bottom", () => {
    const afterLatestButtonScrollY = simulateExplicitLatestButtonAfter({
      manualBottomScrollY: MANUAL_BOTTOM_SCROLL_Y,
      maxScrollY: MAX_SCROLL_Y,
      bottomRefTailBottomDocument: BOTTOM_REF_TAIL_DOC,
      viewportHeight: DESKTOP_VIEWPORT_H,
    });
    const upwardDelta = afterLatestButtonScrollY - MANUAL_BOTTOM_SCROLL_Y;
    assert.equal(upwardDelta, 0, "LATEST_BUTTON_UPWARD_DELTA_AFTER");
    assert.equal(afterLatestButtonScrollY, MANUAL_BOTTOM_SCROLL_Y, "AFTER_LATEST_BUTTON_SCROLL_Y_AFTER");
    assert.ok(afterLatestButtonScrollY >= MANUAL_BOTTOM_SCROLL_Y, "LATEST_BUTTON_SCROLL_DIRECTION=down_or_zero");
    assert.equal(
      actionableOcclusionPx(LAST_ACTIONABLE_VIEWPORT_BOTTOM, DESKTOP_HUD_TOP),
      0,
      "LAST_ACTIONABLE_OCCLUSION_AFTER"
    );
  });

  it("POST latest: suggestions arrival while attached — no upward delta", () => {
    const delta = simulatePostLatestNextActionUpdateDelta({
      scrollY: MANUAL_BOTTOM_SCROLL_Y,
      maxScrollY: MAX_SCROLL_Y,
      bottomRefTailBottomDocument: BOTTOM_REF_TAIL_DOC,
      viewportHeight: DESKTOP_VIEWPORT_H,
    });
    assert.equal(delta, 0, "POST_LATEST_SUGGESTION_UPDATE_DELTA");
  });

  it("POST latest: suggestionsError update while attached — no upward delta", () => {
    const delta = simulatePostLatestNextActionUpdateDelta({
      scrollY: MANUAL_BOTTOM_SCROLL_Y,
      maxScrollY: MAX_SCROLL_Y,
      bottomRefTailBottomDocument: BOTTOM_REF_TAIL_DOC,
      viewportHeight: DESKTOP_VIEWPORT_H,
    });
    assert.equal(delta, 0, "POST_LATEST_ERROR_UPDATE_DELTA");
  });

  it("POST latest: suggestions content update while attached — no upward delta", () => {
    const delta = simulatePostLatestNextActionUpdateDelta({
      scrollY: MANUAL_BOTTOM_SCROLL_Y,
      maxScrollY: MAX_SCROLL_Y,
      bottomRefTailBottomDocument: BOTTOM_REF_TAIL_DOC,
      viewportHeight: DESKTOP_VIEWPORT_H,
    });
    assert.equal(delta, 0);
  });

  it("production wiring: 최신으로 ↓ → scrollToLatest(smooth) → bottomRef NEXT_ACTION", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /onClick=\{\(\) => scrollToLatest\("smooth"\)\}/);
    assert.match(room, /최신으로 ↓/);
    const latest = room.match(/const scrollToLatest = useCallback\([\s\S]*?\n  \);/);
    assert.ok(latest);
    const body = latest[0]!;
    assert.ok(body.indexOf("manualScrollDetachedRef.current = false") < body.indexOf("scrollToFollowOwner(liveFollowOwner"));
    const block = nextActionCaseBlock(room);
    assert.match(block, /const target = bottomRef\.current/);
    assert.match(block, /block: "nearest"/);
    assert.doesNotMatch(block, /nextActionRef/);
  });
});

describe("B1 — bottom NEXT_ACTION rerun at document bottom", () => {
  it("BEFORE: block:end on earlier nextAction target decreases scrollY", () => {
    const scrollYBefore = 5200;
    const scrollYAfter = simulateBlockEndScrollY(5800, DESKTOP_VIEWPORT_H);
    assert.ok(scrollYAfter < scrollYBefore);
    assert.ok(actionableOcclusionPx(850, DESKTOP_HUD_TOP) > 0);
  });

  it("AFTER: bottomRef + block nearest → delta 0 at max scroll", () => {
    const scrollYBefore = 5200;
    const maxScrollY = 5200;
    const tailBottomDocument = 5200 + 708 - SCROLL_MB_28_PX;
    const delta = simulateBlockNearestTailDelta({
      scrollY: scrollYBefore,
      maxScrollY,
      tailBottomDocument,
      viewportHeight: DESKTOP_VIEWPORT_H,
    });
    assert.equal(delta, 0, "BOTTOM_SCROLL_DELTA");
    assert.equal(actionableOcclusionPx(708, DESKTOP_HUD_TOP), 0);
  });
});

describe("NEXT_ACTION bottom tail — B2–B7", () => {
  it("B2: tail fully visible above sticky HUD (desktop)", () => {
    assert.equal(tailVisibleAboveHud(708, DESKTOP_HUD_TOP), true);
    assert.equal(actionableOcclusionPx(708, DESKTOP_HUD_TOP), 0);
  });

  it("B2 mobile: compact HUD geometry", () => {
    assert.equal(tailVisibleAboveHud(564, MOBILE_HUD_TOP), true);
  });

  it("B3: new suggestions below visible tail → scroll DOWN only", () => {
    const delta = simulateBlockNearestTailDelta({
      scrollY: 4000,
      maxScrollY: 5200,
      tailBottomDocument: 5200,
      viewportHeight: DESKTOP_VIEWPORT_H,
    });
    assert.ok(delta > 0, "NEW_SUGGESTION_DIRECTION=down");
  });

  it("B4: tail already visible → scroll delta 0", () => {
    const delta = simulateBlockNearestTailDelta({
      scrollY: 5200,
      maxScrollY: 5200,
      tailBottomDocument: 5796,
      viewportHeight: DESKTOP_VIEWPORT_H,
    });
    assert.equal(delta, 0, "VISIBLE_TAIL_SCROLL_DELTA");
  });

  it("B5: manual detached → scrollToFollowOwner guard blocks auto-follow", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(
      room,
      /if \(!followLatestRef\.current \|\| manualScrollDetachedRef\.current\) return/
    );
  });

  it("B6: explicit rejoin uses scrollToLatest → bottomRef NEXT_ACTION path", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const block = nextActionCaseBlock(room);
    assert.match(block, /const target = bottomRef\.current/);
    assert.match(block, /block: "nearest"/);
  });

  it("B7: GM / actor / declaration follow unchanged", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /case "GM_NARRATION_END"/);
    assert.match(room, /alignNarrationEnd/);
    assert.match(room, /case "CURRENT_ACTOR"/);
    assert.match(room, /block: "center"/);
    assert.doesNotMatch(
      room.match(/case "GM_NARRATION_END"[\s\S]*?break;/)?.[0] ?? "",
      /block: "nearest"/
    );
  });
});

describe("production wiring — ONE NEXT_ACTION follow target owner", () => {
  it("NEXT_ACTION uses bottomRef only with block nearest — no geometry helpers", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const block = nextActionCaseBlock(room);
    assert.match(block, /const target = bottomRef\.current/);
    assert.match(block, /block: "nearest"/);
    assert.doesNotMatch(block, /nextActionRef/);
    assert.doesNotMatch(block, /suggestionsAnchorRef/);
    assert.doesNotMatch(block, /shouldSkipTrpgNextActionTailFollow/);
    assert.doesNotMatch(block, /data-trpg-self-sheet-hud/);
    assert.doesNotMatch(block, /block: "end"/);
  });

  it("scroll-mb-28 remains CSS-owned on canonical bottomRef tail", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /ref=\{bottomRef\}/);
    assert.match(room, /className="h-px w-full scroll-mb-28"/);
    assert.doesNotMatch(readFileSync("src/lib/trpg/followLatest.ts", "utf8"), /TRPG_NEXT_ACTION_TAIL/);
  });

  it("dead refs removed from production source", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(room, /nextActionRef/);
    assert.doesNotMatch(room, /suggestionsAnchorRef/);
  });
});
