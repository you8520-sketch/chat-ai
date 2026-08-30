import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  planStreamRevealTermination,
  runStreamRevealTermination,
} from "@/lib/streamRevealLifecycle";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

const FAST = streamRevealOptionsFromInterval(35);
const BURST = 3200;
const FAST_TEST = streamRevealOptionsFromInterval(1);

describe("streamReveal lifecycle — server vs visual decoupling", () => {
  it("R6: SERVER DONE DECOUPLING — request terminal before reveal idle", async () => {
    const events: string[] = [];
    let shown = "";
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, FAST_TEST);
    reveal.enqueue("가".repeat(80));
    const pendingAtDone = reveal.getPendingLength();
    events.push("SERVER_DONE_AT");

    const plan = planStreamRevealTermination({
      instantReveal: false,
      isIdle: reveal.isIdle(),
      hadError: false,
      trafficOverload: false,
    });
    assert.equal(plan.action, "end_deferred");

    runStreamRevealTermination(plan, {
      reveal,
      removeVisibilityListener: () => {},
      flush: false,
    });
    events.push("REQUEST_LIFECYCLE_DONE_AT");

    await new Promise((r) => setTimeout(r, 30));
    events.push(`LOADING_FALSE_AT@${[...shown].length}`);
    assert.ok(pendingAtDone >= 80);
    assert.ok([...shown].length < 80);

    await reveal.waitUntilIdle();
    events.push("VISUAL_REVEAL_FINISHED_AT");

    const serverIdx = events.indexOf("SERVER_DONE_AT");
    const requestIdx = events.indexOf("REQUEST_LIFECYCLE_DONE_AT");
    const visualIdx = events.indexOf("VISUAL_REVEAL_FINISHED_AT");
    assert.ok(serverIdx < requestIdx);
    assert.ok(requestIdx < visualIdx);
  });

  it("R7: BILLING TIMING — billing hook can run before reveal idle", async () => {
    const billingApplied: number[] = [];
    let shown = "";
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, FAST);
    reveal.enqueue("가".repeat(200));
    runStreamRevealTermination(
      planStreamRevealTermination({
        instantReveal: false,
        isIdle: false,
        hadError: false,
        trafficOverload: false,
      }),
      { reveal, removeVisibilityListener: () => {} }
    );
    billingApplied.push(Date.now());
    assert.ok(reveal.getPendingLength() > 0);
    await reveal.waitUntilIdle();
    assert.equal([...shown].length, 200);
    assert.ok(billingApplied.length === 1);
  });

  it("R8: CONTROLLER LIFETIME — deferred cleanup runs exactly once", async () => {
    let cleanups = 0;
    let shown = "";
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, FAST);
    reveal.enqueue("abc");
    runStreamRevealTermination(
      { action: "end_deferred" },
      {
        reveal,
        removeVisibilityListener: () => { cleanups += 1; },
      }
    );
    await reveal.waitUntilIdle();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cleanups, 1);
    assert.equal(shown, "abc");
  });

  it("R9: SPEED CHANGE AFTER DONE — syncOptions applies without reset", () => {
    let shown = "";
    let intervalMs = 35;
    const reveal = createStreamReveal(
      { onAppend: (c) => { shown += c; } },
      () => ({ intervalMs, charsPerTick: 1 })
    );
    reveal.enqueue("가".repeat(10));
    intervalMs = 65;
    reveal.syncOptions();
    assert.equal(shown, "");
    reveal.flush();
    assert.equal([...shown].length, 10);
  });

  it("R10: BACKGROUND AFTER DONE — deferred session still bypasses queue", () => {
    let shown = "";
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, FAST);
    reveal.enqueue("pending");
    runStreamRevealTermination(
      { action: "end_deferred" },
      { reveal, removeVisibilityListener: () => {} }
    );
    reveal.setBackgroundMode(true);
    reveal.enqueue(" tail");
    assert.equal(shown, "pending tail");
    reveal.flush();
  });

  it("R11: UNMOUNT — flush on dispose clears pending without orphan timer", () => {
    let shown = "";
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, FAST);
    reveal.enqueue("orphan");
    reveal.flush();
    assert.equal(reveal.activeTimerCount(), 0);
    assert.ok(reveal.isIdle());
    assert.equal(shown, "orphan");
  });

  it("instant path ends sync with flush plan", () => {
    const plan = planStreamRevealTermination({
      instantReveal: true,
      isIdle: false,
      hadError: false,
      trafficOverload: false,
    });
    assert.deepEqual(plan, { action: "end_sync", flush: true });
  });
});
