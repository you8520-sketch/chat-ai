import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_LIVE_FOLLOW_TARGET_RATIO,
  handleChatStreamLayoutGrowth,
  isChatLiveReadingActive,
  resolveActiveAssistantStreamEnd,
  resolveChatFollowResize,
  resolveFollowBeforeStream,
  shouldDetachChatLiveFollowOnKey,
  shouldDetachChatLiveFollowOnTouchDelta,
  shouldDetachChatLiveFollowOnWheel,
  shouldIgnoreChatLiveFollowScrollForDetach,
  shouldRecordChatManualDetachOnScrollDelta,
  shouldReattachChatLiveFollowOnScrollDelta,
  shouldSkipChatLiveFollowKeydown,
  shouldStartChatStreamFollow,
} from "./chatLiveFollow";
import {
  createLiveReadingFollowController,
  LIVE_READING_TARGET_RATIO,
} from "./liveReadingFollow";

describe("chat live follow owner map", () => {
  it("P0-A: geometry never creates manual detach at stream start", () => {
    assert.deepEqual(resolveFollowBeforeStream({ nearLatest: false, manualDetached: false }), {
      followLatest: true,
      manualDetached: false,
    });
    assert.deepEqual(resolveFollowBeforeStream({ nearLatest: true, manualDetached: false }), {
      followLatest: true,
      manualDetached: false,
    });
    assert.deepEqual(resolveFollowBeforeStream({ nearLatest: true, manualDetached: true }), {
      followLatest: false,
      manualDetached: true,
    });
  });

  it("P0-3: single live-reading active owner covers network + visual reveal", () => {
    assert.equal(
      isChatLiveReadingActive({ networkInFlight: false, visualRevealPendingCount: 0 }),
      false
    );
    assert.equal(
      isChatLiveReadingActive({ networkInFlight: true, visualRevealPendingCount: 0 }),
      true
    );
    assert.equal(
      isChatLiveReadingActive({ networkInFlight: false, visualRevealPendingCount: 1 }),
      true
    );
  });

  it("C5/C6: manual detach helpers block auto follow", () => {
    assert.equal(shouldDetachChatLiveFollowOnWheel(-1), true);
    assert.equal(shouldDetachChatLiveFollowOnTouchDelta(-10), true);
    assert.equal(shouldDetachChatLiveFollowOnKey("PageUp"), true);
    assert.equal(shouldDetachChatLiveFollowOnKey("ArrowDown"), false);
    assert.equal(shouldStartChatStreamFollow({ followLatest: true, manualDetached: true }), false);
  });

  it("P0-4: programmatic live-follow scroll must not detach via onScroll owner", () => {
    assert.equal(
      shouldIgnoreChatLiveFollowScrollForDetach({
        liveReadingActive: true,
        programmaticScrollInFlight: false,
      }),
      true
    );
    assert.equal(
      shouldIgnoreChatLiveFollowScrollForDetach({
        liveReadingActive: false,
        programmaticScrollInFlight: true,
      }),
      true
    );
    assert.equal(
      shouldRecordChatManualDetachOnScrollDelta({
        scrollDeltaPx: -8,
        programmaticScrollInFlight: false,
      }),
      true
    );
    assert.equal(
      shouldRecordChatManualDetachOnScrollDelta({
        scrollDeltaPx: 12,
        programmaticScrollInFlight: false,
      }),
      false
    );
    assert.equal(
      shouldRecordChatManualDetachOnScrollDelta({
        scrollDeltaPx: -8,
        programmaticScrollInFlight: true,
      }),
      true
    );
  });

  it("P1: records negative scrollbar intent before a live stream", () => {
    assert.equal(
      shouldRecordChatManualDetachOnScrollDelta({
        scrollDeltaPx: -40,
        programmaticScrollInFlight: false,
      }),
      true
    );
    assert.equal(
      shouldRecordChatManualDetachOnScrollDelta({
        scrollDeltaPx: 0,
        programmaticScrollInFlight: false,
      }),
      false
    );
  });

  it("P1 resize: geometry rebases baseline without mutating detach or reattach state", () => {
    const attached = resolveChatFollowResize({
      scrollY: 940,
      followLatest: true,
      manualDetached: false,
      liveReadingActive: true,
    });
    assert.deepEqual(attached, {
      scrollBaselineY: 940,
      followLatest: true,
      manualDetached: false,
      notifyFollowTarget: true,
    });

    const detached = resolveChatFollowResize({
      scrollY: 940,
      followLatest: false,
      manualDetached: true,
      liveReadingActive: false,
    });
    assert.deepEqual(detached, {
      scrollBaselineY: 940,
      followLatest: false,
      manualDetached: true,
      notifyFollowTarget: false,
    });
  });

  it("P0-B: near-bottom geometry alone cannot reattach manual detach", () => {
    assert.equal(
      shouldReattachChatLiveFollowOnScrollDelta({
        manualDetached: true,
        scrollDeltaPx: 0,
        nearLatest: true,
      }),
      false
    );
    assert.equal(
      shouldReattachChatLiveFollowOnScrollDelta({
        manualDetached: true,
        scrollDeltaPx: 12,
        nearLatest: true,
      }),
      true
    );
    assert.equal(
      shouldReattachChatLiveFollowOnScrollDelta({
        manualDetached: true,
        scrollDeltaPx: 12,
        nearLatest: false,
      }),
      false
    );
  });

  it("P0-12: keyboard detach skips editable controls", () => {
    class MockElement {
      closest() {
        return this;
      }
    }
    const priorElement = globalThis.Element;
    globalThis.Element = MockElement as typeof Element;
    try {
      const input = new MockElement();
      const plain = { closest: () => null };
      assert.equal(shouldSkipChatLiveFollowKeydown(input as unknown as EventTarget), true);
      assert.equal(shouldSkipChatLiveFollowKeydown(plain as unknown as EventTarget), false);
    } finally {
      globalThis.Element = priorElement;
    }
  });

  it("C31: active assistant stream end resolves by request id, not first selector", () => {
    const sentinel = { id: "sentinel" } as HTMLElement;
    const endRef = { current: null as HTMLElement | null };
    const root = {
      querySelector: (selector: string) =>
        selector.includes('data-chat-assistant-stream-request-id="req-2"') ? sentinel : null,
    } as ParentNode;
    assert.equal(resolveActiveAssistantStreamEnd({ endRef, root, activeRequestId: "req-1" }), null);
    assert.equal(
      resolveActiveAssistantStreamEnd({ endRef, root, activeRequestId: "req-2" }),
      sentinel
    );
    endRef.current = { id: "ref" } as HTMLElement;
    assert.equal(resolveActiveAssistantStreamEnd({ endRef, root, activeRequestId: "req-2" }), endRef.current);
  });

  it("uses shared reading target ratio", () => {
    assert.equal(CHAT_LIVE_FOLLOW_TARGET_RATIO, LIVE_READING_TARGET_RATIO);
    assert.equal(CHAT_LIVE_FOLLOW_TARGET_RATIO, 0.63);
  });

  it("C9/C10: layout growth notifies animator only when attached", () => {
    let updates = 0;
    handleChatStreamLayoutGrowth({
      following: true,
      manualDetached: false,
      onTargetUpdate: () => {
        updates += 1;
      },
    });
    assert.equal(updates, 1);
    handleChatStreamLayoutGrowth({
      following: true,
      manualDetached: true,
      onTargetUpdate: () => {
        updates += 1;
      },
    });
    assert.equal(updates, 1);
  });
});

