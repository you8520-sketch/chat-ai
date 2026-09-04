import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_LIVE_FOLLOW_TARGET_RATIO,
  handleChatStreamLayoutGrowth,
  resolveActiveAssistantStreamEnd,
  resolveFollowBeforeStream,
  shouldDetachChatLiveFollowOnKey,
  shouldDetachChatLiveFollowOnTouchDelta,
  shouldDetachChatLiveFollowOnWheel,
  shouldStartChatStreamFollow,
} from "./chatLiveFollow";
import {
  createLiveReadingFollowController,
  LIVE_READING_TARGET_RATIO,
} from "./liveReadingFollow";

describe("chat live follow owner map", () => {
  it("C11: preserves manual scroll when user was not at latest before stream", () => {
    assert.deepEqual(resolveFollowBeforeStream({ nearLatest: false, manualDetached: false }), {
      followLatest: false,
      manualDetached: true,
    });
    assert.deepEqual(resolveFollowBeforeStream({ nearLatest: true, manualDetached: false }), {
      followLatest: true,
      manualDetached: false,
    });
  });

  it("C5/C6: manual detach helpers block auto follow", () => {
    assert.equal(shouldDetachChatLiveFollowOnWheel(-1), true);
    assert.equal(shouldDetachChatLiveFollowOnTouchDelta(-10), true);
    assert.equal(shouldDetachChatLiveFollowOnKey("PageUp"), true);
    assert.equal(shouldDetachChatLiveFollowOnKey("ArrowDown"), false);
    assert.equal(shouldStartChatStreamFollow({ followLatest: true, manualDetached: true }), false);
  });

  it("C31: active assistant stream end sentinel resolves from ref or DOM", () => {
    const sentinel = { id: "sentinel" } as HTMLElement;
    const endRef = { current: null as HTMLElement | null };
    const root = {
      querySelector: () => sentinel,
    } as ParentNode;
    assert.equal(resolveActiveAssistantStreamEnd({ endRef, root }), sentinel);
    endRef.current = { id: "ref" } as HTMLElement;
    assert.equal(resolveActiveAssistantStreamEnd({ endRef, root }), endRef.current);
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
      now: () => nowMs,
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
      now: () => 16,
    });
    controller.notifyTargetUpdate();
    assert.equal(scrollY, 0);
    controller.stop();
  });
});
