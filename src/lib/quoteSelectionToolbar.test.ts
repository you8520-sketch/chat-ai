import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampQuoteToolbarPosition, createCoalescedSelectionScheduler } from "@/lib/quoteSelectionToolbar";

describe("quoteSelectionToolbar", () => {
  it("clamps toolbar coordinates inside the viewport", () => {
    assert.deepEqual(
      clampQuoteToolbarPosition({ x: 390, y: 830 }, { width: 430, height: 860 }, { toolbarWidth: 120, toolbarHeight: 44 }),
      { x: 302, y: 808 }
    );
    assert.deepEqual(
      clampQuoteToolbarPosition({ x: -50, y: -20 }, { width: 320, height: 640 }),
      { x: 8, y: 8 }
    );
  });

  it("coalesces consecutive selection events and cleans up timers", () => {
    let nextRaf = 1;
    const rafCallbacks = new Map<number, () => void>();
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    let calls = 0;
    let canceledRafs = 0;
    let clearedTimeouts = 0;
    const scheduler = createCoalescedSelectionScheduler({
      requestAnimationFrame(cb) {
        const id = nextRaf++;
        rafCallbacks.set(id, cb);
        return id;
      },
      cancelAnimationFrame(id) {
        if (rafCallbacks.delete(id)) canceledRafs++;
      },
      setTimeout(cb) {
        const id = setTimeout(cb, 0);
        timeouts.add(id);
        return id;
      },
      clearTimeout(id) {
        clearedTimeouts++;
        clearTimeout(id);
        timeouts.delete(id);
      },
    });

    scheduler.schedule(() => calls++);
    scheduler.schedule(() => calls++);
    assert.equal(canceledRafs, 1);
    assert.equal(rafCallbacks.size, 1);
    [...rafCallbacks.values()][0]!();
    scheduler.cancel();
    assert.equal(clearedTimeouts, 1);
    assert.equal(calls, 0);
  });
});
