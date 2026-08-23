import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  STREAM_REVEAL_MAX_TARGET_LAG_MS,
  computeAdaptiveCharsPerTick,
  estimateStreamRevealDurationMs,
  streamRevealOptionsFromInterval,
  theoreticalRevealDurationsForCharCount,
} from "@/lib/streamRevealTiming";

describe("streamRevealTiming — chat 707 theoretical durations", () => {
  const CHARS = 5485;

  it("A: 5485 chars fixed-speed presets", () => {
    const durations = theoreticalRevealDurationsForCharCount(CHARS);
    assert.equal(durations["즉시"], 0);
    assert.equal(durations["빠름"], 5485 * 35);
    assert.equal(durations["보통"], 5485 * 50);
    assert.equal(durations["느림"], 5485 * 65);
    assert.equal(durations["빠름"], 191_975);
  });

  it("B: adaptive catch-up caps drain time for large backlog", () => {
    const fast = streamRevealOptionsFromInterval(35);
    const adaptive = computeAdaptiveCharsPerTick(5485, fast);
    assert.ok(adaptive > fast.charsPerTick);
    const drainMs = Math.ceil(5485 / adaptive) * fast.intervalMs;
    assert.ok(drainMs <= STREAM_REVEAL_MAX_TARGET_LAG_MS + fast.intervalMs);
  });

  it("G: small backlog keeps base charsPerTick", () => {
    const fast = streamRevealOptionsFromInterval(35);
    assert.equal(computeAdaptiveCharsPerTick(10, fast), 1);
  });
});

describe("createStreamReveal adaptive + visibility", () => {
  it("A: 5485 fast backlog completes far faster than fixed-speed theoretical duration", async () => {
    let shown = "";
    const fast = streamRevealOptionsFromInterval(35);
    const fixedTheoreticalMs = estimateStreamRevealDurationMs(5485, fast);
    const reveal = createStreamReveal(
      { onAppend: (c) => { shown += c; } },
      fast
    );
    reveal.enqueue("x".repeat(5485));
    const start = Date.now();
    while (!reveal.isIdle() && Date.now() - start < 60_000) {
      await new Promise((r) => setTimeout(r, 16));
    }
    assert.equal([...shown].length, 5485);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 60_000);
    assert.ok(elapsed < fixedTheoreticalMs / 3, `adaptive ${elapsed}ms vs fixed ${fixedTheoreticalMs}ms`);
    assert.ok(reveal.isIdle());
  });

  it("C/D: hidden tab bypasses animation backlog", () => {
    let shown = "";
    const reveal = createStreamReveal(
      { onAppend: (c) => { shown += c; } },
      { intervalMs: 35, charsPerTick: 1 }
    );
    reveal.setBackgroundMode(true);
    reveal.enqueue("hello");
    reveal.enqueue(" world");
    assert.equal(shown, "hello world");
    assert.equal(reveal.getPendingLength(), 0);
    reveal.setBackgroundMode(false);
    reveal.enqueue("!");
    reveal.flush();
    assert.equal(shown, "hello world!");
  });

  it("E/G: flush clears pending immediately", () => {
    let shown = "";
    const reveal = createStreamReveal(
      { onAppend: (c) => { shown += c; } },
      { intervalMs: 35, charsPerTick: 1 }
    );
    reveal.enqueue("abc");
    reveal.flush();
    assert.equal(shown, "abc");
    assert.ok(reveal.isIdle());
    assert.equal(reveal.activeTimerCount(), 0);
  });
});

describe("estimateStreamRevealDurationMs", () => {
  it("instant preset is zero", () => {
    assert.equal(
      estimateStreamRevealDurationMs(100, streamRevealOptionsFromInterval(0)),
      0
    );
  });
});