describe("chat continuous follow motion (shared engine)", () => {
  it("C2/C3/C4: velocity-limited chase without per-line full delta jumps", () => {
    let scrollY = 0;
    let endTop = 900;
    const viewportHeight = 1000;
    let nowMs = 0;
    const el = {
      getBoundingClientRect: () => ({ top: endTop }),
    } as Element;

    const controller = createLiveReadingFollowController({
      getViewportHeight: () => viewportHeight,
      scrollBy: (delta) => {
        scrollY += delta;
        endTop -= delta;
      },
      resolveTargetElement: () => el,
      shouldFollow: () => true,
      requestAnimationFrame: (fn) => {
        nowMs += 16;
        fn(nowMs);
        return nowMs;
      },
      cancelAnimationFrame: () => {},
    });

    controller.notifyTargetUpdate();
    const maxStep = 260 * (16 / 1000) + 1;
    for (let i = 0; i < 120; i += 1) {
      const before = scrollY;
      controller.notifyTargetUpdate();
      const step = scrollY - before;
      if (step !== 0) assert.ok(Math.abs(step) <= maxStep);
    }
    assert.ok(Math.abs(endTop - viewportHeight * LIVE_READING_TARGET_RATIO) < 12);
    controller.stop();
  });

  it("C1: short response converges without large drift when already aligned", () => {
    let scrollY = 0;
    const viewportHeight = 800;
    const el = {
      getBoundingClientRect: () => ({ top: viewportHeight * LIVE_READING_TARGET_RATIO }),
    } as Element;
    const controller = createLiveReadingFollowController({
      getViewportHeight: () => viewportHeight,
      scrollBy: (delta) => {
        scrollY += delta;
      },
      resolveTargetElement: () => el,
      shouldFollow: () => true,
      requestAnimationFrame: (fn) => {
        fn(16);
        return 1;
      },
      cancelAnimationFrame: () => {},
    });
    controller.notifyTargetUpdate();
    assert.equal(scrollY, 0);
    controller.stop();
  });
});
