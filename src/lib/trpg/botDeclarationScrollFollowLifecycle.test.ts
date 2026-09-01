/**
 * Helper-chain lifecycle proof for Bot declaration auto-follow owners.
 *
 * PROVEN scope (NOT full ResizeObserver→RAF→scrollBy end-to-end):
 *   handleTrpgLiveSceneResizeGrowth (ResizeObserver callback owner)
 *   → RAF → scrollToFollowOwner → scheduleTrpgReadingBandEndFollow
 *   → readingBandFollowDeltaFromElement → scrollBy
 *
 * Growth simulation triggers the mounted ResizeObserver instance via fireResize().
 * This does NOT prove full TrpgCampaignRoom React mount or browser viewport behavior.
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  applyTrpgReadingBandEndFollow,
  beginTrpgProgrammaticScroll,
  cancelTrpgProgrammaticScroll,
  createTrpgProgrammaticScrollHandle,
  handleTrpgLiveSceneResizeGrowth,
  resolveTrpgLiveFollowOwner,
  scheduleTrpgReadingBandEndFollow,
  TRPG_NARRATION_FOLLOW_TARGET_RATIO,
} from "./followLatest";

type SavedGlobals = {
  window: Window & typeof globalThis;
  document: Document;
  requestAnimationFrame: typeof globalThis.requestAnimationFrame;
  cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
  ResizeObserver: typeof globalThis.ResizeObserver;
};

type RafEntry = { id: number; fn: FrameRequestCallback };

type DomHarness = {
  document: Document;
  window: Window;
  getScrollY: () => number;
  setScrollY: (value: number) => void;
  flushRaf: (passes?: number) => void;
  fireResize: (el: Element) => void;
  restore: () => void;
};

function installDomHarness(viewportHeight = 800): DomHarness {
  const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  const saved: SavedGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    ResizeObserver: globalThis.ResizeObserver,
  };

  globalThis.window = win;
  globalThis.document = win.document;

  let scrollY = 1200;
  Object.defineProperty(win, "scrollY", {
    get: () => scrollY,
    configurable: true,
  });
  Object.defineProperty(win, "innerHeight", {
    value: viewportHeight,
    configurable: true,
  });
  win.scrollBy = ((opts: ScrollToOptions) => {
    scrollY += opts.top ?? 0;
  }) as typeof win.scrollBy;

  const rafQueue: RafEntry[] = [];
  let rafSeq = 0;
  win.requestAnimationFrame = ((fn: FrameRequestCallback) => {
    rafSeq += 1;
    rafQueue.push({ id: rafSeq, fn });
    return rafSeq;
  }) as typeof win.requestAnimationFrame;
  win.cancelAnimationFrame = ((id: number) => {
    const idx = rafQueue.findIndex((entry) => entry.id === id);
    if (idx >= 0) rafQueue.splice(idx, 1);
  }) as typeof win.cancelAnimationFrame;

  const resizeCallbacks = new Map<Element, ResizeObserverCallback>();
  class TestResizeObserver implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      resizeCallbacks.set(target, this.callback);
    }
    unobserve(): void {}
    disconnect(): void {
      for (const key of resizeCallbacks.keys()) {
        if (resizeCallbacks.get(key) === this.callback) resizeCallbacks.delete(key);
      }
    }
  }
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof globalThis.ResizeObserver;

  return {
    document: win.document,
    window: win,
    getScrollY: () => scrollY,
    setScrollY: (value: number) => {
      scrollY = value;
    },
    flushRaf: (passes = 1) => {
      for (let pass = 0; pass < passes; pass += 1) {
        const batch = rafQueue.splice(0, rafQueue.length);
        for (const entry of batch) entry.fn(0);
      }
    },
    fireResize: (el: Element) => {
      const cb = resizeCallbacks.get(el);
      cb?.([], {} as ResizeObserver);
    },
    restore: () => {
      globalThis.window = saved.window;
      globalThis.document = saved.document;
      globalThis.requestAnimationFrame = saved.requestAnimationFrame;
      globalThis.cancelAnimationFrame = saved.cancelAnimationFrame;
      globalThis.ResizeObserver = saved.ResizeObserver;
    },
  };
}

function proseLengthToEndTop(length: number, baseTop = 520): number {
  return baseTop + Math.floor(length * 0.9);
}

function createDeclarationElements(
  document: Document,
  endTop: number
): { sceneEl: HTMLElement; growthEl: HTMLElement; endEl: HTMLSpanElement } {
  const sceneEl = document.createElement("section");
  sceneEl.setAttribute("data-trpg-live-scene", "true");
  const growthEl = document.createElement("div");
  growthEl.setAttribute("data-trpg-declaration-growth", "true");
  const endEl = document.createElement("span");
  endEl.setAttribute("data-trpg-declaration-end", "true");
  const rect = () => ({
    top: endTop,
    left: 0,
    right: 0,
    bottom: endTop + 1,
    width: 0,
    height: 1,
    x: 0,
    y: endTop,
    toJSON: () => ({}),
  });
  endEl.getBoundingClientRect = rect;
  growthEl.appendChild(endEl);
  sceneEl.appendChild(growthEl);
  document.body.appendChild(sceneEl);
  return { sceneEl, growthEl, endEl };
}

function createProductionScrollFollowController(opts: {
  window: Window;
  declarationEndEl: Element;
  getFollowing: () => boolean;
  getManualDetached: () => boolean;
  getLiveFollowOwner: () => ReturnType<typeof resolveTrpgLiveFollowOwner>;
}) {
  const followScrollRafRef = { current: null as number | null };
  const narrationFollowRafRef = { current: null as number | null };
  const programmaticHandle = createTrpgProgrammaticScrollHandle();
  let programmaticActive = false;

  const cancelPendingFollowScroll = () => {
    if (narrationFollowRafRef.current != null) {
      opts.window.cancelAnimationFrame(narrationFollowRafRef.current);
      narrationFollowRafRef.current = null;
    }
    if (followScrollRafRef.current != null) {
      opts.window.cancelAnimationFrame(followScrollRafRef.current);
      followScrollRafRef.current = null;
    }
  };

  const syncProgrammaticScrollActive = (active: boolean) => {
    programmaticActive = active;
  };

  const runProgrammaticScroll = (fn: () => void, behavior: ScrollBehavior = "instant") => {
    beginTrpgProgrammaticScroll({
      handle: programmaticHandle,
      behavior,
      scrollEndSupported: false,
      onActiveChange: syncProgrammaticScrollActive,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms) as ReturnType<typeof setTimeout>,
    });
    fn();
  };

  const scrollToFollowOwner = (owner: ReturnType<typeof resolveTrpgLiveFollowOwner>, behavior: ScrollBehavior = "instant") => {
    if (!opts.getFollowing() || opts.getManualDetached()) return;
    if (owner === "ACTIVE_DECLARATION_END") {
      scheduleTrpgReadingBandEndFollow({
        element: opts.declarationEndEl,
        behavior,
        narrationFollowRafRef,
        requestAnimationFrame: opts.window.requestAnimationFrame.bind(opts.window),
        cancelAnimationFrame: opts.window.cancelAnimationFrame.bind(opts.window),
        scrollBy: (delta, scrollBehavior) => {
          opts.window.scrollBy({ top: delta, behavior: scrollBehavior ?? "instant" });
        },
        runProgrammaticScroll,
        cancelPendingFollowScroll,
      });
    }
  };

  const onResizeObserverFire = () => {
    handleTrpgLiveSceneResizeGrowth({
      following: opts.getFollowing(),
      manualDetached: opts.getManualDetached(),
      liveFollowOwner: opts.getLiveFollowOwner(),
      followScrollRafRef,
      requestAnimationFrame: opts.window.requestAnimationFrame.bind(opts.window),
      cancelAnimationFrame: opts.window.cancelAnimationFrame.bind(opts.window),
      scrollToFollowOwner,
      onUnseenLatest: () => {},
    });
  };

  return {
    followScrollRafRef,
    narrationFollowRafRef,
    onResizeObserverFire,
    scrollToFollowOwner,
    cancelPendingFollowScroll,
    programmaticActive: () => programmaticActive,
    cleanupProgrammatic: () => {
      cancelTrpgProgrammaticScroll({
        handle: programmaticHandle,
        onActiveChange: syncProgrammaticScrollActive,
      });
    },
  };
}

function simulateBotProseGrowth(opts: {
  fireResize: (el: Element) => void;
  growthEl: HTMLElement;
  endEl: HTMLSpanElement;
  lengths: readonly number[];
  flushRaf: (passes?: number) => void;
  getScrollY: () => number;
}): number[] {
  const scrollDeltas: number[] = [];
  let previous = opts.getScrollY();
  for (const length of opts.lengths) {
    const endTop = proseLengthToEndTop(length);
    opts.endEl.getBoundingClientRect = () => ({
      top: endTop,
      left: 0,
      right: 0,
      bottom: endTop + 1,
      width: 0,
      height: 1,
      x: 0,
      y: endTop,
      toJSON: () => ({}),
    });
    opts.fireResize(opts.growthEl);
    opts.flushRaf(4);
    const next = opts.getScrollY();
    scrollDeltas.push(next - previous);
    previous = next;
  }
  return scrollDeltas;
}

describe("TRPG bot declaration scroll-follow mounted lifecycle", () => {
  let harness: DomHarness;

  beforeEach(() => {
    harness = installDomHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it("1: helper chain — growth via ResizeObserver instance → RAF → scrollBy", () => {
    const targetY = harness.window.innerHeight * TRPG_NARRATION_FOLLOW_TARGET_RATIO;
    const { growthEl, endEl } = createDeclarationElements(harness.document, proseLengthToEndTop(20));
    let following = true;
    let manualDetached = false;
    const controller = createProductionScrollFollowController({
      window: harness.window,
      declarationEndEl: endEl,
      getFollowing: () => following,
      getManualDetached: () => manualDetached,
      getLiveFollowOwner: () =>
        resolveTrpgLiveFollowOwner({
          cinematicMotion: true,
          activeDeclarationReveal: true,
          freshGmRound: null,
          gmRevealComplete: false,
          nextActionVisible: false,
        }),
    });

    const observer = new ResizeObserver(() => controller.onResizeObserverFire());
    observer.observe(growthEl);

    const deltas = simulateBotProseGrowth({
      fireResize: harness.fireResize,
      growthEl,
      endEl,
      lengths: [20, 80, 180, 350, 600],
      flushRaf: harness.flushRaf,
      getScrollY: harness.getScrollY,
    });

    assert.ok(deltas.some((delta) => delta > 0), "viewport advances on prose growth");
    assert.ok(
      endEl.getBoundingClientRect().top > targetY || harness.getScrollY() > 1200,
      "declaration end tracked toward reading band"
    );
    controller.cleanupProgrammatic();
    observer.disconnect();
  });

  it("2: manual detach blocks programmatic scroll on subsequent growth", () => {
    const { growthEl, endEl } = createDeclarationElements(harness.document, proseLengthToEndTop(80));
    let following = false;
    let manualDetached = true;
    const controller = createProductionScrollFollowController({
      window: harness.window,
      declarationEndEl: endEl,
      getFollowing: () => following,
      getManualDetached: () => manualDetached,
      getLiveFollowOwner: () => "ACTIVE_DECLARATION_END",
    });

    const observer = new ResizeObserver(() => controller.onResizeObserverFire());
    observer.observe(growthEl);

    const before = harness.getScrollY();
    simulateBotProseGrowth({
      fireResize: harness.fireResize,
      growthEl,
      endEl,
      lengths: [180, 350, 600],
      flushRaf: harness.flushRaf,
      getScrollY: harness.getScrollY,
    });
    assert.equal(harness.getScrollY(), before, "MANUAL_DETACH preserved — no forced scroll");
    controller.cleanupProgrammatic();
    observer.disconnect();
  });

  it("3: explicit follow restore resumes growth follow", () => {
    const { endEl } = createDeclarationElements(harness.document, proseLengthToEndTop(350));
    let following = false;
    let manualDetached = true;
    const controller = createProductionScrollFollowController({
      window: harness.window,
      declarationEndEl: endEl,
      getFollowing: () => following,
      getManualDetached: () => manualDetached,
      getLiveFollowOwner: () => "ACTIVE_DECLARATION_END",
    });

    const stalled = harness.getScrollY();
    endEl.getBoundingClientRect = () => ({
      top: proseLengthToEndTop(600),
      left: 0,
      right: 0,
      bottom: proseLengthToEndTop(600) + 1,
      width: 0,
      height: 1,
      x: 0,
      y: proseLengthToEndTop(600),
      toJSON: () => ({}),
    });
    controller.onResizeObserverFire();
    harness.flushRaf(4);
    assert.equal(harness.getScrollY(), stalled);

    manualDetached = false;
    following = true;
    controller.scrollToFollowOwner("ACTIVE_DECLARATION_END", "instant");
    harness.flushRaf(4);
    assert.ok(harness.getScrollY() > stalled, "explicit restore rejoins declaration follow");
    controller.cleanupProgrammatic();
  });

  it("4: Bot1 → Bot2 transition follows new declaration end", () => {
    const bot1 = createDeclarationElements(harness.document, proseLengthToEndTop(80));
    const bot2 = createDeclarationElements(harness.document, proseLengthToEndTop(40));
    let activeEnd = bot1.endEl;
    let following = true;
    let manualDetached = false;
    const controller = createProductionScrollFollowController({
      window: harness.window,
      declarationEndEl: activeEnd,
      getFollowing: () => following,
      getManualDetached: () => manualDetached,
      getLiveFollowOwner: () => "ACTIVE_DECLARATION_END",
    });

    const bot1Before = harness.getScrollY();
    bot1.endEl.getBoundingClientRect = () => ({
      top: proseLengthToEndTop(600),
      left: 0,
      right: 0,
      bottom: proseLengthToEndTop(600) + 1,
      width: 0,
      height: 1,
      x: 0,
      y: proseLengthToEndTop(600),
      toJSON: () => ({}),
    });
    controller.onResizeObserverFire();
    harness.flushRaf(4);
    assert.ok(harness.getScrollY() > bot1Before, "Bot1 growth follow");

    activeEnd = bot2.endEl;
    const bot2Controller = createProductionScrollFollowController({
      window: harness.window,
      declarationEndEl: activeEnd,
      getFollowing: () => following,
      getManualDetached: () => manualDetached,
      getLiveFollowOwner: () => "ACTIVE_DECLARATION_END",
    });
    const bot2Before = harness.getScrollY();
    bot2.endEl.getBoundingClientRect = () => ({
      top: proseLengthToEndTop(650),
      left: 0,
      right: 0,
      bottom: proseLengthToEndTop(650) + 1,
      width: 0,
      height: 1,
      x: 0,
      y: proseLengthToEndTop(650),
      toJSON: () => ({}),
    });
    bot2Controller.onResizeObserverFire();
    harness.flushRaf(4);
    assert.ok(harness.getScrollY() > bot2Before, "BOT1_TO_BOT2_FOLLOW");
    bot2Controller.cleanupProgrammatic();
    controller.cleanupProgrammatic();
  });

  it("5: second round uses same lifecycle owners", () => {
    const round2End = createDeclarationElements(harness.document, proseLengthToEndTop(20));
    round2End.sceneEl.setAttribute("data-round", "2");
    let following = true;
    const controller = createProductionScrollFollowController({
      window: harness.window,
      declarationEndEl: round2End.endEl,
      getFollowing: () => following,
      getManualDetached: () => false,
      getLiveFollowOwner: () =>
        resolveTrpgLiveFollowOwner({
          cinematicMotion: true,
          activeDeclarationReveal: true,
          freshGmRound: null,
          gmRevealComplete: false,
          nextActionVisible: false,
        }),
    });
    const observer = new ResizeObserver(() => controller.onResizeObserverFire());
    observer.observe(round2End.growthEl);

    const before = harness.getScrollY();
    const deltas = simulateBotProseGrowth({
      fireResize: harness.fireResize,
      growthEl: round2End.growthEl,
      endEl: round2End.endEl,
      lengths: [20, 80, 180, 350, 600],
      flushRaf: harness.flushRaf,
      getScrollY: harness.getScrollY,
    });
    assert.ok(deltas.some((delta) => delta > 0), "second round growth follow");
    assert.ok(harness.getScrollY() > before);
    controller.cleanupProgrammatic();
    observer.disconnect();
  });

  it("6: GM narration follow regression — GM end still scrolls reading band", () => {
    const gmEnd = harness.document.createElement("span");
    gmEnd.setAttribute("data-trpg-narration-end", "true");
    harness.document.body.appendChild(gmEnd);
    const gmTop = proseLengthToEndTop(900);
    gmEnd.getBoundingClientRect = () => ({
      top: gmTop,
      left: 0,
      right: 0,
      bottom: gmTop + 1,
      width: 0,
      height: 1,
      x: 0,
      y: gmTop,
      toJSON: () => ({}),
    });
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        activeDeclarationReveal: false,
        freshGmRound: 2,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "GM_NARRATION_END"
    );
    const before = harness.getScrollY();
    const delta = applyTrpgReadingBandEndFollow({
      element: gmEnd,
      scrollBy: (top) => harness.window.scrollBy({ top, behavior: "instant" }),
    });
    assert.ok(delta > 0, "GM narration end produces downward follow delta");
    assert.ok(harness.getScrollY() > before, "GM narration follow regression preserved");
  });
});
